import { useCallback, useEffect, useState } from "react";
import { History, FolderOpen, MessageSquare, ChevronRight, RefreshCw } from "lucide-react";
import type { DiscoveredProject, DiscoveredSession } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

/**
 * Projects the agent has worked in before, read from its own history.
 *
 * These are conversations that already exist on the machine — many started in
 * a terminal, outside this app. Opening one restores the project *and* lets a
 * past conversation be resumed with its full context intact.
 */
export function RecentProjects({
  connected,
  openPaths,
  onDiscover,
  onOpenProject,
  onResumeSession,
}: {
  connected: boolean;
  /** Paths already open, so they aren't offered twice. */
  openPaths: string[];
  onDiscover: () => Promise<DiscoveredProject[]>;
  onOpenProject: (path: string) => Promise<void>;
  onResumeSession: (path: string, session: DiscoveredSession) => Promise<void>;
}) {
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!connected) return;
    setBusy(true);
    setError(null);
    try {
      setProjects(await onDiscover());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [connected, onDiscover]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const unopened = projects.filter((p) => !openPaths.includes(p.path));
  if (!connected) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Recent projects</span>
        {unopened.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {unopened.length}
          </Badge>
        )}
        <Button
          size="icon"
          variant="ghost"
          className={unopened.length > 0 ? "h-6 w-6" : "ml-auto h-6 w-6"}
          onClick={() => void scan()}
          title="Rescan"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && <p className="px-3 py-2 text-[11px] text-destructive">{error}</p>}

      {unopened.length === 0 && !busy && !error ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No past projects found on this machine.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto p-1.5">
          {unopened.map((project) => (
            <div key={project.path}>
              <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent/50">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setExpanded(expanded === project.path ? null : project.path)}
                  title={project.path}
                >
                  <ChevronRight
                    className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                      expanded === project.path ? "rotate-90" : ""
                    }`}
                  />
                  <span className="truncate text-xs font-medium">{project.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {project.sessions.length} · {ago(project.updatedAt)}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-1.5 text-[10px]"
                  onClick={() => void onOpenProject(project.path)}
                >
                  <FolderOpen className="h-3 w-3" /> Open
                </Button>
              </div>

              {expanded === project.path && (
                <div className="ml-4 space-y-0.5 border-l pl-2">
                  {project.sessions.map((session) => (
                    <button
                      key={session.sessionId}
                      onClick={() => void onResumeSession(project.path, session)}
                      className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent/50"
                      title="Open the project and continue this conversation"
                    >
                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px]">
                          {session.title ?? session.firstPrompt ?? "Untitled conversation"}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {session.messageCount}
                          {session.truncated ? "+" : ""} messages · {ago(session.updatedAt)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
