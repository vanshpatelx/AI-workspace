/**
 * Desktop library surface.
 *
 * The app itself is the React renderer in App.tsx; this module exposes small
 * helpers shared with the headless client in connect.ts.
 */
import { PROTOCOL_VERSION, type Workspace } from "@ai-workspace/protocol";

export function renderWorkspaces(items: Workspace[]): string {
  if (items.length === 0) return "No workspaces open.";
  return items
    .map((w) => `${w.name} (${w.path})${w.branch ? ` [${w.branch}]` : ""} — ${w.activeTask ?? "idle"}`)
    .join("\n");
}

export const DESKTOP_BANNER = `ai-workspace desktop (protocol v${PROTOCOL_VERSION})`;
