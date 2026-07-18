import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "./session.js";

let dir: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aiw-sessions-"));
  storePath = join(dir, "sessions.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SessionStore", () => {
  it("creates a session bound to a workspace", () => {
    const store = new SessionStore(storePath);
    const record = store.ensure("s1", "ws1", "claude-code", 1);
    expect(record.workspaceId).toBe("ws1");
    expect(record.messages).toEqual([]);
  });

  it("returns the same session rather than clobbering it", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    store.appendTurn("s1", { role: "user", text: "hello", at: 2 });
    const again = store.ensure("s1", "ws1", "claude-code", 3);
    expect(again.messages).toHaveLength(1);
  });

  it("keeps a conversation across a restart — the persistence promise", () => {
    const first = new SessionStore(storePath);
    first.ensure("s1", "ws1", "claude-code", 1);
    first.appendTurn("s1", { role: "user", text: "remember 73", at: 2 });
    first.setNativeSession("s1", "native-abc", 3);

    // A new store is what a restarted Worker builds.
    const reopened = new SessionStore(storePath);
    const record = reopened.get("s1");
    expect(record?.messages[0]?.text).toBe("remember 73");
    // Without the native id the agent loses its own context on resume.
    expect(record?.nativeSessionId).toBe("native-abc");
  });

  it("separates sessions by workspace", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    store.ensure("s2", "ws2", "claude-code", 1);
    store.ensure("s3", "ws1", "claude-code", 2);
    expect(store.forWorkspace("ws1").map((s) => s.sessionId)).toEqual(["s1", "s3"]);
    expect(store.forWorkspace("ws2")).toHaveLength(1);
  });

  it("attaches tool output to the call it belongs to", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    store.appendTurn("s1", { role: "tool", text: "", tool: "Read", toolId: "t1", at: 2 });
    store.appendTurn("s1", { role: "tool", text: "", tool: "Bash", toolId: "t2", at: 3 });
    store.attachToolResult("s1", "t2", "command output", false);

    const turns = store.get("s1")!.messages;
    expect(turns[0]?.output).toBeUndefined();
    expect(turns[1]?.output).toBe("command output");
  });

  it("marks a failed tool call", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    store.appendTurn("s1", { role: "tool", text: "", tool: "Bash", toolId: "t1", at: 2 });
    store.attachToolResult("s1", "t1", "boom", true);
    expect(store.get("s1")!.messages[0]?.isError).toBe(true);
  });

  it("ignores results for unknown calls instead of throwing", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    expect(() => store.attachToolResult("s1", "nope", "x", false)).not.toThrow();
  });

  it("survives a corrupt store rather than refusing to boot", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    require("node:fs").writeFileSync(storePath, "{ not json");
    expect(() => new SessionStore(storePath)).not.toThrow();
    expect(new SessionStore(storePath).list()).toEqual([]);
  });

  it("writes to disk as turns are appended", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    store.appendTurn("s1", { role: "user", text: "hi", at: 2 });
    expect(existsSync(storePath)).toBe(true);
  });

  it("persists usage so a reopened transcript keeps its accounting", () => {
    const store = new SessionStore(storePath);
    store.ensure("s1", "ws1", "claude-code", 1);
    store.appendTurn("s1", {
      role: "agent",
      text: "done",
      at: 2,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheCreationTokens: 0,
        contextTokens: 15,
        contextWindow: 200000,
        costUsd: 0.01,
        durationMs: 500,
        model: "claude-opus-4-8",
      },
    });
    expect(new SessionStore(storePath).get("s1")!.messages[0]?.usage?.model).toBe(
      "claude-opus-4-8",
    );
  });
});
