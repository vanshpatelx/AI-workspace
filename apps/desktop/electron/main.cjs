// Electron main process for the Otter desktop app.
//
// The window hosts the same renderer served by `aiw ui` — the app is a pure
// control centre, so it holds no workspace state of its own. Workers are
// installed separately via the `aiw` CLI and reached over the transport.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");
const { createRendererServer, listenStable } = require("./renderer-server.cjs");

/** In dev we point at Vite; in a packaged app we serve the built renderer. */
const DEV_URL = process.env.AIW_DEV_URL ?? "http://127.0.0.1:5173";
// AIW_FORCE_PROD lets the packaged code path be exercised from an unpackaged
// checkout, so the http-served renderer can be tested without building a DMG.
const isDev = !app.isPackaged && !process.env.AIW_FORCE_PROD;

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Otter",
    backgroundColor: "#0a0a0b",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      // The renderer only talks to Workers over WebSocket/HTTP; it never needs
      // Node, so keep the standard isolation guarantees on.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(url);

  // Keep external links in the user's browser, not in the app shell.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  return win;
}

// Lets a test instance use an isolated profile so its single-instance lock and
// renderer port don't collide with a copy the user already has running.
if (process.env.AIW_USER_DATA) app.setPath("userData", process.env.AIW_USER_DATA);

// One instance only, so the fixed renderer port is never contended and two
// windows don't fight over the same Worker connections.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // A minimal menu still gives us copy/paste and devtools on macOS.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }]),
    );

    let url = DEV_URL;
    if (!isDev) {
      const server = createRendererServer(path.join(__dirname, "..", "dist"));
      const port = await listenStable(server, path.join(app.getPath("userData"), "renderer-port"));
      url = `http://127.0.0.1:${port}`;
    }

    createWindow(url);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
