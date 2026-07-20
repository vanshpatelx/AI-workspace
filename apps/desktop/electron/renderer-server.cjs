// Serving the built renderer over loopback http, split out of main.cjs so it can
// be exercised without booting Electron.
//
// The Code tab frames a full VS Code that runs on the Worker over http. A file://
// top-level page cannot host that iframe — VS Code needs same-context storage and
// a service worker, and Chromium denies both to http content framed inside a
// file:// origin, so the workbench renders blank. Serving the app from http gives
// it an ordinary web origin, and the iframe behaves exactly as it does in a
// browser.
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

/** Static file server for `root`, with client-side-routing fallback to index.html. */
function createRendererServer(root) {
  return http.createServer(async (req, res) => {
    try {
      const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      // Block traversal, then fall back to index.html for unknown routes.
      const rel = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
      let filePath = path.join(root, rel === "/" ? "index.html" : rel);
      if (!filePath.startsWith(root)) filePath = path.join(root, "index.html");
      let data;
      try {
        data = await fsp.readFile(filePath);
      } catch {
        filePath = path.join(root, "index.html");
        data = await fsp.readFile(filePath);
      }
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
}

/**
 * Bind to a stable loopback port.
 *
 * The port is the app's web origin, so localStorage — the paired workstations —
 * only survives restarts if it stays the same. A remembered port is reused; the
 * scan only matters if something external ever squats on the preferred one.
 */
async function listenStable(server, portFile, preferredDefault = 7317) {
  let preferred = preferredDefault;
  try {
    const saved = Number(fs.readFileSync(portFile, "utf8"));
    if (saved >= 1024 && saved < 65536) preferred = saved;
  } catch {
    // No remembered port yet — start from the default.
  }
  for (let port = preferred; port < preferred + 20; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", onError);
          resolve();
        });
      });
      try {
        fs.writeFileSync(portFile, String(port));
      } catch {
        // Losing the remembered port only costs a re-pair; never fatal.
      }
      return port;
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error("no free loopback port for the renderer");
}

module.exports = { createRendererServer, listenStable, MIME };
