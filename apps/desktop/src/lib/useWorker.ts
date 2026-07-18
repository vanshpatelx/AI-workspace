import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, WorkspaceSummary } from "@ai-workspace/protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
}

export interface WorkerState {
  connection: ConnectionState;
  workspaces: WorkspaceSummary[];
  messages: ChatMessage[];
  notices: string[];
  send: (text: string) => void;
}

const SESSION_ID = "desktop-main";

/**
 * Connects the renderer to a Worker over a native WebSocket and exposes live
 * workspace state + chat. Reuses the same JSON frames the Node transport
 * speaks, so no browser build of `ws` is needed. Reconnects automatically.
 */
export function useWorker(url: string): WorkerState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  const emit = useCallback((msg: ClientMessage) => {
    const s = socketRef.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const open = () => {
      setConnection("connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnection("connected");
        socket.send(JSON.stringify({ type: "hello", clientId: "desktop-ui" } satisfies ClientMessage));
        socket.send(JSON.stringify({ type: "subscribe", workerId: "local" } satisfies ClientMessage));
      };

      socket.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "workspaces":
            setWorkspaces(msg.items);
            break;
          case "chat.delta":
            setMessages((prev) => appendAgentDelta(prev, msg.text));
            break;
          case "notification":
            setNotices((prev) => [`${msg.level}: ${msg.text}`, ...prev].slice(0, 20));
            break;
          default:
            break;
        }
      };

      socket.onclose = () => {
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
  }, [url]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((prev) => [...prev, { role: "user", text: trimmed }, { role: "agent", text: "" }]);
      emit({ type: "chat.send", sessionId: SESSION_ID, text: trimmed });
    },
    [emit],
  );

  return { connection, workspaces, messages, notices, send };
}

/** Append streamed agent text to the last (in-progress) agent message. */
function appendAgentDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "agent") {
    return [...prev.slice(0, -1), { role: "agent", text: last.text + delta }];
  }
  return [...prev, { role: "agent", text: delta }];
}
