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
  type MachineSummary,
  type NotificationKind,
  type TurnUsage,
  type WorkerNotification,
} from "@ai-workspace/protocol";
import { TransportServer, type TransportConnection } from "@ai-workspace/transport";
import type { WorkerConfig } from "./config.js";
import { KeepAwake } from "./keepawake.js";
import { agentLabel } from "./agents.js";
import { SessionStore } from "./session.js";
import { ApprovalManager, classifyCommand } from "./approvals.js";
import { TerminalManager } from "./terminals.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { detectPreviewServers, reloadMetro } from "./preview.js";
import { discoverProjects } from "./discovery.js";
import { ParkedTasks } from "./parked.js";
import { ScheduledPrompts } from "./schedule.js";
import { formatWait } from "./ratelimit.js";
import { RelayLink } from "./relay-link.js";
import { log } from "./log.js";
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

/** Human-readable WebSocket close codes, for diagnosing dropped Desktops. */
function describeCloseCode(code?: number): string {
  switch (code) {
    case 1000:
      return "normal close";
    case 1001:
      return "going away";
    case 1005:
      return "no status (closed by client)";
    case 1006:
      return "abnormal — connection lost without a close frame";
    case 1011:
      return "server error";
    case 1012:
      return "restarting";
    default:
      return "unknown";
  }
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

  const workspaces = new WorkspaceRegistry();

  /**
   * Prompts queued to run later. A scheduled prompt with no session starts a
   * fresh one, so morning results are not buried in yesterday's thread.
   */
  const schedule = new ScheduledPrompts((prompt) => {
    const sessionId = prompt.sessionId ?? `s_${Math.random().toString(36).slice(2, 10)}`;
    workspaces.addSession(prompt.workspaceId, sessionId);
    log.info(`running scheduled prompt in ${prompt.workspaceId}`);
    notify("info", "info", "Scheduled task started", prompt.text.slice(0, 120));
    void handleChat(null, prompt.workspaceId, sessionId, prompt.text);
    server.broadcast({ type: "schedule.list", prompts: schedule.list() });
  });

  /**
   * Turns waiting on a usage limit. Resuming replays the prompt through the
   * ordinary chat path, so a retried turn behaves exactly like a fresh one.
   */
  const parked = new ParkedTasks((task) => {
    log.info(`resuming parked task in ${task.workspaceId}`);
    notify("info", "info", "Resuming after usage limit", task.text.slice(0, 120));
    void handleChat(null, task.workspaceId, task.sessionId, task.text);
    server.broadcast({ type: "tasks.parked", tasks: parked.list() });
  });

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

  const terminals = new TerminalManager({
    onData: (terminalId, data) => server.broadcast({ type: "terminal.output", terminalId, data }),
    onExit: (terminalId, code) => server.broadcast({ type: "terminal.exit", terminalId, code }),
  });

  let activeTasks = 0;
  /** workspaceId -> what it is currently doing, for the dashboard. */
  const activeByWorkspace = new Map<string, string>();

  function describeMachine(): MachineSummary {
    return {
      workerId: config.workerId,
      hostname: hostname(),
      status: activeTasks > 0 ? "busy" : "online",
      agent: defaultAgent,
      workspaceCount: workspaces.ids().length,
      cpu: null,
      mem: null,
    };
  }

  let server: TransportServer;

  /** Push machine + workspace state to every connected Desktop. */
  async function broadcastState(): Promise<void> {
    server.broadcast({ type: "machine", machine: describeMachine() });
    server.broadcast({ type: "workspaces", items: await workspaces.list(activeByWorkspace) });
  }

  function markBusy(workspaceId: string, what: string | null): void {
    if (what) activeByWorkspace.set(workspaceId, what);
    else activeByWorkspace.delete(workspaceId);
    void broadcastState();
  }

  async function handleChat(
    /** null when a parked task resumes itself with nobody watching. */
    conn: TransportConnection | null,
    workspaceId: string,
    sessionId: string,
    text: string,
  ): Promise<void> {
    // Broadcast when there is no originating client, so every Desktop sees it.
    const emit = (msg: Parameters<TransportConnection["send"]>[0]) =>
      conn ? conn.send(msg) : server.broadcast(msg);
    if (!defaultAgent) {
      notify("agent-error", "error", "No agent configured on this Worker");
      return;
    }
    const adapter = adapters.get(defaultAgent);
    if (!adapter) {
      notify("agent-error", "error", `No adapter for ${defaultAgent}`);
      return;
    }

    let cwd: string;
    try {
      cwd = workspaces.pathOf(workspaceId);
    } catch (err) {
      notify("agent-error", "error", (err as Error).message);
      return;
    }

    const now = Date.now();
    const record = sessions.ensure(sessionId, workspaceId, defaultAgent, now);
    workspaces.addSession(workspaceId, sessionId);
    sessions.appendTurn(sessionId, { role: "user", text, at: now });

    activeTasks++;
    keepAwake.taskStarted();
    markBusy(workspaceId, "agent running");

    let reply = "";
    let lastUsage: TurnUsage | undefined;
    try {
      const result = await adapter.runTurn({
        // The agent runs in the workspace's directory, not the Worker's.
        text,
        cwd,
        resumeSessionId: record.nativeSessionId,
        handlers: {
          onDelta: (delta) => {
            // Each delta is a complete text block from the agent. Joining them
            // bare runs a paragraph into the table that follows it, which then
            // renders as raw pipes once the transcript is replayed.
            reply = reply ? `${reply}\n\n${delta}` : delta;
            emit({ type: "chat.delta", sessionId, text: delta });
          },
          onReasoning: (text) => {
            if (!text.trim()) return; // never persist an empty reasoning turn
            sessions.appendTurn(sessionId, { role: "reasoning", text, at: Date.now() });
            emit({ type: "chat.reasoning", sessionId, text });
          },
          onTool: (toolId, tool, target) => {
            // Recorded as its own turn so the transcript shows what the agent
            // did, not just what it said.
            sessions.appendTurn(sessionId, {
              role: "tool",
              text: "",
              tool,
              target,
              toolId,
              at: Date.now(),
            });
            emit({ type: "chat.tool", sessionId, toolId, tool, target });
          },
          onTodos: (todos) => {
            emit({ type: "chat.todos", sessionId, todos });
          },
          onToolResult: (toolId, output, isError) => {
            sessions.attachToolResult(sessionId, toolId, output, isError);
            emit({ type: "chat.tool.result", sessionId, toolId, output, isError });
          },
          onUsage: (usage) => {
            lastUsage = usage;
            emit({ type: "chat.usage", sessionId, usage });
          },
          onNotice: (notice) => emit({ type: "chat.delta", sessionId, text: `\n_${notice}_\n` }),
          onRateLimited: (resumeAt, reason) => {
            const task = parked.park({ workspaceId, sessionId, text, resumeAt, reason });
            const wait = formatWait(resumeAt - Date.now());
            log.warn(`${reason} — parked, resuming in ${wait}`);
            notify("info", "warn", `Paused: ${reason}`, `Resuming automatically in ${wait}`);
            server.broadcast({ type: "tasks.parked", tasks: parked.list() });
          },
          onError: (message) => notify("agent-error", "error", "Agent error", message),
        },
      });
      sessions.setNativeSession(sessionId, result.nativeSessionId, Date.now());
      if (reply) {
        sessions.appendTurn(sessionId, {
          role: "agent",
          text: reply,
          at: Date.now(),
          ...(lastUsage ? { usage: lastUsage } : {}),
        });
        notify("task-complete", "info", "Agent finished", reply);
      }
    } finally {
      activeTasks = Math.max(0, activeTasks - 1);
      keepAwake.taskEnded();
      markBusy(workspaceId, null);
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

  async function handleCommand(
    conn: TransportConnection,
    workspaceId: string,
    commandId: string,
    command: string,
  ): Promise<void> {
    let cwd: string;
    try {
      cwd = workspaces.pathOf(workspaceId);
    } catch (err) {
      conn.send({
        type: "command.result",
        commandId,
        code: null,
        output: (err as Error).message,
        approved: false,
      });
      return;
    }

    const sensitive = classifyCommand(command);

    if (sensitive) {
      const { request, decision } = approvals.create(
        config.workerId,
        sensitive.kind,
        sensitive.summary,
        command,
        Date.now(),
        workspaceId,
      );
      // Broadcast so any connected Desktop can approve.
      server.broadcast({ type: "approval.request", request });
      notify("approval-waiting", "warn", `Approval needed: ${sensitive.summary}`, command);
      log.approval(sensitive.kind, command, false);

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
    markBusy(workspaceId, `running: ${command.slice(0, 40)}`);
    try {
      const { code, output } = await runShell(command, cwd);
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
      markBusy(workspaceId, null);
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
        log.error("rejected unauthenticated approval request");
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
          log.approval(sensitive.kind, command, true);
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
        log.client("connected", `${conn.id} awaiting auth`);
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
              log.error(`auth rejected for ${msg.clientId}`);
              conn.send({ type: "auth.result", ok: false, reason: "invalid pairing code" });
              conn.close();
              return;
            }
            authed.add(conn.id);
            log.client("authed", msg.clientId);
            conn.send({ type: "auth.result", ok: true });
            void broadcastState();
            // Rehydrate persisted conversations so the Desktop reconnects with
            // full context instead of an empty chat.
            for (const s of sessions.list()) {
              if (s.messages.length > 0) {
                conn.send({ type: "chat.history", sessionId: s.sessionId, messages: s.messages });
              }
            }
            for (const request of approvals.list()) conn.send({ type: "approval.request", request });
            conn.send({ type: "tasks.parked", tasks: parked.list() });
            conn.send({ type: "schedule.list", prompts: schedule.list() });
            break;
          }
          case "subscribe":
            void broadcastState();
            break;
          case "workspace.open": {
            const requestId = msg.requestId;
            try {
              const opened = workspaces.open(msg.path);
              log.workspace("opened", opened.path);
              void workspaces
                .list(activeByWorkspace)
                .then(async (all) => {
                  const listed = all.find((w) => w.workspaceId === opened.workspaceId);
                  if (listed) conn.send({ type: "workspace.opened", requestId, workspace: listed });
                  await broadcastState();
                })
                .catch(() => {});
            } catch (err) {
              conn.send({
                type: "workspace.error",
                requestId,
                message: (err as Error).message,
              });
            }
            break;
          }
          case "workspace.close":
            workspaces.close(msg.workspaceId);
            log.workspace("closed", msg.workspaceId);
            void broadcastState();
            break;
          case "session.create": {
            // Several conversations can run in one workspace at once.
            const sessionId = `s_${Math.random().toString(36).slice(2, 10)}`;
            workspaces.addSession(msg.workspaceId, sessionId);
            conn.send({
              type: "session.created",
              requestId: msg.requestId,
              workspaceId: msg.workspaceId,
              sessionId,
            });
            void broadcastState();
            break;
          }
          case "chat.send":
            log.chat(`${msg.workspaceId}/${msg.sessionId}`, msg.text);
            void handleChat(conn, msg.workspaceId, msg.sessionId, msg.text);
            break;
          case "command.run":
            log.command(msg.workspaceId, msg.command);
            void handleCommand(conn, msg.workspaceId, msg.commandId, msg.command);
            break;
          case "approval.resolve":
            if (!approvals.resolve(msg.requestId, msg.approved)) {
              log.info(`approval ${msg.requestId} already resolved`);
            }
            break;
          case "terminal.start": {
            let cwd: string;
            try {
              cwd = workspaces.pathOf(msg.workspaceId);
            } catch (e) {
              conn.send({ type: "terminal.exit", terminalId: msg.terminalId, code: null });
              break;
            }
            // The UI re-sends start on remount, so only report a real spawn —
            // otherwise the log fills with "started" for one terminal.
            const existed = terminals.has(msg.terminalId);
            const err = terminals.start(msg.terminalId, cwd, msg.cols, msg.rows);
            if (err) {
              log.error(err);
              notify("agent-error", "error", "Terminal failed to start", err);
              conn.send({ type: "terminal.exit", terminalId: msg.terminalId, code: null });
            } else if (!existed) {
              log.terminal("started", msg.terminalId);
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
            // Each workspace has its own file service, so traversal protection
            // is scoped to that project's root.
            try {
              workspaces
                .filesFor(msg.workspaceId)
                .list(msg.path)
                .then(({ path, entries }) =>
                  conn.send({ type: "fs.listing", requestId: msg.requestId, path, entries }),
                )
                .catch((err: Error) =>
                  conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
                );
            } catch (err) {
              conn.send({
                type: "fs.error",
                requestId: msg.requestId,
                message: (err as Error).message,
              });
            }
            break;
          case "fs.read":
            try {
              workspaces
                .filesFor(msg.workspaceId)
                .read(msg.path)
                .then((file) => conn.send({ type: "fs.file", requestId: msg.requestId, ...file }))
                .catch((err: Error) =>
                  conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
                );
            } catch (err) {
              conn.send({
                type: "fs.error",
                requestId: msg.requestId,
                message: (err as Error).message,
              });
            }
            break;
          case "fs.write":
            try {
              workspaces
                .filesFor(msg.workspaceId)
                .write(msg.path, msg.content)
                .then(({ path, bytes }) => {
                  log.info(`saved ${path} (${bytes} bytes)`);
                  conn.send({ type: "fs.written", requestId: msg.requestId, path, bytes });
                })
                .catch((err: Error) =>
                  conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
                );
            } catch (err) {
              conn.send({
                type: "fs.error",
                requestId: msg.requestId,
                message: (err as Error).message,
              });
            }
            break;
          case "schedule.add": {
            try {
              // Validate the workspace now rather than failing at fire time,
              // hours later, with nobody watching.
              workspaces.pathOf(msg.workspaceId);
              const prompt = schedule.add({
                workspaceId: msg.workspaceId,
                sessionId: msg.sessionId,
                text: msg.text,
                runAt: msg.runAt,
              });
              log.info(
                `scheduled a prompt for ${new Date(prompt.runAt).toLocaleString()}`,
              );
              server.broadcast({ type: "schedule.list", prompts: schedule.list() });
            } catch (err) {
              conn.send({
                type: "fs.error",
                requestId: msg.requestId,
                message: (err as Error).message,
              });
            }
            break;
          }
          case "schedule.cancel":
            if (schedule.cancel(msg.promptId)) {
              log.info(`scheduled prompt ${msg.promptId} cancelled`);
              server.broadcast({ type: "schedule.list", prompts: schedule.list() });
            }
            break;
          case "schedule.runNow":
            if (schedule.runNow(msg.promptId)) {
              server.broadcast({ type: "schedule.list", prompts: schedule.list() });
            }
            break;
          case "task.resumeNow":
            if (parked.resumeNow(msg.taskId)) {
              server.broadcast({ type: "tasks.parked", tasks: parked.list() });
            }
            break;
          case "task.cancel":
            if (parked.cancel(msg.taskId)) {
              log.info(`parked task ${msg.taskId} cancelled`);
              server.broadcast({ type: "tasks.parked", tasks: parked.list() });
            }
            break;
          case "preview.reload":
            reloadMetro(msg.port)
              .then((error) => {
                if (!error) log.preview(1);
                conn.send({ type: "preview.reloaded", requestId: msg.requestId, error });
              })
              .catch((err: Error) =>
                conn.send({
                  type: "preview.reloaded",
                  requestId: msg.requestId,
                  error: err.message,
                }),
              );
            break;
          case "discover.projects":
            discoverProjects()
              .then((projects) => {
                log.info(`discovered ${projects.length} past project(s)`);
                conn.send({ type: "discover.result", requestId: msg.requestId, projects });
              })
              .catch((err: Error) =>
                conn.send({ type: "fs.error", requestId: msg.requestId, message: err.message }),
              );
            break;
          case "session.adopt": {
            // Bind a new local session to an existing agent conversation, so
            // the next message resumes it with all of its context.
            const sessionId = `s_${Math.random().toString(36).slice(2, 10)}`;
            const agent = defaultAgent ?? "claude-code";
            sessions.ensure(sessionId, msg.workspaceId, agent, Date.now());
            sessions.setNativeSession(sessionId, msg.nativeSessionId, Date.now());
            workspaces.addSession(msg.workspaceId, sessionId);
            log.info(`adopted past session ${msg.nativeSessionId.slice(0, 8)}`);
            conn.send({
              type: "session.created",
              requestId: msg.requestId,
              workspaceId: msg.workspaceId,
              sessionId,
            });
            void broadcastState();
            break;
          }
          case "preview.scan":
            detectPreviewServers(config.port)
              .then((servers) => {
                log.preview(servers.length);
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
      onDisconnect(conn, code, reason) {
        authed.delete(conn.id);
        // The close code says a lot: 1000/1001 is a normal navigate-away or
        // reload, 1006 means the connection dropped without a close frame.
        const detail = code === 1001 ? "page navigated/reloaded" : describeCloseCode(code);
        log.client("gone", `${conn.id} · ${detail}${reason ? ` · ${reason}` : ""}`);
      },
      onError(err) {
        log.error(`transport: ${err.message}`);
      },
    },
  );

  // Re-arm parked work only once the transport exists: a task whose window
  // already passed fires synchronously and broadcasts immediately.
  if (parked.list().length > 0) {
    log.info(`${parked.list().length} task(s) waiting on quota`);
  }
  parked.restore();
  if (schedule.list().length > 0) {
    log.info(`${schedule.list().length} scheduled prompt(s) queued`);
  }
  schedule.restore();

  const agents = config.agents.map(agentLabel).join(", ") || "none detected";
  log.banner({
    version: PROTOCOL_VERSION,
    workerId: config.workerId,
    agents,
    keepAwake: config.keepAwake,
    url: `ws://127.0.0.1:${config.port}`,
    approvalUrl: `http://127.0.0.1:${config.port + 1}/approval`,
    pairingCode: config.pairingCode,
  });


  // Optional: also make this Worker reachable through a relay.
  const relay = config.relayUrl
    ? new RelayLink(config.relayUrl, config.workerId, server)
    : null;
  relay?.start();

  return {
    async stop() {
      approvals.rejectAll();
      parked.stopAll();
      schedule.stopAll();
      terminals.closeAll();
      keepAwake.stop();
      relay?.stop();
      approvalHttp.close();
      await server.close();
    },
  };
}
