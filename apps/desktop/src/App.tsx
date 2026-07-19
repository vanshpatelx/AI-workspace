import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  MonitorSmartphone,
  Send,
  Bot,
  ShieldAlert,
  Check,
  X,
  Terminal,
  KeyRound,
  Plus,
  Trash2,
  FolderTree,
  Globe,
  FolderOpen,
  GitBranch,
  Sparkles,
  FileCode,
} from "lucide-react";
import type { ApprovalRequest, Workspace } from "@ai-workspace/protocol";
import {
  useWorkers,
  type ChatMessage,
  type CommandLine,
  type ConnectionState,
  type WorkerState,
  type WorkerTarget,
} from "./lib/useWorkers.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { TerminalPanel } from "./components/TerminalPanel.js";
import { FilesPanel } from "./components/FilesPanel.js";
import { PreviewPanel } from "./components/PreviewPanel.js";
import { NotificationCenter, type FeedItem } from "./components/NotificationCenter.js";
import { Markdown } from "./components/Markdown.js";
import { ToolCall } from "./components/ToolCall.js";
import { UsageBar } from "./components/UsageBar.js";
import { ApprovalCard, ApprovalCenter } from "./components/ApprovalCard.js";
import { LiveActivity } from "./components/LiveActivity.js";
import { RecentProjects } from "./components/RecentProjects.js";
import type { OpenFile } from "./components/EditorPanel.js";
import { TodoQueue } from "./components/TodoQueue.js";
import { StepGroup } from "./components/StepGroup.js";
import { ParkedBanner } from "./components/ParkedBanner.js";
import { SchedulePicker, ScheduledList } from "./components/SchedulePicker.js";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "./components/ai-elements/reasoning.js";

/**
 * Monaco is several megabytes and only needed once the Editor tab is opened,
 * so it is split out of the initial bundle. Loading it eagerly also pushed the
 * production build past the memory available on a CI runner.
 */
const EditorPanel = lazy(() =>
  import("./components/EditorPanel.js").then((m) => ({ default: m.EditorPanel })),
);

const DEFAULT_URL = import.meta.env.VITE_WORKER_URL ?? "ws://127.0.0.1:4501";
const STORE_KEY = "aiw.workers";

const TABS = [
  { id: "chat", label: "Chat", Icon: Bot },
  { id: "terminal", label: "Terminal", Icon: Terminal },
  { id: "files", label: "Files", Icon: FolderTree },
  { id: "editor", label: "Editor", Icon: FileCode },
  { id: "preview", label: "Preview", Icon: Globe },
] as const;

/** What the user is currently looking at: a workspace, and a chat inside it. */
interface Selection {
  url: string;
  workspaceId: string;
  sessionId: string | null;
}

function loadTargets(): WorkerTarget[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as WorkerTarget[]) : [];
  } catch {
    return [];
  }
}

export function App() {
  const [targets, setTargets] = useState<WorkerTarget[]>(loadTargets);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"chat" | "terminal" | "files" | "editor" | "preview">("chat");
  /** Files open in the editor, keyed by workspace so tabs follow the project. */
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFile[]>>({});
  const [activeFile, setActiveFile] = useState<Record<string, string | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const api = useWorkers(targets);
  const {
    workers,
    send,
    runCommand,
    resolveApproval,
    openWorkspace,
    closeWorkspace,
    createSession,
    resumeParked,
    cancelParked,
    schedulePrompt,
    runScheduled,
    cancelScheduled,
  } = api;

  // Resolve the selection against live state, falling back to the first
  // workspace so the app is never pointing at something that vanished.
  const active = useMemo(() => {
    const worker = selection ? workers[selection.url] : undefined;
    const workspace = worker?.workspaces.find((w) => w.workspaceId === selection?.workspaceId);
    if (worker && workspace) return { worker, workspace };
    for (const w of Object.values(workers)) {
      const first = w.workspaces[0];
      if (first) return { worker: w, workspace: first };
    }
    return null;
  }, [selection, workers]);

  const activeSessionId = useMemo(() => {
    if (!active) return null;
    const ids = active.workspace.sessionIds;
    if (selection?.sessionId && ids.includes(selection.sessionId)) return selection.sessionId;
    return ids[0] ?? null;
  }, [active, selection]);

  const messages = useMemo(
    () => (activeSessionId && active ? active.worker.messages[activeSessionId] ?? [] : []),
    [active, activeSessionId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const feed: FeedItem[] = useMemo(
    () =>
      Object.values(workers)
        .flatMap((w) =>
          w.notices.map((n) => ({ notification: n, host: w.machine?.hostname ?? w.url })),
        )
        .sort((a, b) => b.notification.at - a.notification.at),
    [workers],
  );

  // Approvals raised by the workspace on screen belong in the transcript,
  // where the surrounding turn explains why the agent wants this.
  const inlineApprovals = useMemo(() => {
    if (!active) return [];
    return active.worker.approvals.filter(
      (a) => !a.workspaceId || a.workspaceId === active.workspace.workspaceId,
    );
  }, [active]);

  const allApprovals = useMemo(
    () =>
      Object.values(workers).flatMap((w) =>
        w.approvals.map((a) => ({ approval: a, url: w.url, host: w.machine?.hostname ?? w.url })),
      ),
    [workers],
  );

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  }, []);

  const persist = (next: WorkerTarget[]) => {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
    setTargets(next);
  };

  // Hooks are all above this branch on purpose — an early return that skips
  // hooks changes their order between renders and crashes React.
  if (targets.length === 0 || adding) {
    return (
      <PairingScreen
        onPair={(t) => {
          persist([...targets.filter((x) => x.url !== t.url), t]);
          setAdding(false);
        }}
        onCancel={targets.length > 0 ? () => setAdding(false) : undefined}
      />
    );
  }

  const wsKey = active ? `${active.worker.url}:${active.workspace.workspaceId}` : "";
  const filesOpen = openFiles[wsKey] ?? [];

  /** Open a file in the editor, or focus it if already open. */
  const openInEditor = (path: string, content: string) => {
    setOpenFiles((prev) => {
      const list = prev[wsKey] ?? [];
      // Reopening keeps any unsaved draft rather than discarding it.
      if (list.some((f) => f.path === path)) return prev;
      return { ...prev, [wsKey]: [...list, { path, saved: content, draft: content }] };
    });
    setActiveFile((prev) => ({ ...prev, [wsKey]: path }));
    setTab("editor");
  };

  const connected = active?.worker.connection === "connected";
  // The Worker reports per-workspace activity; pair it with the last tool the
  // agent reached for, so the footer says something concrete.
  const isWorking = Boolean(active?.workspace.activeTask);
  const lastTool = [...messages].reverse().find((m) => m.role === "tool");
  const activityLabel = lastTool?.tool
    ? `${lastTool.tool}${lastTool.target ? ` · ${lastTool.target.split("/").pop()}` : ""}`
    : (active?.workspace.activeTask ?? "working");

  const submitChat = async () => {
    if (!active || !draft.trim()) return;
    // First message in a workspace creates its session implicitly.
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await createSession(active.worker.url, active.workspace.workspaceId);
      setSelection({
        url: active.worker.url,
        workspaceId: active.workspace.workspaceId,
        sessionId,
      });
    }
    send(active.worker.url, active.workspace.workspaceId, sessionId, draft);
    setDraft("");
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MonitorSmartphone className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">AI Workspace</div>
            <div className="text-xs text-muted-foreground">
              {Object.values(workers).filter((w) => w.connection === "connected").length} of{" "}
              {targets.length} machines ·{" "}
              {Object.values(workers).reduce((n, w) => n + w.workspaces.length, 0)} workspaces
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NotificationCenter items={feed} />
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add machine
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <section className="flex flex-col gap-3 overflow-y-auto pr-1">
          {targets.map((t) => (
            <MachinePanel
              key={t.url}
              url={t.url}
              state={workers[t.url]}
              activeWorkspaceId={active?.workspace.workspaceId ?? null}
              onSelectWorkspace={(workspaceId) =>
                setSelection({ url: t.url, workspaceId, sessionId: null })
              }
              onOpen={(path) => openWorkspace(t.url, path)}
              onCloseWorkspace={(workspaceId) => closeWorkspace(t.url, workspaceId)}
              onRemove={() => persist(targets.filter((x) => x.url !== t.url))}
            />
          ))}

          {targets.map((t) =>
            (workers[t.url]?.parked ?? []).length > 0 ? (
              <ParkedBanner
                key={`parked-${t.url}`}
                tasks={workers[t.url]?.parked ?? []}
                onResumeNow={(id) => resumeParked(t.url, id)}
                onCancel={(id) => cancelParked(t.url, id)}
              />
            ) : null,
          )}

          {active && (
            <ScheduledList
              prompts={(active.worker.scheduled ?? []).filter(
                (p) => p.workspaceId === active.workspace.workspaceId,
              )}
              onRunNow={(id) => runScheduled(active.worker.url, id)}
              onCancel={(id) => cancelScheduled(active.worker.url, id)}
            />
          )}

          {targets.map((t) => (
            <RecentProjects
              key={`recent-${t.url}`}
              connected={workers[t.url]?.connection === "connected"}
              openPaths={(workers[t.url]?.workspaces ?? []).map((w) => w.path)}
              onDiscover={() => api.discover.projects(t.url)}
              onOpenProject={async (path) => {
                const ws = await openWorkspace(t.url, path);
                setSelection({ url: t.url, workspaceId: ws.workspaceId, sessionId: null });
              }}
              onResumeSession={async (path, session) => {
                // Open the project, then bind a session to the old
                // conversation so the next message continues it.
                const ws = await openWorkspace(t.url, path);
                const sessionId = await api.discover.adopt(
                  t.url,
                  ws.workspaceId,
                  session.sessionId,
                  session.title,
                );
                setSelection({ url: t.url, workspaceId: ws.workspaceId, sessionId });
                setTab("chat");
              }}
            />
          ))}

          <ApprovalCenter
            items={allApprovals.filter(
              (i) => !inlineApprovals.some((a) => a.id === i.approval.id),
            )}
            onResolve={resolveApproval}
          />

          {active && (
            <CommandRunner
              connected={!!connected}
              commands={active.worker.commands[active.workspace.workspaceId] ?? []}
              workspaceName={active.workspace.name}
              onRun={(cmd) => runCommand(active.worker.url, active.workspace.workspaceId, cmd)}
            />
          )}
        </section>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex-row items-center gap-1 space-y-0 border-b py-2">
            {TABS.map(({ id, label, Icon }) => (
              <Button
                key={id}
                size="sm"
                variant={tab === id ? "secondary" : "ghost"}
                onClick={() => setTab(id)}
                disabled={!active}
              >
                <Icon className="h-3.5 w-3.5" />
                {/* Real text, not CSS-capitalised — that keeps the accessible
                    name matching what people actually see. */}
                <span>{label}</span>
              </Button>
            ))}
            {active && (
              <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                {active.workspace.name} · {active.worker.machine?.hostname ?? active.worker.url}
              </span>
            )}
          </CardHeader>

          {!active ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Open a workspace to get started — type a project path on the left.
            </div>
          ) : tab === "terminal" ? (
            <div className="min-h-0 flex-1 bg-[#0a0a0b] p-2">
              <TerminalPanel
                key={`${active.worker.url}:${active.workspace.workspaceId}`}
                url={active.worker.url}
                workspaceId={active.workspace.workspaceId}
                terminalId={`term-${active.workspace.workspaceId}`}
                terminal={api.terminal}
                connected={!!connected}
              />
            </div>
          ) : tab === "editor" ? (
            <div className="min-h-0 flex-1">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading editor…
                  </div>
                }
              >
              <EditorPanel
                url={active.worker.url}
                workspaceId={active.workspace.workspaceId}
                fs={api.fs}
                connected={!!connected}
                files={filesOpen}
                activePath={activeFile[wsKey] ?? filesOpen[0]?.path ?? null}
                onSelect={(path) => setActiveFile((p) => ({ ...p, [wsKey]: path }))}
                onClose={(path) =>
                  setOpenFiles((p) => ({
                    ...p,
                    [wsKey]: (p[wsKey] ?? []).filter((f) => f.path !== path),
                  }))
                }
                onChange={(path, draft) =>
                  setOpenFiles((p) => ({
                    ...p,
                    [wsKey]: (p[wsKey] ?? []).map((f) => (f.path === path ? { ...f, draft } : f)),
                  }))
                }
                onSaved={(path, content) =>
                  setOpenFiles((p) => ({
                    ...p,
                    [wsKey]: (p[wsKey] ?? []).map((f) =>
                      f.path === path ? { ...f, saved: content, draft: content } : f,
                    ),
                  }))
                }
              />
              </Suspense>
            </div>
          ) : tab === "files" ? (
            <div className="min-h-0 flex-1">
              <FilesPanel
                key={`${active.worker.url}:${active.workspace.workspaceId}`}
                url={active.worker.url}
                workspaceId={active.workspace.workspaceId}
                fs={api.fs}
                connected={!!connected}
                onEdit={openInEditor}
              />
            </div>
          ) : tab === "preview" ? (
            <div className="min-h-0 flex-1">
              <PreviewPanel
                key={active.worker.url}
                url={active.worker.url}
                preview={api.preview}
                connected={!!connected}
              />
            </div>
          ) : (
            <>
              {/* A workspace can hold several conversations at once. */}
              <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
                {active.workspace.sessionIds.map((id, i) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={id === activeSessionId ? "secondary" : "ghost"}
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() =>
                      setSelection({
                        url: active.worker.url,
                        workspaceId: active.workspace.workspaceId,
                        sessionId: id,
                      })
                    }
                  >
                    Session {i + 1}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-2 text-xs"
                  disabled={!connected}
                  onClick={async () => {
                    const sessionId = await createSession(
                      active.worker.url,
                      active.workspace.workspaceId,
                    );
                    setSelection({
                      url: active.worker.url,
                      workspaceId: active.workspace.workspaceId,
                      sessionId,
                    });
                  }}
                >
                  <Plus className="h-3 w-3" /> New session
                </Button>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <p className="mt-8 text-center text-sm text-muted-foreground">
                    Chatting in <span className="font-medium">{active.workspace.name}</span> — the
                    agent runs in that directory.
                  </p>
                ) : (
                  groupIntoSteps(messages).map((entry, i) =>
                    entry.kind === "step" ? (
                      <StepGroup key={i} index={entry.index} tools={entry.tools} />
                    ) : (
                      <Turn
                        key={i}
                        message={entry.message}
                        streaming={entry.isLast && isWorking}
                        activity={activityLabel}
                      />
                    ),
                  )
                )}
              </div>

              {activeSessionId && (active.worker.todos[activeSessionId]?.length ?? 0) > 0 && (
                <div className="border-t px-4 py-2">
                  <TodoQueue todos={active.worker.todos[activeSessionId] ?? []} />
                </div>
              )}

              {inlineApprovals.length > 0 && active && (
                <div className="border-t px-4 py-2">
                  {inlineApprovals.map((a) => (
                    <ApprovalCard
                      key={a.id}
                      request={a}
                      onResolve={(approved) => resolveApproval(active.worker.url, a.id, approved)}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 border-t p-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void submitChat()}
                  placeholder={connected ? `Message the agent in ${active.workspace.name}…` : "Connecting…"}
                  disabled={!connected}
                />
                <SchedulePicker
                  disabled={!connected}
                  hasText={Boolean(draft.trim())}
                  onSchedule={(runAt) => {
                    if (!active) return;
                    schedulePrompt(
                      active.worker.url,
                      active.workspace.workspaceId,
                      activeSessionId,
                      draft,
                      runAt,
                    );
                    setDraft("");
                  }}
                />
                <Button size="icon" disabled={!connected || !draft.trim()} onClick={() => void submitChat()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function MachinePanel({
  url,
  state,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpen,
  onCloseWorkspace,
  onRemove,
}: {
  url: string;
  state?: WorkerState;
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpen: (path: string) => Promise<Workspace>;
  onCloseWorkspace: (workspaceId: string) => void;
  onRemove: () => void;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connection = state?.connection ?? "connecting";
  const machine = state?.machine;

  const submit = async () => {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const workspace = await onOpen(path);
      setPath("");
      onSelectWorkspace(workspace.workspaceId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="truncate text-sm">{machine?.hostname ?? url}</CardTitle>
        <div className="flex items-center gap-1">
          <ConnBadge connection={connection} status={machine?.status} />
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Remove" onClick={onRemove}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="h-3.5 w-3.5" />
          <span>{machine?.agent ?? "no agent"}</span>
          <span className="ml-auto truncate">{url.replace("ws://", "")}</span>
        </div>

        {state?.workspaces.length ? (
          <div className="space-y-1">
            {state.workspaces.map((w) => (
              <div
                key={w.workspaceId}
                onClick={() => onSelectWorkspace(w.workspaceId)}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                  w.workspaceId === activeWorkspaceId
                    ? "border-primary/60 bg-accent"
                    : "hover:bg-accent/50"
                }`}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                <span className="truncate font-medium">{w.name}</span>
                {w.branch && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <GitBranch className="h-3 w-3" />
                    {w.branch}
                  </span>
                )}
                {w.activeTask && (
                  <Badge variant="busy" className="shrink-0 px-1.5 py-0 text-[10px]">
                    busy
                  </Badge>
                )}
                <button
                  title="Close workspace"
                  className="ml-auto shrink-0 opacity-40 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWorkspace(w.workspaceId);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-1 text-xs text-muted-foreground">No workspaces open yet.</p>
        )}

        <div className="flex gap-1.5 pt-1">
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="~/code/my-project"
            disabled={connection !== "connected" || busy}
            className="h-7 font-mono text-[11px]"
          />
          <Button
            size="sm"
            className="h-7"
            aria-label="Open workspace at path"
            onClick={() => void submit()}
            disabled={connection !== "connected" || busy || !path.trim()}
          >
            Open
          </Button>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ConnBadge({ connection, status }: { connection: ConnectionState; status?: string }) {
  if (connection === "unauthorized") return <Badge variant="offline">bad code</Badge>;
  if (connection !== "connected") return <Badge variant="offline">{connection}</Badge>;
  if (status === "busy") return <Badge variant="busy">busy</Badge>;
  return <Badge variant="success">online</Badge>;
}

type Rendered =
  | { kind: "step"; index: number; tools: ChatMessage[] }
  | { kind: "turn"; message: ChatMessage; isLast: boolean };

/**
 * Collapse consecutive tool calls into numbered steps.
 *
 * Text and actions interleave, so a step is simply an unbroken run of tool
 * turns; anything else passes through untouched.
 */
function groupIntoSteps(messages: ChatMessage[]): Rendered[] {
  const out: Rendered[] = [];
  let run: ChatMessage[] = [];
  let step = 0;

  const flush = () => {
    if (run.length === 0) return;
    out.push({ kind: "step", index: ++step, tools: run });
    run = [];
  };

  messages.forEach((message, i) => {
    if (message.role === "tool") {
      run.push(message);
      return;
    }
    flush();
    out.push({ kind: "turn", message, isLast: i === messages.length - 1 });
  });
  flush();
  return out;
}

/**
 * One entry in the transcript.
 *
 * Agent replies are full-width and markdown-rendered rather than squeezed into
 * a bubble — they routinely contain tables and code, which a narrow bubble
 * mangles. The user's own messages stay compact and visually distinct.
 */
function Turn({
  message,
  streaming,
  activity,
}: {
  message: ChatMessage;
  streaming: boolean;
  activity?: string;
}) {
  if (message.role === "reasoning") {
    return (
      <Reasoning className="my-1.5" isStreaming={streaming && !message.text}>
        <ReasoningTrigger />
        <ReasoningContent>{message.text}</ReasoningContent>
      </Reasoning>
    );
  }

  if (message.role === "tool") {
    return (
      <ToolCall
        tool={message.tool ?? "Tool"}
        target={message.target}
        output={message.output}
        isError={message.isError}
      />
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.text}
        </div>
      </div>
    );
  }

  if (!message.text) {
    // An empty trailing agent turn means the round is still open.
    return streaming ? <LiveActivity what={activity ?? "working"} /> : null;
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-secondary">
        <Sparkles className="h-3 w-3 text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <Markdown text={message.text} />
        {message.usage && <UsageBar usage={message.usage} />}
      </div>
    </div>
  );
}

function CommandRunner({
  connected,
  commands,
  workspaceName,
  onRun,
}: {
  connected: boolean;
  commands: CommandLine[];
  workspaceName: string;
  onRun: (command: string) => void;
}) {
  const [cmd, setCmd] = useState("");
  const submit = () => {
    onRun(cmd);
    setCmd("");
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
        <Terminal className="h-4 w-4" />
        <CardTitle className="truncate text-sm">Run in {workspaceName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="git status · npm test · docker ps"
            disabled={!connected}
            className="font-mono text-xs"
          />
          <Button size="sm" onClick={submit} disabled={!connected || !cmd.trim()}>
            Run
          </Button>
        </div>
        {commands.map((c) => (
          <div key={c.commandId} className="rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <CmdStatus status={c.status} />
              <code className="truncate text-xs">{c.command}</code>
            </div>
            {c.output && (
              <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {c.output}
              </pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CmdStatus({ status }: { status: CommandLine["status"] }) {
  if (status === "pending") return <Badge variant="busy">awaiting approval</Badge>;
  if (status === "rejected") return <Badge variant="offline">rejected</Badge>;
  if (status === "done") return <Badge variant="success">ran</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function PairingScreen({
  onPair,
  onCancel,
}: {
  onPair: (t: WorkerTarget) => void;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [code, setCode] = useState("");
  const submit = () => code.trim() && onPair({ url: url.trim(), token: code.trim() });
  return (
    <div className="flex h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>Add a machine</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter its address and the code from <code className="text-xs">aiw worker status</code>.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://127.0.0.1:4501"
            className="font-mono text-xs"
          />
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="AIW-XXXX-XXXX"
            className="text-center font-mono tracking-widest"
          />
          <Button className="w-full" disabled={!code.trim()} onClick={submit}>
            Connect
          </Button>
          {onCancel && (
            <Button variant="ghost" size="sm" className="w-full" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
