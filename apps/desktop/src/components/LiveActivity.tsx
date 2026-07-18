import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Shown at the foot of the transcript while a turn is still running.
 *
 * A long agent turn can go quiet for a minute or more between tool calls, and
 * silence is indistinguishable from a hang. This says what the agent is doing
 * and how long it has been at it, so waiting feels different from broken.
 */
export function LiveActivity({ what }: { what: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [what]);

  const time = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;

  return (
    <div
      className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
      data-testid="live-activity"
    >
      <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
      <span>{what}</span>
      <Dots />
      <span className="ml-auto tabular-nums opacity-60">{time}</span>
    </div>
  );
}

/** Three dots that fade in sequence — cheap, and reads as "still alive". */
function Dots() {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${i * 200}ms`, animationDuration: "1.2s" }}
        />
      ))}
    </span>
  );
}
