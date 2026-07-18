import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cpu, GitBranch, MonitorSmartphone, Send, Bot, Wifi, WifiOff } from "lucide-react";
import type { WorkspaceSummary } from "@ai-workspace/protocol";
import { useWorker, type ConnectionState } from "./lib/useWorker.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "ws://127.0.0.1:4501";

export function App() {
  const { connection, workspaces, messages, notices, send } = useWorker(WORKER_URL);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    send(draft);
    setDraft("");
  };

  return (
    <div className="flex h-screen flex-col">
      <Header connection={connection} count={workspaces.length} />
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Dashboard */}
        <section className="flex flex-col gap-3 overflow-y-auto pr-1">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Workstations</h2>
          {workspaces.length === 0 ? (
            <EmptyState connection={connection} />
          ) : (
            workspaces.map((w) => <WorkspaceCard key={w.workerId} w={w} />)
          )}
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

function Header({ connection, count }: { connection: ConnectionState; count: number }) {
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
      <ConnBadge connection={connection} />
    </header>
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

function shortenPath(p: string | null): string {
  if (!p) return "no repo";
  const parts = p.split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}
