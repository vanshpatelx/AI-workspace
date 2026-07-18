import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PreviewServer } from "@ai-workspace/protocol";

const run = promisify(execFile);

/** Ports the Worker itself owns — never advertise these as previews. */
function ownPorts(workerPort: number): Set<number> {
  return new Set([workerPort, workerPort + 1, 5180]);
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
