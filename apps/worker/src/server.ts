import { hostname } from "node:os";
import { exec } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { PROTOCOL_VERSION, type AgentKind, type WorkspaceSummary } from "@ai-workspace/protocol";
import { TransportServer, type TransportConnection } from "@ai-workspace/transport";
import type { WorkerConfig } from "./config.js";
import { KeepAwake } from "./keepawake.js";
import { agentLabel } from "./agents.js";
import { SessionStore } from "./session.js";
import { ApprovalManager, classifyCommand } from "./approvals.js";
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
  const approvals = new ApprovalManager();
  const adapters = buildAdapters(config);
  const defaultAgent: AgentKind | null = config.agents[0] ?? null;

  // A connection sees no state and can take no action until it authenticates
  // with the Worker's pairing code.
  const authed = new Set<string>();

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
    sessions.appendTurn(sessionId, { role: "user", text, at: now });

    activeTasks++;
    keepAwake.taskStarted();
    server.broadcast({ type: "workspaces", items: [describeSelf()] });

    let reply = "";
    try {
      const result = await adapter.runTurn({
        text,
        cwd: process.cwd(),
        resumeSessionId: record.nativeSessionId,
        handlers: {
          onDelta: (delta) => {
            reply += delta;
            conn.send({ type: "chat.delta", sessionId, text: delta });
          },
          onNotice: (notice) => conn.send({ type: "chat.delta", sessionId, text: `\n${notice}\n` }),
          onError: (message) => conn.send({ type: "notification", level: "error", text: message }),
        },
      });
      sessions.setNativeSession(sessionId, result.nativeSessionId, Date.now());
      if (reply) sessions.appendTurn(sessionId, { role: "agent", text: reply, at: Date.now() });
    } finally {
      activeTasks = Math.max(0, activeTasks - 1);
      keepAwake.taskEnded();
      server.broadcast({ type: "workspaces", items: [describeSelf()] });
    }
  }

  async function runShell(command: string, cwd: string): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve) => {
      exec(command, { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const output = (stdout + stderr).trim();
        const code = err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ code, output });
      });
    });
  }

  async function handleCommand(conn: TransportConnection, commandId: string, command: string): Promise<void> {
    const sensitive = classifyCommand(command);

    if (sensitive) {
      const { request, decision } = approvals.create(
        config.workerId,
        sensitive.kind,
        sensitive.summary,
        command,
        Date.now(),
      );
      // Broadcast so any connected Desktop can approve.
      server.broadcast({ type: "approval.request", request });
      console.log(`[worker] approval required (${sensitive.kind}): ${command}`);

      const approved = await decision;
      server.broadcast({ type: "approval.resolved", requestId: request.id, approved });

      if (!approved) {
        conn.send({
          type: "command.result",
          commandId,
          code: null,
          output: `Rejected by user: ${sensitive.summary.toLowerCase()}`,
          approved: false,
        });
        return;
      }
    }

    activeTasks++;
    keepAwake.taskStarted();
    server.broadcast({ type: "workspaces", items: [describeSelf()] });
    try {
      const { code, output } = await runShell(command, process.cwd());
      conn.send({ type: "command.result", commandId, code, output, approved: true });
    } finally {
      activeTasks = Math.max(0, activeTasks - 1);
      keepAwake.taskEnded();
      server.broadcast({ type: "workspaces", items: [describeSelf()] });
    }
  }

  /**
   * Loopback-only endpoint used by the agent's PreToolUse hook. The agent asks
   * "may I run this?"; safe commands are auto-allowed, sensitive ones surface
   * in the Approval Center and block until the user decides.
   */
  function startApprovalEndpoint(): HttpServer {
    const http = createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/approval") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        const reply = (approved: boolean, reason?: string) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ approved, reason }));
        };
        try {
          const { toolName = "", command = "" } = JSON.parse(body || "{}");
          const sensitive = classifyCommand(command);
          if (!sensitive) return reply(true);

          const { request, decision } = approvals.create(
            config.workerId,
            sensitive.kind,
            `Agent wants to: ${sensitive.summary.toLowerCase()}`,
            command || toolName,
            Date.now(),
          );
          console.log(`[worker] agent approval required (${sensitive.kind}): ${command}`);
          server.broadcast({ type: "approval.request", request });

          const approved = await decision;
          server.broadcast({ type: "approval.resolved", requestId: request.id, approved });
          reply(approved, approved ? undefined : "Rejected by user in AI Workspace");
        } catch (err) {
          reply(false, `approval endpoint error: ${(err as Error).message}`);
        }
      });
    });
    http.listen(config.port + 1, "127.0.0.1");
    return http;
  }

  const approvalHttp = startApprovalEndpoint();

  server = new TransportServer(
    { port: config.port },
    {
      onConnect(conn) {
        console.log(`[worker] client ${conn.id} connected (awaiting auth)`);
        // No state is sent until the client authenticates.
      },
      onMessage(conn, msg) {
        // Gate: only `hello` is allowed before authentication.
        if (!authed.has(conn.id) && msg.type !== "hello") {
          conn.send({ type: "auth.result", ok: false, reason: "not authenticated" });
          conn.close();
          return;
        }

        switch (msg.type) {
          case "hello": {
            if (msg.token !== config.pairingCode) {
              console.log(`[worker] auth REJECTED for ${msg.clientId}`);
              conn.send({ type: "auth.result", ok: false, reason: "invalid pairing code" });
              conn.close();
              return;
            }
            authed.add(conn.id);
            console.log(`[worker] auth OK for ${msg.clientId}`);
            conn.send({ type: "auth.result", ok: true });
            conn.send({ type: "workspaces", items: [describeSelf()] });
            // Rehydrate persisted conversations so the Desktop reconnects with
            // full context instead of an empty chat.
            for (const s of sessions.list()) {
              if (s.messages.length > 0) {
                conn.send({ type: "chat.history", sessionId: s.sessionId, messages: s.messages });
              }
            }
            for (const request of approvals.list()) conn.send({ type: "approval.request", request });
            break;
          }
          case "subscribe":
            conn.send({ type: "workspaces", items: [describeSelf()] });
            break;
          case "chat.send":
            console.log(`[worker] chat(${msg.sessionId}): ${msg.text.slice(0, 60)}`);
            void handleChat(conn, msg.sessionId, msg.text);
            break;
          case "command.run":
            console.log(`[worker] command(${msg.commandId}): ${msg.command.slice(0, 80)}`);
            void handleCommand(conn, msg.commandId, msg.command);
            break;
          case "approval.resolve":
            if (!approvals.resolve(msg.requestId, msg.approved)) {
              console.log(`[worker] approval ${msg.requestId} already resolved/unknown`);
            }
            break;
          default:
            break;
        }
      },
      onDisconnect(conn) {
        authed.delete(conn.id);
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

  console.log(`[worker] approval endpoint on http://127.0.0.1:${config.port + 1}/approval`);

  return {
    async stop() {
      approvals.rejectAll();
      keepAwake.stop();
      approvalHttp.close();
      await server.close();
    },
  };
}
