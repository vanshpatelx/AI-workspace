import { useEffect, useState } from "react";
import { Hourglass, Play, X } from "lucide-react";
import type { ParkedTask } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";

function countdown(ms: number): string {
  if (ms <= 0) return "any moment";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Work waiting on a usage limit.
 *
 * The point of parking is that hitting a limit while you are away costs
 * nothing — so this states plainly that the prompt is kept and when it will
 * run itself, rather than reporting a failure you would have to redo.
 */
export function ParkedBanner({
  tasks,
  onResumeNow,
  onCancel,
}: {
  tasks: ParkedTask[];
  onResumeNow: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  const [, tick] = useState(0);

  // Re-render once a second so the countdown actually counts down.
  useEffect(() => {
    if (tasks.length === 0) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [tasks.length]);

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="parked-banner">
      {tasks.map((task) => (
        <div key={task.id} className="rounded-lg border border-sky-500/40 bg-sky-500/[0.06] p-3">
          <div className="flex items-center gap-2">
            <Hourglass className="h-3.5 w-3.5 shrink-0 animate-pulse text-sky-400" />
            <span className="text-sm font-medium">Paused · {task.reason}</span>
            <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-sky-300">
              {countdown(task.resumeAt - Date.now())}
            </span>
          </div>

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Your prompt is saved and will run automatically when the limit
            resets — nothing to redo.
          </p>

          <pre className="mt-2 max-h-16 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
            {task.text}
          </pre>

          <div className="mt-2 flex gap-2">
            <Button size="sm" className="h-7" onClick={() => onResumeNow(task.id)}>
              <Play className="h-3 w-3" /> Try now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => onCancel(task.id)}
            >
              <X className="h-3 w-3" /> Discard
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
