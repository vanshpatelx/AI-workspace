import type { ClientMessage, ServerMessage, WireMessage } from "@ai-workspace/protocol";

/**
 * Frame encoding. For now frames are UTF-8 JSON — the Relay treats them as
 * opaque bytes, so we can swap in an encrypted binary framing later without
 * touching Worker/Desktop message handlers.
 */

export function encode(msg: WireMessage): string {
  return JSON.stringify(msg);
}

export function decode(raw: string): WireMessage {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
    throw new Error("invalid frame: missing type");
  }
  return parsed as WireMessage;
}

export function isClientMessage(msg: WireMessage): msg is ClientMessage {
  switch (msg.type) {
    case "hello":
    case "subscribe":
    case "workspace.open":
    case "workspace.close":
    case "session.create":
    case "chat.send":
    case "command.run":
    case "approval.resolve":
    case "terminal.start":
    case "terminal.input":
    case "terminal.resize":
    case "terminal.close":
    case "fs.list":
    case "fs.read":
    case "fs.write":
    case "preview.scan":
    case "preview.reload":
    case "discover.projects":
    case "session.adopt":
    case "task.resumeNow":
    case "task.cancel":
    case "schedule.add":
    case "schedule.cancel":
    case "schedule.runNow":
      return true;
    default:
      return false;
  }
}

export function isServerMessage(msg: WireMessage): msg is ServerMessage {
  return !isClientMessage(msg);
}
