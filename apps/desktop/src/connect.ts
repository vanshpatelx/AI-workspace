import { TransportClient } from "@ai-workspace/transport";
import { DESKTOP_BANNER, renderDashboard } from "./index.js";

/**
 * Headless Desktop client.
 *
 * Connects to a Worker, subscribes, and prints the dashboard as state
 * arrives. The Electron + shadcn/ui renderer will drive this exact
 * TransportClient — this entry just proves the link end-to-end.
 */

const url = process.env.AIW_WORKER_URL ?? "ws://127.0.0.1:4501";

console.log(DESKTOP_BANNER);
console.log(`[desktop] connecting to ${url}`);

const client = new TransportClient(url, {
  onOpen() {
    console.log("[desktop] connected");
    client.send({ type: "hello", clientId: "desktop-cli" });
    client.send({ type: "subscribe", workerId: "local" });
    client.send({ type: "chat.send", sessionId: "s1", text: "ping from desktop" });
  },
  onMessage(msg) {
    switch (msg.type) {
      case "workspaces":
        console.log("\n[desktop] === Dashboard ===");
        console.log(renderDashboard(msg.items));
        break;
      case "chat.delta":
        console.log(`[desktop] chat(${msg.sessionId}): ${msg.text}`);
        break;
      case "notification":
        console.log(`[desktop] notify(${msg.level}): ${msg.text}`);
        break;
      default:
        break;
    }
  },
  onClose() {
    console.log("[desktop] disconnected (will retry)");
  },
  onError(err) {
    console.error("[desktop] error:", err.message);
  },
});

client.connect();

process.on("SIGINT", () => {
  client.close();
  process.exit(0);
});
