import { useState } from "react";
import { ChevronRight, Wrench, Loader2 } from "lucide-react";
import type { ChatMessage } from "../lib/useWorkers.js";
import { TOOL_STYLES } from "./ToolCall.js";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "./ai-elements/chain-of-thought.js";

/** Present-tense verb per tool, so a step reads like a sentence, not a name. */
const VERB: Record<string, string> = {
  Read: "Read",
  Edit: "Edited",
  Write: "Wrote",
  NotebookEdit: "Edited",
  Bash: "Ran",
  Grep: "Searched",
  Glob: "Searched",
  WebFetch: "Fetched",
  WebSearch: "Searched the web for",
  TodoWrite: "Updated the plan",
  Task: "Delegated to an agent",
};

/** The tail of a path or command, which is the part worth reading at a glance. */
function shortTarget(tool: string, target?: string): string | undefined {
  if (!target) return undefined;
  if (tool === "Bash") return target; // a command reads whole, not by basename
  if (tool === "Read" || tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    return target.split("/").pop();
  }
  return target.length > 60 ? `${target.slice(0, 57)}…` : target;
}

/** What the agent returned for a call, revealed on click. Nothing to open when empty. */
function StepOutput({ output, isError }: { output?: string; isError?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!output) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? "hide output" : "output"}
      </button>
      {open && (
        <pre
          className={`mt-1 max-h-64 overflow-auto rounded-md border bg-[#0d0d0f] px-3 py-2 font-mono text-[11px] leading-relaxed ${
            isError ? "border-destructive/50 text-destructive" : "border-border/60 text-muted-foreground"
          }`}
        >
          {output}
        </pre>
      )}
    </div>
  );
}

/**
 * A run of tool calls rendered as a threaded timeline instead of a numbered box.
 *
 * The old grouping said only "Step 3 · 1 call", which hid the one thing worth
 * seeing — the sequence of what the agent actually did. This shows each action
 * as a step on a connected line: an icon, a plain-language label, and its output
 * one click away. While the turn is live the final step reads as active, so the
 * timeline visibly advances rather than sitting as an opaque count.
 */
export function StepTimeline({ tools, live }: { tools: ChatMessage[]; live: boolean }) {
  // Open while working, or when short enough that a summary would hide little.
  const [open, setOpen] = useState(live || tools.length <= 3);

  const label = live
    ? `Working · ${tools.length} ${tools.length === 1 ? "step" : "steps"}`
    : `Worked through ${tools.length} ${tools.length === 1 ? "step" : "steps"}`;

  return (
    <ChainOfThought className="my-1.5 space-y-2" open={open} onOpenChange={setOpen}>
      <ChainOfThoughtHeader className="text-xs">{label}</ChainOfThoughtHeader>
      <ChainOfThoughtContent className="ml-1">
        {tools.map((tool, i) => {
          const name = tool.tool ?? "Tool";
          const { Icon } = TOOL_STYLES[name] ?? { Icon: Wrench };
          const isLast = i === tools.length - 1;
          // The last call of a live run is the one currently in flight.
          const status = live && isLast ? "active" : "complete";
          const verb = VERB[name] ?? name;
          const detail = shortTarget(name, tool.target);

          return (
            <ChainOfThoughtStep
              key={tool.toolId ?? i}
              icon={live && isLast ? Loader2 : Icon}
              status={status}
              label={
                <span className={`flex items-center gap-1.5 text-xs ${live && isLast ? "[&_svg]:animate-spin" : ""}`}>
                  <span className={tool.isError ? "text-destructive" : "font-medium"}>{verb}</span>
                  {detail && (
                    <code className="truncate font-mono text-[11px] text-muted-foreground" title={tool.target}>
                      {detail}
                    </code>
                  )}
                </span>
              }
            >
              <StepOutput output={tool.output} isError={tool.isError} />
            </ChainOfThoughtStep>
          );
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
