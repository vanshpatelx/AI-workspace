import { PROTOCOL_VERSION, type WorkspaceSummary } from "@ai-workspace/protocol";

/**
 * Desktop app (control center) — skeleton.
 *
 * The real app is an Electron shell with a renderer UI: dashboard, persistent
 * chat, localhost/media preview, terminal, file explorer, and approval center.
 * This stub only proves the workspace + protocol wiring compiles.
 */

export function renderDashboard(items: WorkspaceSummary[]): string {
  if (items.length === 0) return "No workstations connected.";
  return items
    .map((w) => `${w.hostname} [${w.status}] ${w.agent ?? "idle"} — ${w.activeTask ?? "—"}`)
    .join("\n");
}

console.log(`ai-workspace desktop (protocol v${PROTOCOL_VERSION})`);
