import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { CONFIG_DIR } from "./config.js";

const run = promisify(execFile);

export const SERVICE_LABEL = "dev.aiworkspace.worker";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The CLI entry to run as a service — dist/cli.js when installed. */
const CLI_ENTRY = join(HERE, "cli.js");

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function logDir(): string {
  return join(CONFIG_DIR, "logs");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );
}

/**
 * launchd agent definition.
 *
 * RunAtLoad starts the Worker at login; KeepAlive restarts it if it exits, so
 * a crash or a machine restart doesn't silently leave the workspace offline.
 * AIW_HOME is pinned so a service installed from a custom home keeps using it.
 */
function buildPlist(nodePath: string, cwd: string): string {
  const args = [nodePath, CLI_ENTRY, "worker", "start"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AIW_HOME</key>
    <string>${escapeXml(CONFIG_DIR)}</string>
    <key>PATH</key>
    <string>${escapeXml(process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin")}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(logDir(), "worker.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(logDir(), "worker.err.log"))}</string>
</dict>
</plist>
`;
}

function assertMac(): void {
  if (platform() !== "darwin") {
    throw new Error(
      `\`aiw service\` currently supports macOS (launchd) only — detected ${platform()}.\n` +
        "On Linux, run the Worker under a systemd user unit or your process manager of choice.",
    );
  }
}

/** Install and start the Worker as a login agent. */
export async function installService(cwd: string): Promise<string> {
  assertMac();
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(
      `cannot find the built CLI at ${CLI_ENTRY}. Run \`pnpm -r build\` (or reinstall) first.`,
    );
  }

  mkdirSync(logDir(), { recursive: true });
  mkdirSync(dirname(plistPath()), { recursive: true });
  writeFileSync(plistPath(), buildPlist(process.execPath, cwd), "utf8");

  // Replace any previous instance so re-installing is idempotent.
  await bootout().catch(() => {});
  await run("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 501}`, plistPath()]);
  return plistPath();
}

/** Stop and remove the login agent. */
export async function uninstallService(): Promise<void> {
  assertMac();
  await bootout().catch(() => {});
  if (existsSync(plistPath())) rmSync(plistPath());
}

async function bootout(): Promise<void> {
  await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`]);
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  plist: string;
  logs: string;
}

export async function serviceStatus(): Promise<ServiceStatus> {
  assertMac();
  const status: ServiceStatus = {
    installed: existsSync(plistPath()),
    running: false,
    plist: plistPath(),
    logs: logDir(),
  };
  try {
    const { stdout } = await run("launchctl", [
      "print",
      `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`,
    ]);
    const pid = stdout.match(/\bpid = (\d+)/)?.[1];
    status.running = Boolean(pid);
    if (pid) status.pid = Number(pid);
  } catch {
    // Not loaded — leave running=false.
  }
  return status;
}
