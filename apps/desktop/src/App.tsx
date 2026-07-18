import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Cpu,
  GitBranch,
  MonitorSmartphone,
  Send,
  Bot,
  Wifi,
  WifiOff,
  ShieldAlert,
  Check,
  X,
  Terminal,
  KeyRound,
  Plus,
  Trash2,
  FolderTree,
} from "lucide-react";
import type { ApprovalRequest, WorkspaceSummary } from "@ai-workspace/protocol";
import {
  useWorkers,
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

const DEFAULT_URL = import.meta.env.VITE_WORKER_URL ?? "ws://127.0.0.1:4501";
const STORE_KEY = "aiw.workers";

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
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"chat" | "terminal" | "files">("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { workers, send, runCommand, resolveApproval, terminal, fs } = useWorkers(targets);

  const active: WorkerState | null = useMemo(() => {
    const url = selected && workers[selected] ? selected : targets[0]?.url;
    return url ? workers[url] ?? null : null;
  }, [selected, workers, targets]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages]);

  const persist = (next: WorkerTarget[]) => {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
    setTargets(next);
  };
  const addTarget = (t: WorkerTarget) => {
    persist([...targets.filter((x) => x.url !== t.url), t]);
    setSelected(t.url);
    setAdding(false);
  };
  const removeTarget = (url: string) => {
    persist(targets.filter((t) => t.url !== url));
    if (selected === url) setSelected(null);
  };

  // Every pending approval across every machine.
  const allApprovals = useMemo(
    () =>
      Object.values(workers).flatMap((w) =>
        w.approvals.map((a) => ({ approval: a, url: w.url, host: w.workspaces[0]?.hostname ?? w.url })),
      ),
    [workers],
  );

  if (targets.length === 0 || adding) {
    return (
      <PairingScreen
        onPair={addTarget}
        onCancel={targets.length > 0 ? () => setAdding(false) : undefined}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <Header
        workstations={Object.values(workers)}
        onAdd={() => setAdding(true)}
      />
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="flex flex-col gap-3 overflow-y-auto pr-1">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            Workstations ({targets.length})
          </h2>

          {targets.map((t) => {
            const w = workers[t.url];
            return (
              <WorkstationCard
                key={t.url}
                url={t.url}
                state={w}
                selected={active?.url === t.url}
                onSelect={() => setSelected(t.url)}
                onRemove={() => removeTarget(t.url)}
              />
            );
          })}

          <ApprovalCenter items={allApprovals} onResolve={resolveApproval} />

          {active && (
            <CommandRunner
              connected={active.connection === "connected"}
              commands={active.commands}
              onRun={(cmd) => runCommand(active.url, cmd)}
            />
          )}
        </section>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex-row items-center gap-1 space-y-0 border-b py-2">
            <Button
              size="sm"
              variant={tab === "chat" ? "secondary" : "ghost"}
              onClick={() => setTab("chat")}
            >
              <Bot className="h-3.5 w-3.5" /> Chat
            </Button>
            <Button
              size="sm"
              variant={tab === "terminal" ? "secondary" : "ghost"}
              onClick={() => setTab("terminal")}
            >
              <Terminal className="h-3.5 w-3.5" /> Terminal
            </Button>
            <Button
              size="sm"
              variant={tab === "files" ? "secondary" : "ghost"}
              onClick={() => setTab("files")}
            >
              <FolderTree className="h-3.5 w-3.5" /> Files
            </Button>
            {active && (
              <span className="ml-auto text-xs text-muted-foreground">
                {active.workspaces[0]?.hostname ?? active.url}
              </span>
            )}
          </CardHeader>

          {tab === "terminal" ? (
            <div className="min-h-0 flex-1 bg-[#0a0a0b] p-2">
              {active && (
                <TerminalPanel
                  key={active.url}
                  url={active.url}
                  terminalId="main"
                  terminal={terminal}
                  connected={active.connection === "connected"}
                />
              )}
            </div>
          ) : tab === "files" ? (
            <div className="min-h-0 flex-1">
              {active && (
                <FilesPanel
                  key={active.url}
                  url={active.url}
                  fs={fs}
                  connected={active.connection === "connected"}
                />
              )}
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {!active || active.messages.length === 0 ? (
                  <p className="mt-8 text-center text-sm text-muted-foreground">
                    Send a message to the agent on this workstation.
                  </p>
                ) : (
                  active.messages.map((m, i) => <Bubble key={i} role={m.role} text={m.text} />)
                )}
              </div>
              <div className="flex items-center gap-2 border-t p-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && active) {
                      send(active.url, draft);
                      setDraft("");
                    }
                  }}
                  placeholder={
                    active?.connection === "connected" ? "Message the agent…" : "Connecting…"
                  }
                  disabled={active?.connection !== "connected"}
                />
                <Button
                  size="icon"
                  disabled={active?.connection !== "connected" || !draft.trim()}
                  onClick={() => {
                    if (!active) return;
                    send(active.url, draft);
                    setDraft("");
                  }}
                >
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

function Header({ workstations, onAdd }: { workstations: WorkerState[]; onAdd: () => void }) {
  const online = workstations.filter((w) => w.connection === "connected").length;
  return (
    <header className="flex items-center justify-between border-b px-5 py-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <MonitorSmartphone className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">AI Workspace</div>
          <div className="text-xs text-muted-foreground">
            {online} of {workstations.length} connected
          </div>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" /> Add workstation
      </Button>
    </header>
  );
}

function WorkstationCard({
  url,
  state,
  selected,
  onSelect,
  onRemove,
}: {
  url: string;
  state?: WorkerState;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const ws: WorkspaceSummary | undefined = state?.workspaces[0];
  const connection = state?.connection ?? "connecting";
  return (
    <Card
      onClick={onSelect}
      className={`cursor-pointer transition-colors ${selected ? "border-primary/60" : "hover:border-muted-foreground/30"}`}
    >
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">{ws?.hostname ?? url}</CardTitle>
        <div className="flex items-center gap-1">
          <StatusBadge connection={connection} status={ws?.status} />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <Row icon={<Bot className="h-3.5 w-3.5" />} label={ws?.agent ?? "no agent"} />
        <Row icon={<GitBranch className="h-3.5 w-3.5" />} label={shortenPath(ws?.repo ?? null)} />
        <Row icon={<Terminal className="h-3.5 w-3.5" />} label={url.replace("ws://", "")} />
        {ws?.activeTask && <Row icon={<Cpu className="h-3.5 w-3.5" />} label={ws.activeTask} />}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  connection,
  status,
}: {
  connection: ConnectionState;
  status?: WorkspaceSummary["status"];
}) {
  if (connection === "unauthorized") return <Badge variant="offline">bad code</Badge>;
  if (connection !== "connected") return <Badge variant="offline">{connection}</Badge>;
  if (status === "busy") return <Badge variant="busy">busy</Badge>;
  return <Badge variant="success">online</Badge>;
}

function Row({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "agent"; text: string }) {
  const isUser = role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
            : "max-w-[80%] rounded-lg rounded-bl-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground"
        }
      >
        {text || <span className="opacity-50">…</span>}
      </div>
    </div>
  );
}

function ApprovalCenter({
  items,
  onResolve,
}: {
  items: { approval: ApprovalRequest; url: string; host: string }[];
  onResolve: (url: string, id: string, approved: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <CardTitle className="text-sm">Approval Center</CardTitle>
        <Badge variant="busy" className="ml-auto">
          {items.length} pending
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map(({ approval: a, url, host }) => (
          <div key={`${url}:${a.id}`} className="rounded-md border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{a.kind}</Badge>
              <span className="text-sm font-medium">{a.summary}</span>
              <Badge variant="secondary" className="ml-auto">
                {host}
              </Badge>
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
              {a.details}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => onResolve(url, a.id, true)}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onResolve(url, a.id, false)}>
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CommandRunner({
  connected,
  commands,
  onRun,
}: {
  connected: boolean;
  commands: CommandLine[];
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
        <CardTitle className="text-sm">Run Command</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. git status  ·  rm file  ·  docker ps"
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
          <CardTitle>Add a workstation</CardTitle>
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

function shortenPath(p: string | null): string {
  if (!p) return "no repo";
  const parts = p.split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}
