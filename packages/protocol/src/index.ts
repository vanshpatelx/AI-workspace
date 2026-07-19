/**
 * Shared wire protocol between the Desktop App, Worker, and Relay.
 *
 * Every message is a discriminated union on `type`. The Relay only ever
 * forwards these frames end-to-end encrypted; it never inspects payloads.
 */

export type AgentKind =
  | "claude-code"
  | "codex-cli"
  | "gemini-cli"
  | "openhands"
  | "roo-code";

export type WorkerStatus = "online" | "offline" | "busy";

/**
 * A machine running a Worker. One per Worker — the machine is the connection,
 * not the unit of work.
 */
export interface MachineSummary {
  workerId: string;
  hostname: string;
  status: WorkerStatus;
  agent: AgentKind | null;
  /** Number of workspaces currently open on this machine. */
  workspaceCount: number;
  cpu: number | null; // 0..1
  mem: number | null; // 0..1
}

/**
 * A project directory opened on a Worker. A machine hosts many of these, each
 * with its own chat sessions, terminals and file tree — this is the unit the
 * user actually works in.
 */
export interface Workspace {
  workspaceId: string;
  /** Absolute path on the Worker's machine. */
  path: string;
  /** Display name, usually the directory basename. */
  name: string;
  /** Current git branch, when the path is a repo. */
  branch: string | null;
  activeTask: string | null;
  /** Chat session ids belonging to this workspace. */
  sessionIds: string[];
  openedAt: number;
}

/** Why the Worker raised a notification. */
export type NotificationKind =
  | "task-complete"
  | "command-complete"
  | "command-failed"
  | "approval-waiting"
  | "agent-error"
  | "info";

export interface WorkerNotification {
  id: string;
  kind: NotificationKind;
  level: "info" | "warn" | "error";
  title: string;
  /** Optional detail line (command output snippet, error text, ...). */
  body?: string;
  at: number;
}

/** A local dev server detected on the Worker's machine. */
export interface PreviewServer {
  port: number;
  /** Process name that owns the listening socket, e.g. "node". */
  process: string;
  /** <title> of the served page, when it has one. */
  title?: string;
  /** Best-effort framework guess, e.g. "Vite". */
  framework?: string;
  /**
   * Metro, the React Native bundler.
   *
   * Worth distinguishing because it is not something to frame: it serves a JS
   * bundle, not a page. What you do with it is point a simulator on *your*
   * machine at it, so the app runs locally at full frame rate while the code
   * and the bundler stay on the Worker.
   */
  kind?: "metro";
  /** Absolute path of the project Metro is serving, when it reports one. */
  projectRoot?: string;
}

/** An entry in a workspace directory listing. */
export interface FileEntry {
  name: string;
  kind: "dir" | "file";
  size: number;
}

/** A prompt queued to run against a workspace at a chosen time. */
export interface ScheduledPrompt {
  id: string;
  workspaceId: string;
  /** Existing session to continue, or null to start a fresh one. */
  sessionId: string | null;
  text: string;
  /** Epoch ms. */
  runAt: number;
  createdAt: number;
}

/** A turn the agent could not finish because the usage quota ran out. */
export interface ParkedTask {
  id: string;
  workspaceId: string;
  sessionId: string;
  /** The prompt to run again when the quota returns. */
  text: string;
  /** Epoch ms when this will be retried. */
  resumeAt: number;
  parkedAt: number;
  /** Why it stopped, e.g. "five_hour usage limit". */
  reason: string;
}

/** One item in the agent's working plan. */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  /** Present-tense label the agent uses while the item is running. */
  activeForm?: string;
}

/** A past agent conversation found on the Worker's machine. */
export interface DiscoveredSession {
  /** The agent's own session id — what `--resume` accepts. */
  sessionId: string;
  /** Agent-generated title, when the transcript has one. */
  title: string | null;
  firstPrompt: string | null;
  messageCount: number;
  /** Counts are a floor: only the head of a large transcript is read. */
  truncated: boolean;
  updatedAt: number;
  sizeBytes: number;
}

/** A directory the agent has worked in before, with its past conversations. */
export interface DiscoveredProject {
  path: string;
  name: string;
  sessions: DiscoveredSession[];
  updatedAt: number;
}

/** What a turn cost, and how much of the context window it occupies. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Tokens occupying the context window — input plus everything cached. */
  contextTokens: number;
  /** Size of the model's context window, when the agent reports it. */
  contextWindow: number | null;
  costUsd: number;
  durationMs: number;
  model: string | null;
}

/**
 * One entry in a session transcript.
 *
 * `tool` turns record what the agent did (read a file, ran a command) so the
 * Desktop can render them as actions rather than as prose in the reply.
 */
export interface ChatTurn {
  role: "user" | "agent" | "tool" | "reasoning";
  text: string;
  at: number;
  /** Tool name, e.g. "Bash" or "Edit". Only on `tool` turns. */
  tool?: string;
  /** What it acted on — a file path, a command, a query. */
  target?: string;
  /** Correlates a tool call with the result that comes back for it. */
  toolId?: string;
  /** What the tool returned, shown when the action is expanded. */
  output?: string;
  isError?: boolean;
  /** Token/cost accounting, attached to the agent turn that closed the round. */
  usage?: TurnUsage;
}

export type ApprovalKind =
  | "git-push"
  | "file-delete"
  | "docker-command"
  | "package-install"
  | "other";

export interface ApprovalRequest {
  id: string;
  workerId: string;
  /** Workspace the action would run in, when it originates from one. */
  workspaceId?: string;
  kind: ApprovalKind;
  summary: string;
  details: string;
  createdAt: number;
}

/**
 * Desktop -> Worker
 *
 * Anything that acts on project files or runs code carries a `workspaceId`:
 * a machine hosts many workspaces, and an operation is meaningless without
 * knowing which one it belongs to.
 */
export type ClientMessage =
  | { type: "hello"; clientId: string; token: string }
  | { type: "subscribe"; workerId: string }
  | { type: "workspace.open"; requestId: string; path: string }
  | { type: "workspace.close"; workspaceId: string }
  | { type: "session.create"; requestId: string; workspaceId: string }
  | { type: "chat.send"; workspaceId: string; sessionId: string; text: string }
  | { type: "command.run"; workspaceId: string; commandId: string; command: string }
  | { type: "approval.resolve"; requestId: string; approved: boolean }
  | { type: "terminal.start"; workspaceId: string; terminalId: string; cols: number; rows: number }
  | { type: "terminal.input"; terminalId: string; data: string }
  | { type: "terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal.close"; terminalId: string }
  | { type: "fs.list"; requestId: string; workspaceId: string; path: string }
  | { type: "fs.read"; requestId: string; workspaceId: string; path: string }
  | {
      type: "fs.write";
      requestId: string;
      workspaceId: string;
      path: string;
      content: string;
    }
  | { type: "preview.scan"; requestId: string }
  /** Tell Metro to reload the app connected to it. */
  | { type: "preview.reload"; requestId: string; port: number }
  | { type: "discover.projects"; requestId: string }
  | { type: "task.resumeNow"; taskId: string }
  | { type: "task.cancel"; taskId: string }
  | {
      type: "schedule.add";
      requestId: string;
      workspaceId: string;
      sessionId: string | null;
      text: string;
      runAt: number;
    }
  | { type: "schedule.cancel"; promptId: string }
  | { type: "schedule.runNow"; promptId: string }
  | {
      /** Continue a conversation the agent had before, in this workspace. */
      type: "session.adopt";
      requestId: string;
      workspaceId: string;
      nativeSessionId: string;
      title: string | null;
    };

/** Worker -> Desktop */
export type ServerMessage =
  | { type: "auth.result"; ok: boolean; reason?: string }
  | { type: "machine"; machine: MachineSummary }
  | { type: "workspaces"; items: Workspace[] }
  | { type: "workspace.opened"; requestId: string; workspace: Workspace }
  | { type: "workspace.error"; requestId: string; message: string }
  | { type: "session.created"; requestId: string; workspaceId: string; sessionId: string }
  | { type: "chat.history"; sessionId: string; messages: ChatTurn[] }
  | { type: "chat.delta"; sessionId: string; text: string }
  | { type: "chat.reasoning"; sessionId: string; text: string }
  | { type: "chat.tool"; sessionId: string; toolId: string; tool: string; target: string }
  | {
      type: "chat.tool.result";
      sessionId: string;
      toolId: string;
      output: string;
      isError: boolean;
    }
  | { type: "chat.usage"; sessionId: string; usage: TurnUsage }
  | { type: "chat.todos"; sessionId: string; todos: TodoItem[] }
  | { type: "approval.request"; request: ApprovalRequest }
  | { type: "approval.resolved"; requestId: string; approved: boolean }
  | { type: "command.result"; commandId: string; code: number | null; output: string; approved: boolean }
  | { type: "terminal.output"; terminalId: string; data: string }
  | { type: "terminal.exit"; terminalId: string; code: number | null }
  | { type: "fs.listing"; requestId: string; path: string; entries: FileEntry[] }
  | {
      type: "fs.file";
      requestId: string;
      path: string;
      mime: string;
      /** true when `content` is base64 (images, PDFs), false for utf8 text. */
      base64: boolean;
      content: string;
    }
  | { type: "fs.written"; requestId: string; path: string; bytes: number }
  | { type: "fs.error"; requestId: string; message: string }
  | {
      type: "preview.list";
      requestId: string;
      servers: PreviewServer[];
      /**
       * Host-relative base the Desktop frames previews through, e.g.
       * ":4502/preview". The client prepends the same host it reached the
       * Worker on, giving "http://<host>:4502/preview/<port>/".
       */
      proxyBase: string;
    }
  /** Result of a Metro reload; `error` is null when the app was told to reload. */
  | { type: "preview.reloaded"; requestId: string; error: string | null }
  | { type: "discover.result"; requestId: string; projects: DiscoveredProject[] }
  | { type: "tasks.parked"; tasks: ParkedTask[] }
  | { type: "schedule.list"; prompts: ScheduledPrompt[] }
  | { type: "notification"; notification: WorkerNotification };

export type WireMessage = ClientMessage | ServerMessage;

export const PROTOCOL_VERSION = 1 as const;
