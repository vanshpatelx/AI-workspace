import { WebSocketServer, WebSocket } from "ws";
import { PROTOCOL_VERSION } from "@ai-workspace/protocol";

/**
 * Optional relay.
 *
 * Pairs a Worker with a Desktop when they cannot reach each other directly,
 * and forwards frames between them. It is deliberately ignorant of the
 * application protocol: after the first control message it treats everything
 * as opaque bytes, which is also what lets end-to-end encryption be added
 * later without touching this server.
 *
 * STATELESS BY DESIGN. Nothing is written to disk, and nothing is buffered
 * beyond the sockets themselves — no repositories, prompts, conversations,
 * terminal history, media, files or databases.
 *
 *   Worker:  ws://relay:8787/worker?id=<workerId>
 *   Desktop: ws://relay:8787/client?id=<workerId>
 */

const PORT = Number(process.env.AIW_RELAY_PORT ?? 8787);

interface Pairing {
  worker: WebSocket;
  client: WebSocket | null;
}

/** workerId -> live sockets. Entries exist only while a Worker is connected. */
const pairings = new Map<string, Pairing>();

function workerIdFrom(url: string | undefined): string | null {
  const id = new URLSearchParams((url ?? "").split("?")[1] ?? "").get("id");
  return id && id.trim() ? id.trim() : null;
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket, req) => {
  const path = (req.url ?? "").split("?")[0];
  const workerId = workerIdFrom(req.url);

  if (!workerId) {
    socket.close(1008, "missing worker id");
    return;
  }

  if (path === "/worker") {
    // A reconnecting Worker replaces any stale pairing for the same id.
    pairings.get(workerId)?.worker.close(1012, "replaced by a new worker connection");
    const pairing: Pairing = { worker: socket, client: null };
    pairings.set(workerId, pairing);
    console.log(`[relay] worker registered: ${workerId}`);

    socket.on("message", (data, isBinary) => {
      // Opaque passthrough — the relay never parses application frames.
      pairing.client?.send(data, { binary: isBinary });
    });
    socket.on("close", () => {
      if (pairings.get(workerId) === pairing) pairings.delete(workerId);
      pairing.client?.close(1001, "worker disconnected");
      console.log(`[relay] worker gone: ${workerId}`);
    });
    socket.on("error", () => socket.close());
    return;
  }

  if (path === "/client") {
    const pairing = pairings.get(workerId);
    if (!pairing) {
      socket.close(1011, "no worker registered with that id");
      return;
    }
    // One Desktop per Worker: the app protocol has no client multiplexing, so
    // a second attach would see the first one's responses.
    if (pairing.client && pairing.client.readyState === WebSocket.OPEN) {
      socket.close(1013, "worker already has a connected client");
      return;
    }
    pairing.client = socket;
    console.log(`[relay] client attached: ${workerId}`);

    socket.on("message", (data, isBinary) => {
      if (pairing.worker.readyState === WebSocket.OPEN) {
        pairing.worker.send(data, { binary: isBinary });
      }
    });
    socket.on("close", () => {
      if (pairing.client === socket) pairing.client = null;
      console.log(`[relay] client detached: ${workerId}`);
    });
    socket.on("error", () => socket.close());
    return;
  }

  socket.close(1008, "unknown path");
});

wss.on("listening", () => {
  console.log(`ai-workspace relay (protocol v${PROTOCOL_VERSION}) — stateless`);
  console.log(`[relay] listening on ws://0.0.0.0:${PORT}`);
  console.log("[relay] this server forwards frames it cannot read; it stores nothing");
});

const shutdown = () => {
  console.log("\n[relay] shutting down");
  wss.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
