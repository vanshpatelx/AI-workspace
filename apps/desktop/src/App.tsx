import { useEffect, useRef, useState, type ReactNode } from "react";
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
  LogOut,
} from "lucide-react";
import type { ApprovalRequest, WorkspaceSummary } from "@ai-workspace/protocol";
import { useWorker, type CommandLine, type ConnectionState } from "./lib/useWorker.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "ws://127.0.0.1:4501";
const TOKEN_KEY = "aiw.pairingToken";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const { connection, workspaces, messages, approvals, commands, notices, send, runCommand, resolveApproval } =
    useWorker(WORKER_URL, token);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const pair = (code: string) => {
    localStorage.setItem(TOKEN_KEY, code);
    setToken(code);
  };
  const unpair = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
  };

  // All hooks must run on every render — keep them above the pairing branch.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  if (!token || connection === "unauthorized") {
    return <PairingScreen rejected={!!token && connection === "unauthorized"} onPair={pair} onClear={unpair} />;
  }

  const submit = () => {
    send(draft);
    setDraft("");
  };

  return (
    <div className="flex h-screen flex-col">
      <Header connection={connection} count={workspaces.length} onUnpair={unpair} />
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Dashboard */}
        <section className="flex flex-col gap-3 overflow-y-auto pr-1">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Workstations</h2>
          {workspaces.length === 0 ? (
            <EmptyState connection={connection} />
          ) : (
            workspaces.map((w) => <WorkspaceCard key={w.workerId} w={w} />)
          )}

          <ApprovalCenter approvals={approvals} onResolve={resolveApproval} />

          <CommandRunner
            connected={connection === "connected"}
            commands={commands}
            onRun={runCommand}
          />

          {notices.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notices
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {notices.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </CardContent>
            </Card>
          )}
        </section>

        {/* Chat */}
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4" /> Persistent Chat
            </CardTitle>
          </CardHeader>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="mt-8 text-center text-sm text-muted-foreground">
                Send a message to the agent on this workspace.
              </p>
            ) : (
              messages.map((m, i) => <Bubble key={i} role={m.role} text={m.text} />)
            )}
          </div>
          <div className="flex items-center gap-2 border-t p-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
              placeholder={connection === "connected" ? "Message the agent…" : "Connecting…"}
              disabled={connection !== "connected"}
            />
            <Button onClick={submit} size="icon" disabled={connection !== "connected" || !draft.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Header({
  connection,
  count,
  onUnpair,
}: {
  connection: ConnectionState;
  count: number;
  onUnpair: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b px-5 py-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <MonitorSmartphone className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">AI Workspace</div>
          <div className="text-xs text-muted-foreground">{count} workstation{count === 1 ? "" : "s"}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ConnBadge connection={connection} />
        <Button size="sm" variant="ghost" onClick={onUnpair} title="Unpair">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  );
}

function PairingScreen({
  rejected,
  onPair,
  onClear,
}: {
  rejected: boolean;
  onPair: (code: string) => void;
  onClear: () => void;
}) {
  const [code, setCode] = useState("");
  return (
    <div className="flex h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>Pair with a Worker</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter the pairing code shown by <code className="text-xs">aiw worker init</code>.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {rejected && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
              That pairing code was rejected by the Worker.
            </div>
          )}
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && onPair(code.trim())}
            placeholder="AIW-XXXX-XXXX"
            className="text-center font-mono tracking-widest"
          />
          <Button className="w-full" disabled={!code.trim()} onClick={() => onPair(code.trim())}>
            Connect
          </Button>
          {rejected && (
            <Button variant="ghost" size="sm" className="w-full" onClick={onClear}>
              Clear saved code
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConnBadge({ connection }: { connection: ConnectionState }) {
  if (connection === "connected")
    return (
      <Badge variant="success">
        <Wifi className="h-3 w-3" /> Connected
      </Badge>
    );
  return (
    <Badge variant={connection === "connecting" ? "busy" : "offline"}>
      <WifiOff className="h-3 w-3" /> {connection === "connecting" ? "Connecting" : "Disconnected"}
    </Badge>
  );
}

function WorkspaceCard({ w }: { w: WorkspaceSummary }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">{w.hostname}</CardTitle>
        <StatusBadge status={w.status} />
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <Row icon={<Bot className="h-3.5 w-3.5" />} label={w.agent ?? "no agent"} />
        <Row icon={<GitBranch className="h-3.5 w-3.5" />} label={shortenPath(w.repo)} />
        {w.activeTask && <Row icon={<Cpu className="h-3.5 w-3.5" />} label={w.activeTask} />}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: WorkspaceSummary["status"] }) {
  if (status === "busy") return <Badge variant="busy">busy</Badge>;
  if (status === "online") return <Badge variant="success">online</Badge>;
  return <Badge variant="offline">offline</Badge>;
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

function EmptyState({ connection }: { connection: ConnectionState }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        {connection === "connected"
          ? "No workstations reporting yet."
          : "Waiting for a Worker on ws://127.0.0.1:4501…"}
      </CardContent>
    </Card>
  );
}

function ApprovalCenter({
  approvals,
  onResolve,
}: {
  approvals: ApprovalRequest[];
  onResolve: (id: string, approved: boolean) => void;
}) {
  if (approvals.length === 0) return null;
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <CardTitle className="text-sm">Approval Center</CardTitle>
        <Badge variant="busy" className="ml-auto">
          {approvals.length} pending
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.map((a) => (
          <div key={a.id} className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{a.kind}</Badge>
              <span className="text-sm font-medium">{a.summary}</span>
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
              {a.details}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => onResolve(a.id, true)}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onResolve(a.id, false)}>
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

function shortenPath(p: string | null): string {
  if (!p) return "no repo";
  const parts = p.split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}
