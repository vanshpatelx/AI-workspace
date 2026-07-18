import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Desktop build output — resolves from both src/ (dev) and dist/ (installed). */
const UI_DIR = join(HERE, "..", "..", "desktop", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export function uiDirExists(): boolean {
  return existsSync(join(UI_DIR, "index.html"));
}

export function uiDir(): string {
  return UI_DIR;
}

/**
 * Serves the built Desktop UI over loopback so `aiw ui` gives a working app
 * without a dev server. Single-page app: unknown paths fall back to index.html.
 */
export function serveUi(port: number): void {
  const server = createServer(async (req, res) => {
    // Strip query/hash and block path traversal outside the build dir.
    const rawPath = (req.url ?? "/").split("?")[0]!.split("#")[0]!;
    const relative = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(UI_DIR, relative === "/" ? "index.html" : relative);
    if (!filePath.startsWith(UI_DIR)) filePath = join(UI_DIR, "index.html");
    if (!existsSync(filePath)) filePath = join(UI_DIR, "index.html");

    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`ai-workspace UI  ->  http://127.0.0.1:${port}`);
    console.log("(pair using the code from `aiw worker status`)");
  });
}
