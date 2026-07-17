import { hostname } from "node:os";
import { PROTOCOL_VERSION, type WorkspaceSummary } from "@ai-workspace/protocol";
import { TransportServer } from "@ai-workspace/transport";

/**
 * Worker entrypoint.
 *
 * Runs on every machine. Hosts the transport server, tracks local workspace
 * state, and streams updates to any connected Desktop app. Agent adapters,
 * the session store, and resource sampling land in follow-up commits — for
 * now it reports a single self workspace and echoes chat back as a stub.
 */

const PORT = Number(process.env.AIW_WORKER_PORT ?? 4501);

function describeSelf(): WorkspaceSummary {
  return {
    workerId: "local",
    hostname: hostname(),
    status: "online",
    repo: process.cwd(),
    agent: null,
    activeTask: null,
    progress: null,
    cpu: null,
    mem: null,
  };
}

function main(): void {
  const server = new TransportServer(
    { port: PORT },
    {
      onConnect(conn) {
        console.log(`[worker] client ${conn.id} connected`);
        // Send current state immediately on connect.
        conn.send({ type: "workspaces", items: [describeSelf()] });
      },
      onMessage(conn, msg) {
        switch (msg.type) {
          case "hello":
            console.log(`[worker] hello from ${msg.clientId}`);
            break;
          case "subscribe":
            conn.send({ type: "workspaces", items: [describeSelf()] });
            break;
          case "chat.send":
            // Stub: echo until a real agent adapter is wired in.
            conn.send({ type: "chat.delta", sessionId: msg.sessionId, text: `echo: ${msg.text}` });
            break;
          default:
            break;
        }
      },
      onDisconnect(conn) {
        console.log(`[worker] client ${conn.id} disconnected`);
      },
      onError(err) {
        console.error("[worker] transport error:", err.message);
      },
    },
  );

  console.log(`ai-workspace worker (protocol v${PROTOCOL_VERSION})`);
  console.log(`[worker] listening on ws://127.0.0.1:${PORT}`);

  const shutdown = () => {
    console.log("\n[worker] shutting down");
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
