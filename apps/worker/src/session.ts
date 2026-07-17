import type { AgentKind } from "@ai-workspace/protocol";

export interface SessionRecord {
  sessionId: string;
  agent: AgentKind;
  /** The agent's own session id, used to resume the conversation. */
  nativeSessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * In-memory registry of chat sessions. Persisting these to disk (so
 * conversations survive a Worker restart) is milestone #7 — the interface is
 * kept small so a disk-backed implementation can drop in behind it.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  /** Get an existing session or create one bound to the given agent. */
  ensure(sessionId: string, agent: AgentKind, now: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const record: SessionRecord = {
      sessionId,
      agent,
      nativeSessionId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Record the agent's native session id after a turn completes. */
  setNativeSession(sessionId: string, nativeSessionId: string | null, now: number): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.nativeSessionId = nativeSessionId;
    record.updatedAt = now;
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()];
  }
}
