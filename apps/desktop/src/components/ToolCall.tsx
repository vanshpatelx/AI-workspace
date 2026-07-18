import {
  FileText,
  FilePen,
  FilePlus,
  TerminalSquare,
  Search,
  Globe,
  ListTodo,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icon and accent per tool, so actions are scannable at a glance. */
const TOOL_STYLES: Record<string, { Icon: LucideIcon; accent: string }> = {
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
 * A single agent action, rendered as a compact row rather than a line of text
 * in the reply — the same idea as the tool rows in the VS Code extension.
 */
export function ToolCall({ tool, target }: { tool: string; target?: string }) {
  const { Icon, accent } = TOOL_STYLES[tool] ?? { Icon: Wrench, accent: "text-muted-foreground" };
  return (
    <div className="my-1.5 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <span className="shrink-0 text-xs font-medium">{tool}</span>
      {target && (
        <code className="truncate font-mono text-[11px] text-muted-foreground" title={target}>
          {target}
        </code>
      )}
    </div>
  );
}
