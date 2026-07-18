import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalRequest,
  ClientMessage,
  ServerMessage,
  WorkspaceSummary,
} from "@ai-workspace/protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "unauthorized";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
}

export interface CommandLine {
  commandId: string;
  command: string;
  status: "pending" | "approved" | "rejected" | "done";
  code?: number | null;
  output?: string;
}

export interface WorkerState {
  connection: ConnectionState;
  workspaces: WorkspaceSummary[];
  messages: ChatMessage[];
  approvals: ApprovalRequest[];
  commands: CommandLine[];
  notices: string[];
  send: (text: string) => void;
  runCommand: (command: string) => void;
  resolveApproval: (requestId: string, approved: boolean) => void;
}

const SESSION_ID = "desktop-main";

let commandCounter = 0;

/**
 * Connects the renderer to a Worker over a native WebSocket and exposes live
 * workspace state + chat. Reuses the same JSON frames the Node transport
 * speaks, so no browser build of `ws` is needed. Reconnects automatically.
 */
export function useWorker(url: string, token: string): WorkerState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [commands, setCommands] = useState<CommandLine[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  const emit = useCallback((msg: ClientMessage) => {
    const s = socketRef.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!token) {
      setConnection("unauthorized");
      return;
    }
    let closed = false;
    let unauthorized = false;
    let retry: ReturnType<typeof setTimeout>;

    const open = () => {
      setConnection("connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({ type: "hello", clientId: "desktop-ui", token } satisfies ClientMessage),
        );
      };

      socket.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "auth.result":
            if (msg.ok) {
              setConnection("connected");
              socket.send(JSON.stringify({ type: "subscribe", workerId: "local" } satisfies ClientMessage));
            } else {
              unauthorized = true;
              setConnection("unauthorized");
              socket.close();
            }
            break;
          case "workspaces":
            setWorkspaces(msg.items);
            break;
          case "chat.history":
            // Rehydrate a persisted conversation on (re)connect.
            if (msg.sessionId === SESSION_ID) {
              setMessages(msg.messages.map((m) => ({ role: m.role, text: m.text })));
            }
            break;
          case "chat.delta":
            setMessages((prev) => appendAgentDelta(prev, msg.text));
            break;
          case "approval.request":
            setApprovals((prev) =>
              prev.some((a) => a.id === msg.request.id) ? prev : [msg.request, ...prev],
            );
            break;
          case "approval.resolved":
            setApprovals((prev) => prev.filter((a) => a.id !== msg.requestId));
            break;
          case "command.result":
            setCommands((prev) =>
              prev.map((c) =>
                c.commandId === msg.commandId
                  ? {
                      ...c,
                      status: msg.approved ? "done" : "rejected",
                      code: msg.code,
                      output: msg.output,
                    }
                  : c,
              ),
            );
            break;
          case "notification":
            setNotices((prev) => [`${msg.level}: ${msg.text}`, ...prev].slice(0, 20));
            break;
          default:
            break;
        }
      };

      socket.onclose = () => {
        if (unauthorized) return; // bad token — don't hammer the worker
        setConnection("disconnected");
        if (!closed) retry = setTimeout(open, 1000);
      };
      socket.onerror = () => socket.close();
    };

    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [url, token]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((prev) => [...prev, { role: "user", text: trimmed }, { role: "agent", text: "" }]);
      emit({ type: "chat.send", sessionId: SESSION_ID, text: trimmed });
    },
    [emit],
  );

  const runCommand = useCallback(
    (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;
      const commandId = `cmd-${++commandCounter}`;
      const line: CommandLine = { commandId, command: trimmed, status: "pending" };
      setCommands((prev) => [line, ...prev].slice(0, 20));
      emit({ type: "command.run", commandId, command: trimmed });
    },
    [emit],
  );

  const resolveApproval = useCallback(
    (requestId: string, approved: boolean) => {
      setApprovals((prev) => prev.filter((a) => a.id !== requestId));
      emit({ type: "approval.resolve", requestId, approved });
    },
    [emit],
  );

  return { connection, workspaces, messages, approvals, commands, notices, send, runCommand, resolveApproval };
}

/** Append streamed agent text to the last (in-progress) agent message. */
function appendAgentDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "agent") {
    return [...prev.slice(0, -1), { role: "agent", text: last.text + delta }];
  }
  return [...prev, { role: "agent", text: delta }];
}
