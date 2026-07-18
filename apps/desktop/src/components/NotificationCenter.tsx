import { useEffect, useState } from "react";
import { Bell, CheckCircle2, XCircle, ShieldAlert, Info, AlertTriangle } from "lucide-react";
import type { WorkerNotification } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

export interface FeedItem {
  notification: WorkerNotification;
  host: string;
}

/**
 * Bell + dropdown feed of everything the Workers have reported.
 *
 * Unread is tracked against the newest notification id seen when the panel was
 * last opened, so the badge reflects genuinely new events rather than resetting
 * on every render.
 */
export function NotificationCenter({ items }: { items: FeedItem[] }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSeen(new Set(items.map((i) => i.notification.id + i.host)));
  }, [open, items]);

  const unread = items.filter((i) => !seen.has(i.notification.id + i.host)).length;

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        data-testid="bell"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <Badge
            variant="busy"
            className="ml-1 px-1.5 py-0 text-[10px]"
            data-testid="unread-count"
          >
            {unread}
          </Badge>
        )}
      </Button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-2 max-h-[420px] w-[380px] overflow-y-auto rounded-lg border bg-card shadow-lg"
            data-testid="notification-panel"
          >
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              Notifications
            </div>
            {items.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              items.map(({ notification: n, host }) => (
                <div key={`${host}:${n.id}`} className="flex gap-2 border-b px-3 py-2 last:border-0">
                  <KindIcon kind={n.kind} level={n.level} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{n.title}</div>
                    {n.body && (
                      <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                        {n.body}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{host}</span>
                      <span>·</span>
                      <span>{new Date(n.at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KindIcon({ kind, level }: { kind: WorkerNotification["kind"]; level: string }) {
  const cls = "h-3.5 w-3.5 shrink-0 mt-0.5";
  if (kind === "approval-waiting") return <ShieldAlert className={`${cls} text-amber-400`} />;
  if (kind === "command-failed" || level === "error")
    return <XCircle className={`${cls} text-destructive`} />;
  if (kind === "task-complete" || kind === "command-complete")
    return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  if (level === "warn") return <AlertTriangle className={`${cls} text-amber-400`} />;
  return <Info className={`${cls} text-muted-foreground`} />;
}
