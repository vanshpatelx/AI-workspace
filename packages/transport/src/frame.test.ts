import { describe, it, expect } from "vitest";
import { encode, decode, isClientMessage, isServerMessage } from "./frame.js";

describe("frame encoding", () => {
  it("round-trips a message", () => {
    const msg = { type: "chat.send", workspaceId: "ws1", sessionId: "s1", text: "hi" } as const;
    expect(decode(encode(msg))).toEqual(msg);
  });

  it("rejects a frame with no type rather than passing it on", () => {
    expect(() => decode(JSON.stringify({ nope: true }))).toThrow(/type/);
  });

  it("rejects malformed json", () => {
    expect(() => decode("{ not json")).toThrow();
  });

  it("rejects a bare value", () => {
    expect(() => decode(JSON.stringify("hello"))).toThrow();
  });
});

/**
 * The Worker only acts on client messages. If a message the Desktop sends is
 * not classified here it is silently ignored, which looks like the feature
 * simply not working — so every client message must be listed.
 */
describe("message classification", () => {
  it.each([
    "hello",
    "subscribe",
    "workspace.open",
    "workspace.close",
    "session.create",
    "chat.send",
    "command.run",
    "approval.resolve",
    "terminal.start",
    "terminal.input",
    "terminal.resize",
    "terminal.close",
    "fs.list",
    "fs.read",
    "preview.scan",
  ])("treats %s as a client message", (type) => {
    expect(isClientMessage({ type } as never)).toBe(true);
  });

  it.each([
    "auth.result",
    "machine",
    "workspaces",
    "chat.delta",
    "chat.tool",
    "chat.usage",
    "approval.request",
    "command.result",
    "terminal.output",
    "fs.listing",
    "notification",
  ])("treats %s as a server message", (type) => {
    expect(isServerMessage({ type } as never)).toBe(true);
    expect(isClientMessage({ type } as never)).toBe(false);
  });
});
