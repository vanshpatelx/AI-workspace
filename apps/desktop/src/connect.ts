import { TransportClient } from "@ai-workspace/transport";
import { DESKTOP_BANNER, renderWorkspaces } from "./index.js";

/**
 * Headless Desktop client — a debugging tool for the transport.
 *
 * Connects, authenticates, opens a workspace at AIW_PATH (default: cwd) and
 * prints whatever the Worker reports. The real UI drives the same protocol.
 */

const url = process.env.AIW_WORKER_URL ?? "ws://127.0.0.1:4501";
const token = process.env.AIW_TOKEN ?? "";
const workspacePath = process.env.AIW_PATH ?? process.cwd();

console.log(DESKTOP_BANNER);
console.log(`[desktop] connecting to ${url}`);

const client = new TransportClient(url, {
  onOpen() {
    console.log("[desktop] connected");
    client.send({ type: "hello", clientId: "desktop-cli", token });
  },
  onMessage(msg) {
    switch (msg.type) {
      case "auth.result":
        console.log(`[desktop] auth: ${msg.ok ? "ok" : `failed (${msg.reason ?? "?"})`}`);
        if (msg.ok) {
          client.send({ type: "workspace.open", requestId: "w1", path: workspacePath });
        }
        break;
      case "machine":
        console.log(
          `[desktop] machine: ${msg.machine.hostname} [${msg.machine.status}] agent=${msg.machine.agent ?? "none"}`,
        );
        break;
      case "workspaces":
        console.log("\n[desktop] === Workspaces ===");
        console.log(renderWorkspaces(msg.items));
        break;
      case "workspace.opened":
        console.log(`[desktop] opened workspace: ${msg.workspace.path}`);
        break;
      case "workspace.error":
        console.error(`[desktop] workspace error: ${msg.message}`);
        break;
      case "chat.delta":
        console.log(`[desktop] chat(${msg.sessionId}): ${msg.text}`);
        break;
      case "notification":
        console.log(
          `[desktop] notify(${msg.notification.level}/${msg.notification.kind}): ${msg.notification.title}`,
        );
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
