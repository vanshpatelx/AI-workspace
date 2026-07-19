import { useState } from "react";
import { Clock, X, Play, CalendarClock } from "lucide-react";
import type { ScheduledPrompt } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";

/** Offsets that cover the common cases without opening a calendar. */
const QUICK = [
  { label: "in 30m", ms: 30 * 60 * 1000 },
  { label: "in 1h", ms: 60 * 60 * 1000 },
  { label: "in 3h", ms: 3 * 60 * 60 * 1000 },
  { label: "in 6h", ms: 6 * 60 * 60 * 1000 },
];

/** Next occurrence of a wall-clock time, rolling to tomorrow if it has passed. */
function nextAt(hour: number, minute = 0): number {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

function when(ms: number): string {
  const date = new Date(ms);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/**
 * Queue the current prompt to run later.
 *
 * Built for the case of lining work up before stepping away: pick an offset or
 * a clock time, and the turn runs on its own. Quick offsets come first because
 * "in 3h" is usually what someone means, not a specific minute.
 */
export function SchedulePicker({
  disabled,
  hasText,
  onSchedule,
}: {
  disabled: boolean;
  hasText: boolean;
  onSchedule: (runAt: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("09:00");

  const pick = (runAt: number) => {
    onSchedule(runAt);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        size="icon"
        variant="ghost"
        disabled={disabled || !hasText}
        onClick={() => setOpen((o) => !o)}
        title={hasText ? "Run this later" : "Type a prompt to schedule it"}
        aria-label="Schedule this prompt"
      >
        <Clock className="h-4 w-4" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-20 mb-2 w-60 rounded-lg border bg-card p-2 shadow-lg">
            <div className="flex items-center gap-1.5 px-1 pb-2 text-xs font-medium">
              <CalendarClock className="h-3.5 w-3.5 text-sky-400" />
              Run this later
            </div>

            <div className="grid grid-cols-2 gap-1">
              {QUICK.map((q) => (
                <Button
                  key={q.label}
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[11px]"
                  onClick={() => pick(Date.now() + q.ms)}
                >
                  {q.label}
                </Button>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
              <Input
                type="time"
                value={clock}
                onChange={(e) => setClock(e.target.value)}
                className="h-7 flex-1 text-[11px]"
              />
              <Button
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  const [h, m] = clock.split(":").map(Number);
                  pick(nextAt(h ?? 9, m ?? 0));
                }}
              >
                Set
              </Button>
            </div>
            <p className="px-1 pt-1.5 text-[10px] text-muted-foreground">
              A time that has passed today runs tomorrow.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Prompts waiting to run, with the option to run early or drop them. */
export function ScheduledList({
  prompts,
  onRunNow,
  onCancel,
}: {
  prompts: ScheduledPrompt[];
  onRunNow: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card" data-testid="scheduled-list">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <CalendarClock className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-medium">Scheduled</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{prompts.length}</span>
      </div>
      <div className="space-y-1 p-1.5">
        {prompts.map((prompt) => (
          <div key={prompt.id} className="rounded-md px-1.5 py-1 hover:bg-accent/40">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 font-mono text-[10px] text-sky-300">
                {when(prompt.runAt)}
              </span>
              <span className="truncate text-[11px]">{prompt.text}</span>
              <div className="ml-auto flex shrink-0 gap-0.5">
                <button
                  className="opacity-50 hover:opacity-100"
                  title="Run now"
                  onClick={() => onRunNow(prompt.id)}
                >
                  <Play className="h-3 w-3" />
                </button>
                <button
                  className="opacity-50 hover:opacity-100"
                  title="Cancel"
                  onClick={() => onCancel(prompt.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
