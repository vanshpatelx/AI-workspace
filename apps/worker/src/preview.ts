import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PreviewServer } from "@ai-workspace/protocol";

const run = promisify(execFile);

/** Ports the Worker itself owns — never advertise these as previews. */
function ownPorts(workerPort: number): Set<number> {
  // +1 is the proxy/approval endpoint, +2 is the VS Code server — neither is a
  // user dev server, so they must never be advertised as previews.
  return new Set([workerPort, workerPort + 1, workerPort + 2, 5180]);
}

/** Recognise the usual dev servers from their default ports / process names. */
function guessFramework(port: number, process: string): string | undefined {
  const p = process.toLowerCase();
  if (port === 5173 || port === 5174) return "Vite";
  if (port === 3000 || port === 3001) return p.includes("node") ? "Next.js / React" : undefined;
  if (port === 4200) return "Angular";
  if (port === 8000) return "Django";
  if (port === 3333 || port === 1313) return "Hugo";
  if (port === 5000) return "Flask";
  if (port === 8080) return "HTTP server";
  if (p.includes("ruby") || p.includes("puma")) return "Rails";
  if (p.includes("python")) return "Python";
  return undefined;
}

/**
 * Both loopback addresses, because binding to one is not binding to both.
 *
 * Metro listens on ::1 only, so probing 127.0.0.1 alone found nothing at all
 * and the bundler was invisible — as would be any other IPv6-only dev server.
 */
const LOOPBACK = ["127.0.0.1", "[::1]"];

/**
 * Ask a port whether it is Metro.
 *
 * React Native's status middleware exists precisely so callers can tell the
 * bundler apart from whatever else might be sitting on 8081, and it names the
 * project it is serving in a header while it is at it. Probing this rather than
 * guessing from the port number means Metro on a non-default port is still
 * recognised, and something else on 8081 is not mistaken for it.
 */
async function probeMetro(port: number): Promise<{ projectRoot?: string } | null> {
  for (const host of LOOPBACK) {
    try {
      const res = await fetch(`http://${host}:${port}/status`, {
        signal: AbortSignal.timeout(1200),
      });
      const body = await res.text();
      if (!body.includes("packager-status:running")) continue;
      const root = res.headers.get("x-react-native-project-root");
      return root ? { projectRoot: root } : {};
    } catch {
      // Not listening on this address, or not HTTP — try the other one.
    }
  }
  return null;
}

/**
 * Ask Metro to reload the app connected to it.
 *
 * The dev server broadcasts a reload to every attached client, so the simulator
 * running on the user's own machine picks it up — which is the point: the agent
 * changes code here, and the app reloads over there.
 */
export async function reloadMetro(port: number): Promise<string | null> {
  for (const host of LOOPBACK) {
    try {
      const res = await fetch(`http://${host}:${port}/reload`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return null;
      return `Metro answered ${res.status}`;
    } catch {
      // Wrong address family, or nothing there — try the other loopback.
    }
  }
  return "could not reach Metro on that port";
}

/**
 * Enumerate local TCP listeners via lsof (macOS/Linux), then probe each one
 * over HTTP. Only ports that actually answer HTTP are reported, so databases
 * and other non-web listeners are filtered out.
 */
export async function detectPreviewServers(workerPort: number): Promise<PreviewServer[]> {
  const skip = ownPorts(workerPort);
  const candidates = new Map<number, string>();

  try {
    const { stdout } = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { timeout: 5000 });
    for (const line of stdout.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 9) continue;
      const command = cols[0] ?? "";
      const addr = cols[8] ?? "";
      const match = addr.match(/:(\d+)$/);
      if (!match) continue;
      // Only loopback / wildcard binds — not connections out to other hosts.
      if (!/^(\*|127\.0\.0\.1|\[::1\]|localhost)/.test(addr)) continue;
      const port = Number(match[1]);
      if (!Number.isFinite(port) || skip.has(port)) continue;
      // Below 1024 is system services; 49152+ is the ephemeral range, where
      // unrelated apps open transient sockets — neither is a dev server.
      if (port < 1024 || port >= 49152) continue;
      if (!candidates.has(port)) candidates.set(port, command);
    }
  } catch {
    return []; // lsof unavailable — report nothing rather than guessing.
  }

  const probes = [...candidates.entries()].map(
    async ([port, process]): Promise<PreviewServer | null> => {
      // Ask about Metro first. Its root path answers 404 with an HTML error
      // body, which would otherwise pass the "serves a web page" test below and
      // be offered as a preview that can only ever render an error.
      const metro = await probeMetro(port);
      if (metro) {
        const server: PreviewServer = { port, process, kind: "metro", framework: "Metro" };
        if (metro.projectRoot) server.projectRoot = metro.projectRoot;
        return server;
      }

      const url = `http://127.0.0.1:${port}/`;
      try {
        const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1200) });
        const contentType = res.headers.get("content-type") ?? "";
        const body = await res.text().catch(() => "");

        // Only surface things that actually serve a web page. Plenty of local
        // services answer HTTP with JSON/RPC and are not useful to preview.
        const servesHtml =
          contentType.includes("text/html") ||
          /<html|<!doctype html/i.test(body.slice(0, 500)) ||
          (res.status >= 300 && res.status < 400); // dev servers often redirect
        if (!servesHtml) return null;

        const title = body.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim();
        const server: PreviewServer = { port, process };
        if (title) server.title = title;
        const framework = guessFramework(port, process);
        if (framework) server.framework = framework;
        return server;
      } catch {
        return null; // not an HTTP server (or refused) — skip it
      }
    },
  );

  const found = (await Promise.all(probes)).filter((s): s is PreviewServer => s !== null);
  return found.sort((a, b) => a.port - b.port);
}
