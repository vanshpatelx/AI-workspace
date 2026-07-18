import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApprovalRequest,
  ClientMessage,
  FileEntry,
  ServerMessage,
  WorkspaceSummary,
} from "@ai-workspace/protocol";

export interface FileListing {
  path: string;
  entries: FileEntry[];
}

export interface FilePreview {
  path: string;
  mime: string;
  base64: boolean;
  content: string;
}

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

/** One paired Worker: where it lives and the code we authenticate with. */
export interface WorkerTarget {
  url: string;
  token: string;
}

/** Live state for a single Worker connection. */
export interface WorkerState {
  url: string;
  connection: ConnectionState;
  workspaces: WorkspaceSummary[];
  messages: ChatMessage[];
  approvals: ApprovalRequest[];
  commands: CommandLine[];
  notices: string[];
}

/** Streamed PTY bytes, delivered outside React state to keep xterm fast. */
export type TerminalListener = (terminalId: string, data: string) => void;

export interface WorkersApi {
  workers: Record<string, WorkerState>;
  send: (url: string, text: string) => void;
  runCommand: (url: string, command: string) => void;
  resolveApproval: (url: string, requestId: string, approved: boolean) => void;
  terminal: {
    start: (url: string, terminalId: string, cols: number, rows: number) => void;
    input: (url: string, terminalId: string, data: string) => void;
    resize: (url: string, terminalId: string, cols: number, rows: number) => void;
    close: (url: string, terminalId: string) => void;
    subscribe: (listener: TerminalListener) => () => void;
  };
  fs: {
    list: (url: string, path: string) => Promise<FileListing>;
    read: (url: string, path: string) => Promise<FilePreview>;
  };
}

const SESSION_ID = "desktop-main";
let commandCounter = 0;

function emptyState(url: string): WorkerState {
  return {
    url,
    connection: "connecting",
    workspaces: [],
    messages: [],
    approvals: [],
    commands: [],
    notices: [],
  };
}

/**
 * Manages one WebSocket per paired Worker.
 *
 * Connections are handled imperatively in a ref (not one hook per Worker) so
 * workstations can be added or removed at runtime without changing hook order.
 * Each Worker keeps its own chat, approvals and command history — the Desktop
 * is a multiplexer over independent machines.
 */
export function useWorkers(targets: WorkerTarget[]): WorkersApi {
  const [workers, setWorkers] = useState<Record<string, WorkerState>>({});
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const termListeners = useRef<Set<TerminalListener>>(new Set());
  /** In-flight fs requests, keyed by requestId. */
  const fsPending = useRef<Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>>(
    new Map(),
  );
  const key = targets.map((t) => `${t.url}|${t.token}`).join(",");

  const patch = useCallback((url: string, fn: (prev: WorkerState) => WorkerState) => {
    setWorkers((prev) => ({ ...prev, [url]: fn(prev[url] ?? emptyState(url)) }));
  }, []);

  useEffect(() => {
    const sockets = socketsRef.current;
    const wanted = new Set(targets.map((t) => t.url));
    let disposed = false;
    const retries: ReturnType<typeof setTimeout>[] = [];

    // Drop connections for workstations that were removed.
    for (const [url, socket] of sockets) {
      if (!wanted.has(url)) {
        socket.close();
        sockets.delete(url);
        setWorkers((prev) => {
          const next = { ...prev };
          delete next[url];
          return next;
        });
      }
    }

    for (const target of targets) {
      if (sockets.has(target.url)) continue;

      const open = () => {
        if (disposed) return;
        patch(target.url, (s) => ({ ...s, connection: "connecting" }));
        const socket = new WebSocket(target.url);
        sockets.set(target.url, socket);
        let unauthorized = false;

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              type: "hello",
              clientId: "desktop-ui",
              token: target.token,
            } satisfies ClientMessage),
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
                patch(target.url, (s) => ({ ...s, connection: "connected" }));
                socket.send(
                  JSON.stringify({ type: "subscribe", workerId: "local" } satisfies ClientMessage),
                );
              } else {
                unauthorized = true;
                patch(target.url, (s) => ({ ...s, connection: "unauthorized" }));
                socket.close();
              }
              break;
            case "workspaces":
              patch(target.url, (s) => ({ ...s, workspaces: msg.items }));
              break;
            case "chat.history":
              if (msg.sessionId === SESSION_ID) {
                patch(target.url, (s) => ({
                  ...s,
                  messages: msg.messages.map((m) => ({ role: m.role, text: m.text })),
                }));
              }
              break;
            case "chat.delta":
              patch(target.url, (s) => ({ ...s, messages: appendAgentDelta(s.messages, msg.text) }));
              break;
            case "approval.request":
              patch(target.url, (s) => ({
                ...s,
                approvals: s.approvals.some((a) => a.id === msg.request.id)
                  ? s.approvals
                  : [msg.request, ...s.approvals],
              }));
              break;
            case "approval.resolved":
              patch(target.url, (s) => ({
                ...s,
                approvals: s.approvals.filter((a) => a.id !== msg.requestId),
              }));
              break;
            case "command.result":
              patch(target.url, (s) => ({
                ...s,
                commands: s.commands.map((c) =>
                  c.commandId === msg.commandId
                    ? {
                        ...c,
                        status: msg.approved ? "done" : "rejected",
                        code: msg.code,
                        output: msg.output,
                      }
                    : c,
                ),
              }));
              break;
            case "terminal.output":
              // Bypasses React state: PTY output is high-frequency and goes
              // straight to xterm's write buffer.
              for (const l of termListeners.current) l(msg.terminalId, msg.data);
              break;
            case "terminal.exit":
              for (const l of termListeners.current) l(msg.terminalId, "\r\n[process exited]\r\n");
              break;
            case "fs.listing": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              pending?.resolve({ path: msg.path, entries: msg.entries });
              break;
            }
            case "fs.file": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              pending?.resolve({
                path: msg.path,
                mime: msg.mime,
                base64: msg.base64,
                content: msg.content,
              });
              break;
            }
            case "fs.error": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              pending?.reject(new Error(msg.message));
              break;
            }
            case "notification":
              patch(target.url, (s) => ({
                ...s,
                notices: [`${msg.level}: ${msg.text}`, ...s.notices].slice(0, 20),
              }));
              break;
            default:
              break;
          }
        };

        socket.onclose = () => {
          sockets.delete(target.url);
          if (unauthorized || disposed) return;
          patch(target.url, (s) => ({ ...s, connection: "disconnected" }));
          retries.push(setTimeout(open, 1000));
        };
        socket.onerror = () => socket.close();
      };

      open();
    }

    return () => {
      disposed = true;
      for (const t of retries) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, patch]);

  const emit = useCallback((url: string, msg: ClientMessage) => {
    const socket = socketsRef.current.get(url);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  const send = useCallback(
    (url: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      patch(url, (s) => ({
        ...s,
        messages: [...s.messages, { role: "user", text: trimmed }, { role: "agent", text: "" }],
      }));
      emit(url, { type: "chat.send", sessionId: SESSION_ID, text: trimmed });
    },
    [emit, patch],
  );

  const runCommand = useCallback(
    (url: string, command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;
      const line: CommandLine = {
        commandId: `cmd-${++commandCounter}`,
        command: trimmed,
        status: "pending",
      };
      patch(url, (s) => ({ ...s, commands: [line, ...s.commands].slice(0, 20) }));
      emit(url, { type: "command.run", commandId: line.commandId, command: trimmed });
    },
    [emit, patch],
  );

  const resolveApproval = useCallback(
    (url: string, requestId: string, approved: boolean) => {
      patch(url, (s) => ({ ...s, approvals: s.approvals.filter((a) => a.id !== requestId) }));
      emit(url, { type: "approval.resolve", requestId, approved });
    },
    [emit, patch],
  );

  const terminal = useMemo(
    () => ({
      start: (url: string, terminalId: string, cols: number, rows: number) =>
        emit(url, { type: "terminal.start", terminalId, cols, rows }),
      input: (url: string, terminalId: string, data: string) =>
        emit(url, { type: "terminal.input", terminalId, data }),
      resize: (url: string, terminalId: string, cols: number, rows: number) =>
        emit(url, { type: "terminal.resize", terminalId, cols, rows }),
      close: (url: string, terminalId: string) => emit(url, { type: "terminal.close", terminalId }),
      subscribe: (listener: TerminalListener) => {
        termListeners.current.add(listener);
        return () => {
          termListeners.current.delete(listener);
        };
      },
    }),
    [emit],
  );

  const fs = useMemo(() => {
    const request = <T,>(url: string, msg: (requestId: string) => ClientMessage): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const requestId = `fs-${++commandCounter}`;
        fsPending.current.set(requestId, { resolve, reject });
        emit(url, msg(requestId));
        // Don't leak a pending entry if the Worker never answers.
        setTimeout(() => {
          if (fsPending.current.delete(requestId)) reject(new Error("request timed out"));
        }, 15000);
      });

    return {
      list: (url: string, path: string) =>
        request<FileListing>(url, (requestId) => ({ type: "fs.list", requestId, path })),
      read: (url: string, path: string) =>
        request<FilePreview>(url, (requestId) => ({ type: "fs.read", requestId, path })),
    };
  }, [emit]);

  return { workers, send, runCommand, resolveApproval, terminal, fs };
}

/** Append streamed agent text to the last (in-progress) agent message. */
function appendAgentDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "agent") {
    return [...prev.slice(0, -1), { role: "agent", text: last.text + delta }];
  }
  return [...prev, { role: "agent", text: delta }];
}
