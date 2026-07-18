import type { ApprovalKind, ApprovalRequest } from "@ai-workspace/protocol";

/**
 * Classifies a shell command as a sensitive action that needs user approval,
 * or `null` if it's safe to run immediately. Patterns are intentionally
 * conservative — when unsure, gate it.
 */
/**
 * Strip quoted strings before classifying.
 *
 * A dangerous word inside an argument is not a dangerous command:
 * `grep "docker push" ci.yaml` only reads a file, but matching the raw text
 * gates it as a Docker command and makes the user approve a search.
 */
function withoutQuotedText(command: string): string {
  return command
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/<<-?\s*'?(\w+)'?[\s\S]*?^\1$/gm, ""); // heredoc bodies
}

/**
 * Classifies a shell command as a sensitive action that needs user approval,
 * or `null` if it's safe to run immediately. Patterns are intentionally
 * conservative — when unsure, gate it.
 */
export function classifyCommand(command: string): { kind: ApprovalKind; summary: string } | null {
  const c = withoutQuotedText(command.trim());

  // A command position is the start, or just after a separator — this is what
  // keeps `grep docker` (an argument) apart from `docker run` (a command).
  const asCommand = (name: string) =>
    new RegExp(String.raw`(^|[;&|]|\b(?:and|then|do)\s)\s*(sudo\s+)?${name}\b`).test(c);

  if (/\bgit\s+push\b/.test(c)) return { kind: "git-push", summary: "Push commits to a remote" };
  if (/\brm\s+-[a-z]*f|\brm\s+-[a-z]*r|\brmdir\b|\bunlink\b/.test(c))
    return { kind: "file-delete", summary: "Delete files" };
  if (asCommand("docker") || asCommand("docker-compose"))
    return { kind: "docker-command", summary: "Run a Docker command" };
  if (/\b(npm|pnpm|yarn|brew|pip|pip3|cargo|gem)\s+(i|install|add)\b/.test(c))
    return { kind: "package-install", summary: "Install packages" };
  return null;
}

interface Pending {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

/**
 * Tracks in-flight approval requests. The Worker creates one when a sensitive
 * action is attempted and awaits the returned promise; the Desktop resolves it
 * via an `approval.resolve` message.
 */
export class ApprovalManager {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  create(
    workerId: string,
    kind: ApprovalKind,
    summary: string,
    details: string,
    now: number,
    workspaceId?: string,
  ): { request: ApprovalRequest; decision: Promise<boolean> } {
    const id = `a${++this.seq}`;
    const request: ApprovalRequest = { id, workerId, kind, summary, details, createdAt: now };
    if (workspaceId) request.workspaceId = workspaceId;
    const decision = new Promise<boolean>((resolve) => {
      this.pending.set(id, { request, resolve });
    });
    return { request, decision };
  }

  /** Resolve a pending request; returns false if it was unknown/expired. */
  resolve(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(approved);
    return true;
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  /** Reject everything still pending (e.g. on shutdown). */
  rejectAll(): void {
    for (const { resolve } of this.pending.values()) resolve(false);
    this.pending.clear();
  }
}
