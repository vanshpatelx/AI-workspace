import { useState } from "react";
import { ListChecks, Circle, CircleDot, CircleCheck, ChevronDown } from "lucide-react";
import type { TodoItem } from "@ai-workspace/protocol";

/**
 * The agent's own plan, live.
 *
 * Claude keeps a running checklist and rewrites it as it works. Showing it
 * answers the question you'd otherwise keep asking mid-run — what's left? —
 * without interrupting the agent to find out.
 */
export function TodoQueue({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(true);
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const running = todos.find((t) => t.status === "in_progress");
  const pct = Math.round((done / todos.length) * 100);

  return (
    <div className="rounded-lg border bg-muted/20" data-testid="todo-queue">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="text-xs font-medium">Plan</span>
        <span className="text-[11px] text-muted-foreground">
          {done}/{todos.length}
        </span>

        {/* Progress reads faster than counting rows. */}
        <span className="ml-1 h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full bg-emerald-400 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </span>

        {running && !open && (
          <span className="truncate text-[11px] text-muted-foreground">
            {running.activeForm ?? running.content}
          </span>
        )}
        <ChevronDown
          className={`ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      {open && (
        <ul className="space-y-1 px-3 pb-2.5">
          {todos.map((todo, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              {todo.status === "completed" ? (
                <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              ) : todo.status === "in_progress" ? (
                <CircleDot className="mt-0.5 h-3 w-3 shrink-0 animate-pulse text-amber-400" />
              ) : (
                <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
              )}
              <span
                className={
                  todo.status === "completed"
                    ? "text-muted-foreground line-through decoration-muted-foreground/40"
                    : todo.status === "in_progress"
                      ? "font-medium"
                      : "text-muted-foreground"
                }
              >
                {/* While running, the agent's present-tense phrasing reads better. */}
                {todo.status === "in_progress" ? (todo.activeForm ?? todo.content) : todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
