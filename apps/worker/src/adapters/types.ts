import type { AgentKind, TodoItem, TurnUsage } from "@ai-workspace/protocol";

export interface AgentTurnHandlers {
  /** Streamed assistant output for this turn. */
  onDelta(text: string): void;
  /** The agent's own reasoning, when it thinks before answering. */
  onReasoning?(text: string): void;
  /** The agent used a tool — reported separately so the UI can show the
   *  action rather than burying it in the reply text. */
  onTool?(toolId: string, tool: string, target: string): void;
  /** The agent's plan, whenever it writes or updates one. */
  onTodos?(todos: TodoItem[]): void;
  /** What that tool returned, matched to the call by `toolId`. */
  onToolResult?(toolId: string, output: string, isError: boolean): void;
  /** Token, cost and timing accounting once the turn completes. */
  onUsage?(usage: TurnUsage): void;
  /** The turn stopped because the usage quota ran out. */
  onRateLimited?(resumeAt: number, reason: string): void;
  /** Non-fatal status the user should see (e.g. a session had to restart). */
  onNotice?(text: string): void;
  /** Fatal error for this turn. */
  onError(message: string): void;
}

export interface AgentTurnInput {
  text: string;
  cwd: string;
  /** Native session id to resume, or null to start a fresh conversation. */
  resumeSessionId: string | null;
  handlers: AgentTurnHandlers;
}

export interface AgentTurnResult {
  /** Native session id to persist for the next turn's --resume. */
  nativeSessionId: string | null;
}

/**
 * A pluggable driver for one AI coding agent. The Worker owns sessions and
 * routing; an adapter only knows how to run a single turn and stream its
 * output. Claude Code lands first; Codex/Gemini/OpenHands follow the same
 * contract.
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  runTurn(input: AgentTurnInput): Promise<AgentTurnResult>;
}
