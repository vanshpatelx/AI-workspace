import { ShieldAlert, Check, X, Trash2, GitBranch, Container, Package, Zap } from "lucide-react";
import type { ApprovalKind, ApprovalRequest } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

const KIND_ICON: Record<ApprovalKind, typeof Trash2> = {
  "file-delete": Trash2,
  "git-push": GitBranch,
  "docker-command": Container,
  "package-install": Package,
  other: Zap,
};

/**
 * A pending action waiting on the user.
 *
 * Rendered in two places on purpose: inline in the transcript, where the agent
 * actually stopped and the surrounding context explains *why* it wants this,
 * and in the sidebar, which catches requests raised while you are looking at
 * another workspace. Same component, two densities.
 */
export function ApprovalCard({
  request,
  host,
  variant = "inline",
  onResolve,
}: {
  request: ApprovalRequest;
  host?: string;
  variant?: "inline" | "compact";
  onResolve: (approved: boolean) => void;
}) {
  const Icon = KIND_ICON[request.kind] ?? Zap;

  return (
    <div
      className={`rounded-lg border border-amber-500/50 bg-amber-500/[0.06] ${
        variant === "inline" ? "my-2 p-3" : "p-2.5"
      }`}
      data-testid="approval-card"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          {/* A pulse, because this is blocking real work until answered. */}
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className={`font-medium ${variant === "inline" ? "text-sm" : "text-xs"}`}>
          {request.summary}
        </span>
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
          {request.kind}
        </Badge>
      </div>

      <pre className="mt-2 overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        {request.details}
      </pre>

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" className="h-7" onClick={() => onResolve(true)}>
          <Check className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button size="sm" variant="destructive" className="h-7" onClick={() => onResolve(false)}>
          <X className="h-3.5 w-3.5" /> Reject
        </Button>
        {host && (
          <span className="ml-auto truncate text-[10px] text-muted-foreground">{host}</span>
        )}
      </div>
    </div>
  );
}

/** Sidebar panel — only shows what is *not* already visible in the transcript. */
export function ApprovalCenter({
  items,
  onResolve,
}: {
  items: { approval: ApprovalRequest; url: string; host: string }[];
  onResolve: (url: string, id: string, approved: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-card">
      <div className="flex items-center gap-2 border-b border-amber-500/20 px-3 py-2">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium">Waiting on you</span>
        <Badge variant="busy" className="ml-auto">
          {items.length}
        </Badge>
      </div>
      <div className="space-y-2 p-2">
        {items.map(({ approval, url, host }) => (
          <ApprovalCard
            key={`${url}:${approval.id}`}
            request={approval}
            host={host}
            variant="compact"
            onResolve={(approved) => onResolve(url, approval.id, approved)}
          />
        ))}
      </div>
    </div>
  );
}
