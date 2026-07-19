import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApprovalRequest,
  ClientMessage,
  FileEntry,
  DiscoveredProject,
  MachineSummary,
  ParkedTask,
  PreviewServer,
  MirroredDevice,
  ScheduledPrompt,
  TurnUsage,
  ServerMessage,
  TodoItem,
  WorkerNotification,
  Workspace,
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

export interface PreviewListing {
  servers: PreviewServer[];
  /** Absolute proxy base, already resolved against the Worker's host. */
  proxyBase: string;
  /** Pairing code — the proxy requires it, same as the transport. */
  token: string;
}

export interface DeviceListing {
  devices: MirroredDevice[];
  /** Absolute stream base, already resolved against the Worker's host. */
  streamBase: string;
  /** Pairing code — the frame stream requires it, same as the transport. */
  token: string;
}

export type ConnectionState = "connecting" | "connected" | "disconnected" | "unauthorized";

export interface ChatMessage {
  role: "user" | "agent" | "tool" | "reasoning";
  text: string;
  /** Present on `tool` messages: what the agent did and to what. */
  tool?: string;
  target?: string;
  toolId?: string;
  /** What the tool returned, revealed when the action is expanded. */
  output?: string;
  isError?: boolean;
  /** Token/cost accounting on the agent turn that ended the round. */
  usage?: TurnUsage;
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

/** Live state for a single Worker connection (one machine). */
export interface WorkerState {
  url: string;
  connection: ConnectionState;
  machine: MachineSummary | null;
  /** Project directories open on this machine. */
  workspaces: Workspace[];
  /** Chat transcripts keyed by sessionId — a workspace may have several. */
  messages: Record<string, ChatMessage[]>;
  approvals: ApprovalRequest[];
  /** Command history keyed by workspaceId. */
  commands: Record<string, CommandLine[]>;
  /** The agent's current plan, keyed by sessionId. */
  todos: Record<string, TodoItem[]>;
  /** Turns waiting on a usage limit. */
  parked: ParkedTask[];
  /** Prompts queued to run at a chosen time. */
  scheduled: ScheduledPrompt[];
  notices: WorkerNotification[];
}

/** Streamed PTY bytes, delivered outside React state to keep xterm fast. */
export type TerminalListener = (terminalId: string, data: string) => void;

export interface WorkersApi {
  workers: Record<string, WorkerState>;
  send: (url: string, workspaceId: string, sessionId: string, text: string) => void;
  runCommand: (url: string, workspaceId: string, command: string) => void;
  resolveApproval: (url: string, requestId: string, approved: boolean) => void;
  /** Run parked work immediately, or drop it. */
  resumeParked: (url: string, taskId: string) => void;
  cancelParked: (url: string, taskId: string) => void;
  /** Queue a prompt to run later, and manage what is queued. */
  schedulePrompt: (
    url: string,
    workspaceId: string,
    sessionId: string | null,
    text: string,
    runAt: number,
  ) => void;
  runScheduled: (url: string, promptId: string) => void;
  cancelScheduled: (url: string, promptId: string) => void;
  openWorkspace: (url: string, path: string) => Promise<Workspace>;
  closeWorkspace: (url: string, workspaceId: string) => void;
  createSession: (url: string, workspaceId: string) => Promise<string>;
  terminal: {
    start: (url: string, workspaceId: string, terminalId: string, cols: number, rows: number) => void;
    input: (url: string, terminalId: string, data: string) => void;
    resize: (url: string, terminalId: string, cols: number, rows: number) => void;
    close: (url: string, terminalId: string) => void;
    subscribe: (listener: TerminalListener) => () => void;
  };
  fs: {
    list: (url: string, workspaceId: string, path: string) => Promise<FileListing>;
    read: (url: string, workspaceId: string, path: string) => Promise<FilePreview>;
    write: (
      url: string,
      workspaceId: string,
      path: string,
      content: string,
    ) => Promise<{ path: string; bytes: number }>;
  };
  preview: {
    scan: (url: string) => Promise<PreviewListing>;
  };
  devices: {
    scan: (url: string) => Promise<DeviceListing>;
    /** Tap at a fraction (0..1) of the frame; resolves to an error, or null. */
    tap: (url: string, deviceId: string, x: number, y: number) => Promise<string | null>;
    text: (url: string, deviceId: string, text: string) => Promise<string | null>;
    key: (
      url: string,
      deviceId: string,
      key: "home" | "back" | "enter" | "backspace",
    ) => Promise<string | null>;
  };
  discover: {
    /** Past agent conversations found on that machine. */
    projects: (url: string) => Promise<DiscoveredProject[]>;
    /** Continue one of them inside a workspace. */
    adopt: (
      url: string,
      workspaceId: string,
      nativeSessionId: string,
      title: string | null,
    ) => Promise<string>;
  };
}

const SESSION_ID = "desktop-main";
let commandCounter = 0;

function emptyState(url: string): WorkerState {
  return {
    url,
    connection: "connecting",
    machine: null,
    workspaces: [],
    messages: {},
    approvals: [],
    commands: {},
    todos: {},
    parked: [],
    scheduled: [],
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
            case "machine":
              patch(target.url, (s) => ({ ...s, machine: msg.machine }));
              break;
            case "workspaces":
              patch(target.url, (s) => ({ ...s, workspaces: msg.items }));
              break;
            case "workspace.opened":
            case "workspace.error":
            case "session.created": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              if (msg.type === "workspace.error") pending?.reject(new Error(msg.message));
              else if (msg.type === "workspace.opened") pending?.resolve(msg.workspace);
              else pending?.resolve(msg.sessionId);
              break;
            }
            case "chat.history":
              patch(target.url, (s) => ({
                ...s,
                messages: {
                  ...s.messages,
                  [msg.sessionId]: msg.messages.map((m) => ({
                    role: m.role,
                    text: m.text,
                    ...(m.tool ? { tool: m.tool } : {}),
                    ...(m.target ? { target: m.target } : {}),
                    ...(m.toolId ? { toolId: m.toolId } : {}),
                    ...(m.output ? { output: m.output } : {}),
                    ...(m.isError ? { isError: m.isError } : {}),
                    ...(m.usage ? { usage: m.usage } : {}),
                  })),
                },
              }));
              break;
            case "chat.reasoning":
              patch(target.url, (s) => ({
                ...s,
                messages: {
                  ...s.messages,
                  [msg.sessionId]: appendReasoning(s.messages[msg.sessionId] ?? [], msg.text),
                },
              }));
              break;
            case "chat.tool":
              patch(target.url, (s) => ({
                ...s,
                messages: {
                  ...s.messages,
                  [msg.sessionId]: appendTool(
                    s.messages[msg.sessionId] ?? [],
                    msg.toolId,
                    msg.tool,
                    msg.target,
                  ),
                },
              }));
              break;
            case "chat.delta":
              patch(target.url, (s) => ({
                ...s,
                messages: {
                  ...s.messages,
                  [msg.sessionId]: appendAgentDelta(s.messages[msg.sessionId] ?? [], msg.text),
                },
              }));
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
              patch(target.url, (s) => {
                const commands: Record<string, CommandLine[]> = {};
                for (const [wsId, lines] of Object.entries(s.commands)) {
                  commands[wsId] = lines.map((c) =>
                    c.commandId === msg.commandId
                      ? {
                          ...c,
                          status: msg.approved ? ("done" as const) : ("rejected" as const),
                          code: msg.code,
                          output: msg.output,
                        }
                      : c,
                  );
                }
                return { ...s, commands };
              });
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
            case "fs.written": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              pending?.resolve({ path: msg.path, bytes: msg.bytes });
              break;
            }
            case "discover.result": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              pending?.resolve(msg.projects);
              break;
            }
            case "preview.list": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              // proxyBase is host-relative (":4502/preview") — resolve it
              // against the host we reached this Worker on.
              const host = new URL(target.url).hostname;
              pending?.resolve({
                servers: msg.servers,
                proxyBase: `http://${host}${msg.proxyBase}`,
                token: target.token,
              });
              break;
            }
            case "device.list": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              // streamBase is host-relative (":4502/device"), same as previews.
              const host = new URL(target.url).hostname;
              pending?.resolve({
                devices: msg.devices,
                streamBase: `http://${host}${msg.streamBase}`,
                token: target.token,
              });
              break;
            }
            case "device.input": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              // A rejected tap is a message to show, not a thrown error — the
              // usual cause is simply that idb is not installed.
              pending?.resolve(msg.error);
              break;
            }
            case "fs.error": {
              const pending = fsPending.current.get(msg.requestId);
              fsPending.current.delete(msg.requestId);
              pending?.reject(new Error(msg.message));
              break;
            }
            case "chat.tool.result":
              patch(target.url, (s) => ({
                ...s,
                messages: {
                  ...s.messages,
                  [msg.sessionId]: (s.messages[msg.sessionId] ?? []).map((m) =>
                    m.role === "tool" && m.toolId === msg.toolId
                      ? { ...m, output: msg.output, isError: msg.isError }
                      : m,
                  ),
                },
              }));
              break;
            case "schedule.list":
              patch(target.url, (s) => ({ ...s, scheduled: msg.prompts }));
              break;
            case "tasks.parked":
              patch(target.url, (s) => ({ ...s, parked: msg.tasks }));
              break;
            case "chat.todos":
              patch(target.url, (s) => ({
                ...s,
                todos: { ...s.todos, [msg.sessionId]: msg.todos },
              }));
              break;
            case "chat.usage":
              // Lands on the agent turn currently being streamed.
              patch(target.url, (s) => ({
                ...s,
                messages: {
                  ...s.messages,
                  [msg.sessionId]: attachUsage(s.messages[msg.sessionId] ?? [], msg.usage),
                },
              }));
              break;
            case "notification":
              patch(target.url, (s) => ({
                ...s,
                notices: [msg.notification, ...s.notices].slice(0, 50),
              }));
              // Also raise a real OS notification (no-op without permission).
              raiseOsNotification(msg.notification);
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
    (url: string, workspaceId: string, sessionId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      patch(url, (s) => ({
        ...s,
        messages: {
          ...s.messages,
          [sessionId]: [
            ...(s.messages[sessionId] ?? []),
            { role: "user", text: trimmed },
            { role: "agent", text: "" },
          ],
        },
      }));
      emit(url, { type: "chat.send", workspaceId, sessionId, text: trimmed });
    },
    [emit, patch],
  );

  const runCommand = useCallback(
    (url: string, workspaceId: string, command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;
      const line: CommandLine = {
        commandId: `cmd-${++commandCounter}`,
        command: trimmed,
        status: "pending",
      };
      patch(url, (s) => ({
        ...s,
        commands: {
          ...s.commands,
          [workspaceId]: [line, ...(s.commands[workspaceId] ?? [])].slice(0, 20),
        },
      }));
      emit(url, { type: "command.run", workspaceId, commandId: line.commandId, command: trimmed });
    },
    [emit, patch],
  );

  /** Promise-based request helper shared by workspace/session/fs calls. */
  const request = useCallback(
    <T,>(url: string, build: (requestId: string) => ClientMessage): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const requestId = `rq-${++commandCounter}`;
        fsPending.current.set(requestId, { resolve, reject });
        emit(url, build(requestId));
        setTimeout(() => {
          if (fsPending.current.delete(requestId)) reject(new Error("request timed out"));
        }, 15000);
      }),
    [emit],
  );

  const resumeParked = useCallback(
    (url: string, taskId: string) => emit(url, { type: "task.resumeNow", taskId }),
    [emit],
  );

  const cancelParked = useCallback(
    (url: string, taskId: string) => emit(url, { type: "task.cancel", taskId }),
    [emit],
  );

  const schedulePrompt = useCallback(
    (url: string, workspaceId: string, sessionId: string | null, text: string, runAt: number) =>
      emit(url, {
        type: "schedule.add",
        requestId: `sch-${++commandCounter}`,
        workspaceId,
        sessionId,
        text,
        runAt,
      }),
    [emit],
  );

  const runScheduled = useCallback(
    (url: string, promptId: string) => emit(url, { type: "schedule.runNow", promptId }),
    [emit],
  );

  const cancelScheduled = useCallback(
    (url: string, promptId: string) => emit(url, { type: "schedule.cancel", promptId }),
    [emit],
  );

  const openWorkspace = useCallback(
    (url: string, path: string) =>
      request<Workspace>(url, (requestId) => ({ type: "workspace.open", requestId, path })),
    [request],
  );

  const closeWorkspace = useCallback(
    (url: string, workspaceId: string) => emit(url, { type: "workspace.close", workspaceId }),
    [emit],
  );

  const createSession = useCallback(
    (url: string, workspaceId: string) =>
      request<string>(url, (requestId) => ({ type: "session.create", requestId, workspaceId })),
    [request],
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
      start: (url: string, workspaceId: string, terminalId: string, cols: number, rows: number) =>
        emit(url, { type: "terminal.start", workspaceId, terminalId, cols, rows }),
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

  const fs = useMemo(
    () => ({
      list: (url: string, workspaceId: string, path: string) =>
        request<FileListing>(url, (requestId) => ({
          type: "fs.list",
          requestId,
          workspaceId,
          path,
        })),
      read: (url: string, workspaceId: string, path: string) =>
        request<FilePreview>(url, (requestId) => ({
          type: "fs.read",
          requestId,
          workspaceId,
          path,
        })),
      write: (url: string, workspaceId: string, path: string, content: string) =>
        request<{ path: string; bytes: number }>(url, (requestId) => ({
          type: "fs.write",
          requestId,
          workspaceId,
          path,
          content,
        })),
    }),
    [request],
  );

  const preview = useMemo(
    () => ({
      scan: (url: string) =>
        request<PreviewListing>(url, (requestId) => ({ type: "preview.scan", requestId })),
    }),
    [request],
  );

  const devices = useMemo(
    () => ({
      scan: (url: string) =>
        request<DeviceListing>(url, (requestId) => ({ type: "device.scan", requestId })),
      /** x/y are fractions (0..1) of the displayed frame; the Worker scales them. */
      tap: (url: string, deviceId: string, x: number, y: number) =>
        request<string | null>(url, (requestId) => ({
          type: "device.tap",
          requestId,
          deviceId,
          x,
          y,
        })),
      text: (url: string, deviceId: string, text: string) =>
        request<string | null>(url, (requestId) => ({
          type: "device.text",
          requestId,
          deviceId,
          text,
        })),
      key: (url: string, deviceId: string, key: "home" | "back" | "enter" | "backspace") =>
        request<string | null>(url, (requestId) => ({ type: "device.key", requestId, deviceId, key })),
    }),
    [request],
  );

  const discover = useMemo(
    () => ({
      projects: (url: string) =>
        request<DiscoveredProject[]>(url, (requestId) => ({
          type: "discover.projects",
          requestId,
        })),
      adopt: (url: string, workspaceId: string, nativeSessionId: string, title: string | null) =>
        request<string>(url, (requestId) => ({
          type: "session.adopt",
          requestId,
          workspaceId,
          nativeSessionId,
          title,
        })),
    }),
    [request],
  );

  return {
    workers,
    send,
    runCommand,
    resolveApproval,
    resumeParked,
    cancelParked,
    schedulePrompt,
    runScheduled,
    cancelScheduled,
    openWorkspace,
    closeWorkspace,
    createSession,
    terminal,
    fs,
    preview,
    devices,
    discover,
  };
}

/**
 * Surface a Worker notification as a native OS notification.
 *
 * Silently does nothing unless the user has granted permission — the in-app
 * notification center is always the source of truth, this is the extra nudge
 * for when the window isn't focused.
 */
function raiseOsNotification(n: WorkerNotification): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const notification = new Notification(n.title, {
      body: n.body?.slice(0, 180),
      tag: n.id,
    });
    // Approvals block real work, so keep them on screen; auto-dismiss the rest.
    if (n.kind !== "approval-waiting") setTimeout(() => notification.close(), 6000);
  } catch {
    // Notification constructor can throw in some embedded contexts.
  }
}

/**
 * Reasoning arrives before the answer. It replaces the empty placeholder so a
 * blank agent bubble does not sit above it, and opens a fresh one after.
 */
function appendReasoning(prev: ChatMessage[], text: string): ChatMessage[] {
  const last = prev[prev.length - 1];
  const head = last && last.role === "agent" && last.text === "" ? prev.slice(0, -1) : prev;
  return [...head, { role: "reasoning", text }, { role: "agent", text: "" }];
}

/**
 * Insert a tool action into the transcript.
 *
 * A turn interleaves prose and actions, so the current text block is closed
 * off, the action recorded, and a fresh block opened for whatever the agent
 * says next.
 */
function appendTool(
  prev: ChatMessage[],
  toolId: string,
  tool: string,
  target: string,
): ChatMessage[] {
  const action: ChatMessage = { role: "tool", text: "", tool, target, toolId };
  const last = prev[prev.length - 1];
  // Drop an untouched placeholder rather than leaving an empty bubble behind.
  const head = last && last.role === "agent" && last.text === "" ? prev.slice(0, -1) : prev;
  return [...head, action, { role: "agent", text: "" }];
}

/** Attach usage to the most recent agent message with text in it. */
function attachUsage(prev: ChatMessage[], usage: TurnUsage): ChatMessage[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m && m.role === "agent" && m.text) {
      return [...prev.slice(0, i), { ...m, usage }, ...prev.slice(i + 1)];
    }
  }
  return prev;
}

/**
 * Append a streamed text block to the in-progress agent message.
 *
 * Blocks are separated by a blank line: markdown needs one before a table or
 * list, and running two blocks together turns the second into literal pipes.
 */
function appendAgentDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "agent") {
    const text = last.text ? `${last.text}\n\n${delta}` : delta;
    return [...prev.slice(0, -1), { ...last, text }];
  }
  return [...prev, { role: "agent", text: delta }];
}
