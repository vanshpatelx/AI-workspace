import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { arch, platform } from "node:os";
import { Readable } from "node:stream";
import { configDir } from "./config.js";

/**
 * A full VS Code, running on the Worker and framed by the Desktop.
 *
 * The lightweight Monaco panel was a text box that was smart about code; this is
 * the whole workbench — extensions, language servers, an integrated terminal,
 * debugging — which cannot be bundled and cannot be an editor widget. It is
 * code-server (a build of Code-OSS) spawned on loopback with auth disabled,
 * because the Worker's proxy already gates every request with the pairing code.
 * The Desktop reaches it through that proxy, so it works over a relay and never
 * exposes an open IDE on the network.
 *
 * The binary is ~180MB, so it is downloaded once on first use and cached, not
 * shipped. One server serves every workspace: it is a multi-folder application,
 * and each workspace just opens its own `?folder=` in the same process rather
 * than paying for a second 200MB instance.
 */

/** Pinned so the cached binary and the download URL never disagree. */
const VERSION = "4.129.0";
const HEALTH_TIMEOUT_MS = 60_000;

export interface DownloadProgress {
  phase: "downloading" | "extracting" | "starting";
  /** 0..100 while downloading; absent for phases without a known total. */
  percent?: number;
}

/** The release asset for this machine, or null on an unsupported platform. */
function assetName(os: string = platform(), cpu: string = arch()): string | null {
  const target =
    os === "darwin"
      ? cpu === "arm64"
        ? "macos-arm64"
        : "macos-amd64"
      : os === "linux"
        ? cpu === "arm64"
          ? "linux-arm64"
          : "linux-amd64"
        : null;
  return target ? `code-server-${VERSION}-${target}.tar.gz` : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export class VSCodeServer {
  private proc: ChildProcess | null = null;
  /** In-flight boot, so concurrent Code-tab opens share one download/spawn. */
  private booting: Promise<void> | null = null;

  constructor(
    private readonly port: number,
    private readonly log: (msg: string) => void = () => {},
    /** Overridable so the cache location can be pointed elsewhere in tests. */
    private readonly baseDir: string = join(configDir(), "vscode"),
  ) {}

  private get versionDir(): string {
    return join(this.baseDir, VERSION);
  }
  private get binary(): string {
    return join(this.versionDir, "bin", "code-server");
  }

  /** Bring the server up if needed and resolve once it answers health checks. */
  async ensure(onProgress: (p: DownloadProgress) => void = () => {}): Promise<void> {
    if (this.proc && (await this.healthy())) return;
    if (!this.booting) {
      this.booting = this.boot(onProgress).finally(() => {
        this.booting = null;
      });
    }
    return this.booting;
  }

  private async boot(onProgress: (p: DownloadProgress) => void): Promise<void> {
    if (!(await exists(this.binary))) await this.install(onProgress);
    onProgress({ phase: "starting" });
    await this.spawn();
    await this.waitHealthy();
  }

  private async install(onProgress: (p: DownloadProgress) => void): Promise<void> {
    const asset = assetName();
    if (!asset) throw new Error(`VS Code is not available for ${platform()}/${arch()}`);
    const url = `https://github.com/coder/code-server/releases/download/v${VERSION}/${asset}`;

    await mkdir(this.versionDir, { recursive: true });
    const tarball = join(this.versionDir, asset);
    this.log(`downloading VS Code ${VERSION} (${asset})`);

    // Stream to disk so a 180MB download never sits in memory, and report
    // percent against Content-Length so the Desktop can show real progress.
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;
    onProgress({ phase: "downloading", percent: 0 });

    const out = createWriteStream(tarball);
    const reader = res.body.getReader();
    let lastPct = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      if (total) {
        const pct = Math.floor((received / total) * 100);
        // Throttle to whole-percent steps to avoid flooding the socket.
        if (pct > lastPct) {
          lastPct = pct;
          onProgress({ phase: "downloading", percent: pct });
        }
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));

    onProgress({ phase: "extracting" });
    this.log("extracting VS Code");
    await this.extract(tarball);
    await rm(tarball, { force: true });
    if (!(await exists(this.binary))) throw new Error("VS Code archive did not contain the expected binary");
    this.log("VS Code installed");
  }

  private extract(tarball: string): Promise<void> {
    // `tar` ships on macOS and Linux; --strip-components drops the top folder
    // so the layout is <versionDir>/bin/code-server rather than nested twice.
    return new Promise((resolve, reject) => {
      const tar = spawn("tar", ["-xzf", tarball, "-C", this.versionDir, "--strip-components=1"], {
        stdio: "ignore",
      });
      tar.on("error", reject);
      tar.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
    });
  }

  private async spawn(): Promise<void> {
    // Contained under the Worker's config dir so VS Code's state and extensions
    // never leak into the user's own ~/.config, and auth is off because the
    // proxy in front of this is what actually gates access.
    const dataDir = join(this.baseDir, "data");
    const extDir = join(this.baseDir, "extensions");
    await mkdir(dataDir, { recursive: true });

    this.proc = spawn(
      this.binary,
      [
        "--bind-addr",
        `127.0.0.1:${this.port}`,
        "--auth",
        "none",
        "--disable-telemetry",
        "--disable-update-check",
        "--disable-workspace-trust",
        "--user-data-dir",
        dataDir,
        "--extensions-dir",
        extDir,
      ],
      { stdio: "ignore" },
    );
    this.proc.on("exit", (code) => {
      this.log(`VS Code server exited (${code})`);
      this.proc = null;
    });
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/healthz`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitHealthy(): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.healthy()) return;
      if (!this.proc) throw new Error("VS Code server exited before it became ready");
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("VS Code server did not become ready in time");
  }

  /** Loopback port the proxy forwards to. */
  get targetPort(): number {
    return this.port;
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

/** Exposed for tests: the asset naming is the one bit of pure logic worth pinning. */
export const _test = { assetName, VERSION };
