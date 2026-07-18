import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AgentKind } from "@ai-workspace/protocol";
import type { AgentAdapter, AgentTurnInput, AgentTurnResult } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, "..", "permission-hook.mjs");

/**
 * Inline settings that route every Bash tool call through our PreToolUse hook,
 * so the agent's own dangerous actions land in the Approval Center.
 */
function hookSettings(): string {
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `node ${JSON.stringify(HOOK_PATH)}` }],
        },
      ],
    },
  });
}

/**
 * Drives the Claude Code CLI in headless print mode with streaming JSON:
 *
 *   claude -p "<text>" --output-format stream-json --verbose [--resume <id>]
 *
 * Each stdout line is one JSON event. We forward assistant text as deltas,
 * surface tool use as notices, and capture the session_id so the next turn
 * resumes the same conversation.
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind: AgentKind = "claude-code";

  constructor(private binary = "claude") {}

  runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const { text, cwd, resumeSessionId, handlers } = input;

    const args = [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--settings",
      hookSettings(),
    ];
    if (resumeSessionId) args.push("--resume", resumeSessionId);

    return new Promise((resolve) => {
      let sessionId: string | null = resumeSessionId;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ nativeSessionId: sessionId });
      };

      let child;
      try {
        child = spawn(this.binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        handlers.onError(`failed to spawn ${this.binary}: ${(err as Error).message}`);
        finish();
        return;
      }

      let buffer = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) this.handleEvent(line, handlers, (id) => (sessionId = id));
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        handlers.onError(`${this.binary}: ${err.message}`);
        finish();
      });

      child.on("close", (code) => {
        if (buffer.trim()) this.handleEvent(buffer.trim(), handlers, (id) => (sessionId = id));
        if (code !== 0 && !settled) {
          handlers.onError(stderr.trim() || `${this.binary} exited with code ${code}`);
        }
        finish();
      });
    });
  }

  private handleEvent(
    line: string,
    handlers: AgentTurnInput["handlers"],
    setSession: (id: string) => void,
  ): void {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      return; // ignore non-JSON noise
    }
    if (typeof evt?.session_id === "string") setSession(evt.session_id);

    switch (evt?.type) {
      case "assistant": {
        for (const block of evt.message?.content ?? []) {
          if (block?.type === "text" && typeof block.text === "string") {
            handlers.onDelta(block.text);
          } else if (block?.type === "tool_use" && typeof block.name === "string") {
            handlers.onNotice?.(`↳ ${block.name}`);
          }
        }
        break;
      }
      case "result": {
        if (evt.is_error && typeof evt.result === "string") {
          handlers.onError(evt.result);
        }
        break;
      }
      default:
        break;
    }
  }
}
