import { useState } from "react";
import {
  FileText,
  FilePen,
  FilePlus,
  TerminalSquare,
  Search,
  Globe,
  ListTodo,
  Wrench,
  ChevronRight,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

/** Icon and accent per tool, so actions are scannable at a glance. */
export const TOOL_STYLES: Record<string, { Icon: LucideIcon; accent: string }> = {
  Read: { Icon: FileText, accent: "text-sky-400" },
  Edit: { Icon: FilePen, accent: "text-amber-400" },
  Write: { Icon: FilePlus, accent: "text-emerald-400" },
  NotebookEdit: { Icon: FilePen, accent: "text-amber-400" },
  Bash: { Icon: TerminalSquare, accent: "text-violet-400" },
  Grep: { Icon: Search, accent: "text-muted-foreground" },
  Glob: { Icon: Search, accent: "text-muted-foreground" },
  WebFetch: { Icon: Globe, accent: "text-sky-400" },
  WebSearch: { Icon: Globe, accent: "text-sky-400" },
  TodoWrite: { Icon: ListTodo, accent: "text-muted-foreground" },
};

/**
 * A single agent action, rendered as a compact row that expands to reveal what
 * the tool returned — the same shape as the tool rows in an editor extension.
 * Collapsed by default: a Read can return a whole file.
 */
export function ToolCall({
  tool,
  target,
  output,
  isError,
}: {
  tool: string;
  target?: string;
  output?: string;
  isError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { Icon, accent } = TOOL_STYLES[tool] ?? { Icon: Wrench, accent: "text-muted-foreground" };
  const expandable = Boolean(output);

  return (
    <div
      className={`my-1.5 overflow-hidden rounded-md border bg-muted/30 ${
        isError ? "border-destructive/50" : "border-border/60"
      }`}
    >
      <button
        onClick={() => expandable && setOpen((o) => !o)}
        disabled={!expandable}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${
          expandable ? "hover:bg-muted/50" : "cursor-default"
        }`}
      >
        {expandable ? (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className={`h-3.5 w-3.5 shrink-0 ${isError ? "text-destructive" : accent}`} />
        <span className="shrink-0 text-xs font-medium">{tool}</span>
        {target && (
          <code className="truncate font-mono text-[11px] text-muted-foreground" title={target}>
            {target}
          </code>
        )}
        {isError && <AlertTriangle className="ml-auto h-3 w-3 shrink-0 text-destructive" />}
        {expandable && !isError && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {open ? "hide" : "output"}
          </span>
        )}
      </button>

      {open && output && (
        <pre className="max-h-72 overflow-auto border-t bg-[#0d0d0f] px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  );
}
