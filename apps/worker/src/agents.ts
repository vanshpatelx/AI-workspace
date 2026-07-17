import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentKind } from "@ai-workspace/protocol";

const run = promisify(execFile);

interface AgentProbe {
  kind: AgentKind;
  label: string;
  command: string;
}

/** How each supported agent is detected on PATH. */
const PROBES: AgentProbe[] = [
  { kind: "claude-code", label: "Claude Code", command: "claude" },
  { kind: "codex-cli", label: "Codex CLI", command: "codex" },
  { kind: "gemini-cli", label: "Gemini CLI", command: "gemini" },
  { kind: "openhands", label: "OpenHands", command: "openhands" },
  { kind: "roo-code", label: "Roo Code", command: "roo" },
];

export interface DetectedAgent {
  kind: AgentKind;
  label: string;
  command: string;
  path: string;
}

async function onPath(command: string): Promise<string | null> {
  // `command` values come from the fixed PROBES table, never user input.
  try {
    const { stdout } = await run("/bin/sh", ["-c", `command -v ${command}`]);
    const path = stdout.trim();
    return path || null;
  } catch {
    return null;
  }
}

/** Detect which supported AI agents are installed on this machine. */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const results = await Promise.all(
    PROBES.map(async (p) => {
      const path = await onPath(p.command);
      return path ? { kind: p.kind, label: p.label, command: p.command, path } : null;
    }),
  );
  return results.filter((r): r is DetectedAgent => r !== null);
}

export function agentLabel(kind: AgentKind): string {
  return PROBES.find((p) => p.kind === kind)?.label ?? kind;
}
