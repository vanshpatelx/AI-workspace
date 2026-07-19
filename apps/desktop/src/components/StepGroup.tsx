import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatMessage } from "../lib/useWorkers.js";
import { ToolCall } from "./ToolCall.js";

/** A short, human label for a burst of tool calls. */
function summarise(tools: ChatMessage[]): string {
  const names = tools.map((t) => t.tool ?? "");
  const unique = [...new Set(names)];
  const emoji: Record<string, string> = {
    Read: "📖",
    Edit: "✏️",
    Write: "📝",
    Bash: "⚡",
    Grep: "🔍",
    Glob: "🔍",
    WebFetch: "🌐",
    WebSearch: "🌐",
    TodoWrite: "🧠",
    Task: "🤖",
  };

  // One kind of work reads better as a phrase than as a list.
  if (unique.length === 1) {
    const only = unique[0] ?? "";
    const icon = emoji[only] ?? "🔧";
    const verb: Record<string, string> = {
      Read: "Reading",
      Edit: "Editing",
      Write: "Writing",
      Bash: "Running",
      Grep: "Searching",
      Glob: "Searching",
      WebFetch: "Fetching",
      WebSearch: "Searching the web",
      TodoWrite: "Planning",
    };
    const what = verb[only] ?? only;
    return tools.length === 1 ? `${icon} ${what}` : `${icon} ${what} · ${tools.length} files`;
  }

  const icons = unique.map((n) => emoji[n] ?? "🔧").join("");
  return `${icons} ${tools.length} actions`;
}

/**
 * A run of consecutive tool calls, collapsed into one numbered step.
 *
 * A turn that touches twenty files otherwise scrolls the actual answer off
 * screen. Grouping keeps the shape of the work visible while leaving every
 * individual call one click away.
 */
export function StepGroup({ index, tools }: { index: number; tools: ChatMessage[] }) {
  // Short bursts are clearer left open; long ones would bury the reply.
  const [open, setOpen] = useState(tools.length <= 2);

  return (
    <div className="my-1.5 rounded-md border border-border/60 bg-muted/20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Step {index}
        </span>
        <span className="truncate text-xs">{summarise(tools)}</span>
        {!open && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {tools.length} {tools.length === 1 ? "call" : "calls"}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-0 px-2 pb-1.5">
          {tools.map((tool, i) => (
            <ToolCall
              key={i}
              tool={tool.tool ?? "Tool"}
              target={tool.target}
              output={tool.output}
              isError={tool.isError}
            />
          ))}
        </div>
      )}
    </div>
  );
}
