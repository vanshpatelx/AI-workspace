import { hostname } from "node:os";
import { exec } from "node:child_process";
import {
  createServer,
  request as httpRequest,
  type OutgoingHttpHeaders,
  type Server as HttpServer,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type AgentKind,
  type NotificationKind,
  type WorkerNotification,
  type WorkspaceSummary,
} from "@ai-workspace/protocol";
import { TransportServer, type TransportConnection } from "@ai-workspace/transport";
import type { WorkerConfig } from "./config.js";
import { KeepAwake } from "./keepawake.js";
import { agentLabel } from "./agents.js";
import { SessionStore } from "./session.js";
import { ApprovalManager, classifyCommand } from "./approvals.js";
import { TerminalManager } from "./terminals.js";
import { FileService } from "./files.js";
import { detectPreviewServers } from "./preview.js";
import { RelayLink } from "./relay-link.js";
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

  const files = new FileService(process.cwd());

  /**
   * Secret for the local HTTP surface, regenerated every run.
   *
   * The approval endpoint can allow or deny an agent's dangerous action, so it
   * must not be callable by any other process on the machine. The PreToolUse
   * hook inherits this via the environment when the Worker spawns the agent.
   */
  const hookToken = randomBytes(24).toString("hex");
  process.env.AIW_HOOK_TOKEN = hookToken;

  let notifySeq = 0;
  /** Raise a notification to every connected Desktop. */
  function notify(
    kind: NotificationKind,
    level: "info" | "warn" | "error",
    title: string,
    body?: string,
  ): void {
    const notification: WorkerNotification = {
      id: `n${++notifySeq}`,
      kind,
      level,
      title,
      at: Date.now(),
    };
    if (body) notification.body = body.slice(0, 400);
    server.broadcast({ type: "notification", notification });
  }

  const terminals = new TerminalManager(process.cwd(), {
    onData: (terminalId, data) => server.broadcast({ type: "terminal.output", terminalId, data }),
    onExit: (terminalId, code) => server.broadcast({ type: "terminal.exit", terminalId, code }),
  });

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
      notify("agent-error", "error", "No agent configured on this Worker");
      return;
    }
    const adapter = adapters.get(defaultAgent);
    if (!adapter) {
      notify("agent-error", "error", `No adapter for ${defaultAgent}`);
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
          onError: (message) => notify("agent-error", "error", "Agent error", message),
        },
      });
      sessions.setNativeSession(sessionId, result.nativeSessionId, Date.now());
      if (reply) {
        sessions.appendTurn(sessionId, { role: "agent", text: reply, at: Date.now() });
        notify("task-complete", "info", "Agent finished", reply);
      }
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
      notify("approval-waiting", "warn", `Approval needed: ${sensitive.summary}`, command);
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
      if (code === 0) {
        notify("command-complete", "info", `Finished: ${command}`, output);
      } else {
        // Covers the PRD's "test failures" / "build success" cases — a failing
        // test or build surfaces here with its exit code and output.
        notify("command-failed", "error", `Failed (exit ${code}): ${command}`, output);
      }
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
  /** Constant-time compare so a token can't be guessed byte-by-byte. */
  function tokenMatches(candidate: string | undefined, expected: string): boolean {
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const PREVIEW_COOKIE = "aiw_preview";

  function cookieValue(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  }

  function startApprovalEndpoint(): HttpServer {
    const http = createServer((req, res) => {
      // /preview/<port>/<rest> -> proxy to a local dev server. Framing the dev
      // server directly would only work when the Worker is the same machine as
      // the browser; proxying keeps previews working over Tailscale/relay.
      const rawUrl = req.url ?? "";
      const preview = rawUrl.split("?")[0]!.match(/^\/preview\/(\d+)(\/.*)?$/);
      if (preview) {
        const port = Number(preview[1]);
        const path = preview[2] || "/";

        // The proxy reaches anything listening on this machine, so it needs the
        // same pairing code as the transport. The Desktop passes it once in the
        // query string; we set a cookie so the framed page's own asset requests
        // (which carry no query string) stay authenticated.
        const query = rawUrl.includes("?") ? new URLSearchParams(rawUrl.split("?")[1]) : null;
        const supplied = query?.get("__aiw") ?? cookieValue(req.headers.cookie, PREVIEW_COOKIE);
        if (!tokenMatches(supplied, config.pairingCode)) {
          res.writeHead(401, { "content-type": "text/plain" });
          res.end("unauthorized: preview requires the Worker pairing code");
          return;
        }
        const setCookie: Record<string, string> =
          query?.get("__aiw") != null
            ? {
                "set-cookie": `${PREVIEW_COOKIE}=${config.pairingCode}; Path=/preview; HttpOnly; SameSite=Lax`,
              }
            : {};
        const upstream = httpRequest(
          { host: "127.0.0.1", port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
          (up) => {
            const headers: OutgoingHttpHeaders = { ...up.headers, ...setCookie };
            // Strip framing guards so the preview can render inside the app.
            delete headers["x-frame-options"];
            delete headers["content-security-policy"];
            res.writeHead(up.statusCode ?? 502, headers);
            up.pipe(res);
          },
        );
        upstream.on("error", (err) => {
          res.writeHead(502, { "content-type": "text/plain" });
          res.end(`preview upstream error: ${err.message}`);
        });
        req.pipe(upstream);
        return;
      }

      if (req.method !== "POST" || req.url !== "/approval") {
        res.writeHead(404).end();
        return;
      }

      // Only the hook we spawned knows this run's token. Without it, any local
      // process could approve an action on the user's behalf.
      if (!tokenMatches(req.headers["x-aiw-token"] as string | undefined, hookToken)) {
        // Loud on purpose: a denied hook looks identical to a user rejection
        // from the agent's side, so a misconfigured token must be visible here.
        console.error("[worker] rejected unauthenticated approval request");
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ approved: false, reason: "unauthorized" }));
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
          notify("approval-waiting", "warn", `Agent needs approval: ${sensitive.summary}`, command);

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
          case "terminal.start": {
            const err = terminals.start(msg.terminalId, msg.cols, msg.rows);
            if (err) {
              console.error(`[worker] ${err}`);
              notify("agent-error", "error", "Terminal failed to start", err);
              conn.send({ type: "terminal.exit", terminalId: msg.terminalId, code: null });
            } else {
              console.log(`[worker] terminal ${msg.terminalId} started`);
            }
            break;
          }
          case "terminal.input":
            terminals.write(msg.terminalId, msg.data);
            break;
          case "terminal.resize":
            terminals.resize(msg.terminalId, msg.cols, msg.rows);
            break;
          case "terminal.close":
            terminals.close(msg.terminalId);
            break;
          case "fs.list":
            files
              .list(msg.path)
              .then(({ path, entries }) =>
                conn.send({ type: "fs.listing", requestId: msg.requestId, path, entries }),
              )
              .catch((err: Error) =>
                conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
              );
            break;
          case "fs.read":
            files
              .read(msg.path)
              .then((file) => conn.send({ type: "fs.file", requestId: msg.requestId, ...file }))
              .catch((err: Error) =>
                conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
              );
            break;
          case "preview.scan":
            detectPreviewServers(config.port)
              .then((servers) => {
                console.log(`[worker] preview scan found ${servers.length} server(s)`);
                conn.send({
                  type: "preview.list",
                  requestId: msg.requestId,
                  servers,
                  proxyBase: `:${config.port + 1}/preview`,
                });
              })
              .catch((err: Error) =>
                conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
              );
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

  // Optional: also make this Worker reachable through a relay.
  const relay = config.relayUrl
    ? new RelayLink(config.relayUrl, config.workerId, server)
    : null;
  relay?.start();

  return {
    async stop() {
      approvals.rejectAll();
      terminals.closeAll();
      keepAwake.stop();
      relay?.stop();
      approvalHttp.close();
      await server.close();
    },
  };
}
