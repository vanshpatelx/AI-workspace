import { hostname } from "node:os";
import { PROTOCOL_VERSION, type WorkspaceSummary } from "@ai-workspace/protocol";
import { TransportServer } from "@ai-workspace/transport";
import type { WorkerConfig } from "./config.js";
import { KeepAwake } from "./keepawake.js";
import { agentLabel } from "./agents.js";

/**
 * Boots the Worker: transport server + keep-awake manager + workspace state.
 * Agent adapters and the session store land in follow-up commits — chat is
 * still echoed, but a task now toggles the keep-awake assertion for real.
 */
export interface RunningWorker {
  stop(): Promise<void>;
}

export function startWorker(config: WorkerConfig): RunningWorker {
  const keepAwake = new KeepAwake(config.keepAwake);
  keepAwake.start();

  function describeSelf(activeTask: string | null): WorkspaceSummary {
    return {
      workerId: config.workerId,
      hostname: hostname(),
      status: activeTask ? "busy" : "online",
      repo: process.cwd(),
      agent: config.agents[0] ?? null,
      activeTask,
      progress: null,
      cpu: null,
      mem: null,
    };
  }

  let currentTask: string | null = null;

  const server = new TransportServer(
    { port: config.port },
    {
      onConnect(conn) {
        console.log(`[worker] client ${conn.id} connected`);
        conn.send({ type: "workspaces", items: [describeSelf(currentTask)] });
      },
      onMessage(conn, msg) {
        switch (msg.type) {
          case "hello":
            console.log(`[worker] hello from ${msg.clientId}`);
            break;
          case "subscribe":
            conn.send({ type: "workspaces", items: [describeSelf(currentTask)] });
            break;
          case "chat.send": {
            // Stub agent turn: mark busy + hold keep-awake for the duration.
            currentTask = "responding";
            keepAwake.taskStarted();
            server.broadcast({ type: "workspaces", items: [describeSelf(currentTask)] });
            conn.send({ type: "chat.delta", sessionId: msg.sessionId, text: `echo: ${msg.text}` });
            currentTask = null;
            keepAwake.taskEnded();
            server.broadcast({ type: "workspaces", items: [describeSelf(currentTask)] });
            break;
          }
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

  const agents = config.agents.map(agentLabel).join(", ") || "none detected";
  console.log(`ai-workspace worker (protocol v${PROTOCOL_VERSION})`);
  console.log(`[worker] id=${config.workerId} agents=[${agents}] keepAwake=${config.keepAwake}`);
  console.log(`[worker] listening on ws://127.0.0.1:${config.port}`);
  console.log(`[worker] pairing code: ${config.pairingCode}`);

  return {
    async stop() {
      keepAwake.stop();
      await server.close();
    },
  };
}
