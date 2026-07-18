import { Coins, Clock, Cpu, Gauge } from "lucide-react";
import type { TurnUsage } from "@ai-workspace/protocol";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function shortModel(model: string | null): string {
  if (!model) return "agent";
  // "claude-opus-4-8[1m]" -> "opus-4-8"
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
}

/**
 * Per-turn accounting: what the model was, how much of its context window the
 * turn occupied, what it cost and how long it took.
 *
 * Context is the number that actually changes behaviour — once it fills, the
 * agent starts losing earlier detail — so it gets a meter rather than a digit.
 */
export function UsageBar({ usage }: { usage: TurnUsage }) {
  const pct =
    usage.contextWindow && usage.contextWindow > 0
      ? Math.min(100, (usage.contextTokens / usage.contextWindow) * 100)
      : null;

  // Green under half, amber past two thirds, red when nearly full.
  const tone =
    pct === null ? "bg-muted-foreground" : pct > 85 ? "bg-red-400" : pct > 65 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1" title="Model used for this turn">
        <Cpu className="h-3 w-3" />
        {shortModel(usage.model)}
      </span>

      {pct !== null && (
        <span
          className="flex items-center gap-1.5"
          title={`Context: ${usage.contextTokens.toLocaleString()} of ${usage.contextWindow?.toLocaleString()} tokens`}
        >
          <Gauge className="h-3 w-3" />
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span className={`block h-full ${tone}`} style={{ width: `${Math.max(pct, 2)}%` }} />
          </span>
          {pct < 1 ? "<1" : Math.round(pct)}% context
        </span>
      )}

      <span title="Tokens in / out (cache reads shown separately)">
        {compact(usage.inputTokens + usage.cacheCreationTokens)} in · {compact(usage.outputTokens)} out
        {usage.cacheReadTokens > 0 && ` · ${compact(usage.cacheReadTokens)} cached`}
      </span>

      {usage.costUsd > 0 && (
        <span className="flex items-center gap-1" title="Cost of this turn">
          <Coins className="h-3 w-3" />${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}
        </span>
      )}

      {usage.durationMs > 0 && (
        <span className="flex items-center gap-1" title="Wall-clock time">
          <Clock className="h-3 w-3" />
          {usage.durationMs < 1000
            ? `${usage.durationMs}ms`
            : `${(usage.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </div>
  );
}
