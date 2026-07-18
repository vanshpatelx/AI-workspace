import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { AgentKind, ChatTurn } from "@ai-workspace/protocol";
import { CONFIG_DIR } from "./config.js";

export interface SessionRecord {
  sessionId: string;
  agent: AgentKind;
  /** The agent's own session id, used to resume the conversation. */
  nativeSessionId: string | null;
  messages: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

const STORE_PATH = join(CONFIG_DIR, "sessions.json");

/**
 * Disk-backed registry of chat sessions.
 *
 * Persists both the transcript (so the Desktop can rehydrate a conversation)
 * and the agent's native session id (so the agent itself resumes with full
 * context via --resume). This is what makes a workspace "persistent": a Worker
 * restart does not lose the conversation.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private path: string = STORE_PATH) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as SessionRecord[];
      for (const record of raw) this.sessions.set(record.sessionId, record);
    } catch {
      // Corrupt store: start clean rather than crash the Worker.
    }
  }

  private persist(): void {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(this.path, JSON.stringify([...this.sessions.values()], null, 2), "utf8");
    } catch (err) {
      console.error("[worker] failed to persist sessions:", (err as Error).message);
    }
  }

  /** Get an existing session or create one bound to the given agent. */
  ensure(sessionId: string, agent: AgentKind, now: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const record: SessionRecord = {
      sessionId,
      agent,
      nativeSessionId: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, record);
    this.persist();
    return record;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Append a turn to the transcript. */
  appendTurn(sessionId: string, turn: ChatTurn): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.messages.push(turn);
    record.updatedAt = turn.at;
    this.persist();
  }

  /** Record the agent's native session id after a turn completes. */
  setNativeSession(sessionId: string, nativeSessionId: string | null, now: number): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.nativeSessionId = nativeSessionId;
    record.updatedAt = now;
    this.persist();
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()];
  }
}
