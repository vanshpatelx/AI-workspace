// Electron main process for the AI Workspace desktop app.
//
// The window hosts the same renderer served by `aiw ui` — the app is a pure
// control centre, so it holds no workspace state of its own. Workers are
// installed separately via the `aiw` CLI and reached over the transport.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");

/** In dev we point at Vite; in a packaged app we load the built renderer. */
const DEV_URL = process.env.AIW_DEV_URL ?? "http://127.0.0.1:5173";
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "AI Workspace",
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

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Keep external links in the user's browser, not in the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(() => {
  // A minimal menu still gives us copy/paste and devtools on macOS.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }]));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
