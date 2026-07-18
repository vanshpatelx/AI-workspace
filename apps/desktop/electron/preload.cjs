// Preload runs with contextIsolation on, so nothing Node-ish leaks into the
// renderer. The UI talks to Workers over WebSocket/HTTP only; this bridge
// exists purely so the page can tell it's running inside the desktop shell.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("aiw", {
  isDesktopApp: true,
  platform: process.platform,
  version: process.versions.electron,
});
