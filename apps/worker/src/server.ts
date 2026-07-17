import { hostname } from "node:os";
import { PROTOCOL_VERSION, type AgentKind, type WorkspaceSummary } from "@ai-workspace/protocol";
import { TransportServer, type TransportConnection } from "@ai-workspace/transport";
import type { WorkerConfig } from "./config.js";
import { KeepAwake } from "./keepawake.js";
import { agentLabel } from "./agents.js";
import { SessionStore } from "./session.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import type { AgentAdapter } from "./adapters/types.js";

/**
 * Boots the Worker: transport server + keep-awake + session store + agent
 * adapters. `chat.send` now drives a real agent, streaming its output back
 * over `chat.delta` and holding the keep-awake assertion for the turn.
 */
export interface RunningWorker {
  stop(): Promise<void>;
}

function buildAdapters(config: WorkerConfig): Map<AgentKind, AgentAdapter> {
  const adapters = new Map<AgentKind, AgentAdapter>();
  if (config.agents.includes("claude-code")) {
    adapters.set("claude-code", new ClaudeCodeAdapter());
  }
  // Codex / Gemini / OpenHands / Roo adapters register here as they land.
  return adapters;
}

export function startWorker(config: WorkerConfig): RunningWorker {
  const keepAwake = new KeepAwake(config.keepAwake);
  keepAwake.start();

  const sessions = new SessionStore();
  const adapters = buildAdapters(config);
  const defaultAgent: AgentKind | null = config.agents[0] ?? null;

  let activeTasks = 0;

  function describeSelf(): WorkspaceSummary {
    return {
      workerId: config.workerId,
      hostname: hostname(),
      status: activeTasks > 0 ? "busy" : "online",
      repo: process.cwd(),
      agent: defaultAgent,
      activeTask: activeTasks > 0 ? "agent running" : null,
      progress: null,
      cpu: null,
      mem: null,
    };
  }

  let server: TransportServer;

  async function handleChat(conn: TransportConnection, sessionId: string, text: string): Promise<void> {
    if (!defaultAgent) {
      conn.send({ type: "notification", level: "error", text: "No agent configured on this Worker." });
      return;
    }
    const adapter = adapters.get(defaultAgent);
    if (!adapter) {
      conn.send({ type: "notification", level: "error", text: `No adapter for ${defaultAgent}.` });
      return;
    }

    const now = Date.now();
    const record = sessions.ensure(sessionId, defaultAgent, now);

    activeTasks++;
    keepAwake.taskStarted();
    server.broadcast({ type: "workspaces", items: [describeSelf()] });

    try {
      const result = await adapter.runTurn({
        text,
        cwd: process.cwd(),
        resumeSessionId: record.nativeSessionId,
        handlers: {
          onDelta: (delta) => conn.send({ type: "chat.delta", sessionId, text: delta }),
          onNotice: (notice) => conn.send({ type: "chat.delta", sessionId, text: `\n${notice}\n` }),
          onError: (message) => conn.send({ type: "notification", level: "error", text: message }),
        },
      });
      sessions.setNativeSession(sessionId, result.nativeSessionId, Date.now());
    } finally {
      activeTasks = Math.max(0, activeTasks - 1);
      keepAwake.taskEnded();
      server.broadcast({ type: "workspaces", items: [describeSelf()] });
    }
  }

  server = new TransportServer(
    { port: config.port },
    {
      onConnect(conn) {
        console.log(`[worker] client ${conn.id} connected`);
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
            console.log(`[worker] chat(${msg.sessionId}): ${msg.text.slice(0, 60)}`);
            void handleChat(conn, msg.sessionId, msg.text);
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
