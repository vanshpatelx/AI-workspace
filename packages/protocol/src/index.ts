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

export interface WorkspaceSummary {
  workerId: string;
  hostname: string;
  status: WorkerStatus;
  repo: string | null;
  agent: AgentKind | null;
  activeTask: string | null;
  progress: number | null; // 0..1
  cpu: number | null; // 0..1
  mem: number | null; // 0..1
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
  kind: ApprovalKind;
  summary: string;
  details: string;
  createdAt: number;
}

/** Desktop -> Worker */
export type ClientMessage =
  | { type: "hello"; clientId: string; token: string }
  | { type: "subscribe"; workerId: string }
  | { type: "chat.send"; sessionId: string; text: string }
  | { type: "command.run"; commandId: string; command: string }
  | { type: "approval.resolve"; requestId: string; approved: boolean }
  | { type: "terminal.input"; sessionId: string; data: string };

/** Worker -> Desktop */
export type ServerMessage =
  | { type: "auth.result"; ok: boolean; reason?: string }
  | { type: "workspaces"; items: WorkspaceSummary[] }
  | { type: "chat.delta"; sessionId: string; text: string }
  | { type: "approval.request"; request: ApprovalRequest }
  | { type: "approval.resolved"; requestId: string; approved: boolean }
  | { type: "command.result"; commandId: string; code: number | null; output: string; approved: boolean }
  | { type: "terminal.output"; sessionId: string; data: string }
  | { type: "notification"; level: "info" | "warn" | "error"; text: string };

export type WireMessage = ClientMessage | ServerMessage;

export const PROTOCOL_VERSION = 1 as const;
