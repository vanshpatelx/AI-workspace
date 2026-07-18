import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AgentKind } from "@ai-workspace/protocol";
import type { AgentAdapter, AgentTurnInput, AgentTurnResult } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, "..", "permission-hook.mjs");

/** The agent reports an unresolvable --resume target with this message. */
function isMissingSession(text: string): boolean {
  return /No conversation found with session ID/i.test(text);
}

/**
 * The one detail worth showing for a tool call: the file it touched, the
 * command it ran, the thing it searched for. Falls back to nothing rather
 * than dumping raw JSON at the user.
 */
function describeToolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const pick = (key: string) => (typeof i[key] === "string" ? (i[key] as string) : "");

  const target =
    pick("file_path") ||
    pick("path") ||
    pick("command") ||
    pick("pattern") ||
    pick("query") ||
    pick("url") ||
    pick("prompt") ||
    pick("description");

  // Single line, and short enough to sit on one row in the UI.
  const oneLine = target.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}…` : oneLine;
}

/**
 * Inline settings that route every Bash tool call through our PreToolUse hook,
 * so the agent's own dangerous actions land in the Approval Center.
 *
 * The approval token is passed as an argument rather than inherited from the
 * environment: the hook is spawned by the agent process, not by us, and the
 * agent does not forward arbitrary env vars to hook commands.
 */
function hookSettings(): string {
  const token = process.env.AIW_HOOK_TOKEN ?? "";
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `node ${JSON.stringify(HOOK_PATH)} ${JSON.stringify(token)}`,
            },
          ],
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

  /**
   * Agent sessions are scoped to the directory they were created in, so a
   * stored session id stops resolving if the Worker is started from a
   * different folder. Rather than failing the turn silently, fall back to a
   * fresh agent session — our own transcript is the durable record.
   */
  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (input.resumeSessionId) {
      const attempt = await this.attempt(input, input.resumeSessionId);
      if (!attempt.resumeFailed) return { nativeSessionId: attempt.nativeSessionId };
      input.handlers.onNotice?.("(previous agent session unavailable — starting a new one)");
    }
    const fresh = await this.attempt(input, null);
    return { nativeSessionId: fresh.nativeSessionId };
  }

  private attempt(
    input: AgentTurnInput,
    resumeSessionId: string | null,
  ): Promise<AgentTurnResult & { resumeFailed: boolean }> {
    const { text, cwd, handlers } = input;

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
      let resumeFailed = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        // A failed resume yields no usable session id.
        resolve({ nativeSessionId: resumeFailed ? null : sessionId, resumeFailed });
      };
      // Errors are buffered: if the resume failed we retry, and surfacing the
      // internal error to the user would just be noise.
      const reportError = (message: string) => {
        if (resumeFailed) return;
        handlers.onError(message);
      };
      const markResumeFailure = () => {
        if (resumeSessionId) resumeFailed = true;
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
          if (line) this.handleEvent(line, handlers, (id) => (sessionId = id), markResumeFailure);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        reportError(`${this.binary}: ${err.message}`);
        finish();
      });

      child.on("close", (code) => {
        if (buffer.trim()) {
          this.handleEvent(buffer.trim(), handlers, (id) => (sessionId = id), markResumeFailure);
        }
        // stderr carries the resume failure when it happens before any JSON.
        if (isMissingSession(stderr)) markResumeFailure();
        if (code !== 0 && !settled) {
          reportError(stderr.trim() || `${this.binary} exited with code ${code}`);
        }
        finish();
      });
    });
  }

  private handleEvent(
    line: string,
    handlers: AgentTurnInput["handlers"],
    setSession: (id: string) => void,
    onResumeFailure: () => void,
  ): void {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      // Non-JSON noise, but the resume error is printed as plain text.
      if (isMissingSession(line)) onResumeFailure();
      return;
    }
    if (typeof evt?.session_id === "string") setSession(evt.session_id);

    switch (evt?.type) {
      case "assistant": {
        for (const block of evt.message?.content ?? []) {
          if (block?.type === "text" && typeof block.text === "string") {
            handlers.onDelta(block.text);
          } else if (block?.type === "tool_use" && typeof block.name === "string") {
            handlers.onTool?.(block.name, describeToolTarget(block.input));
          }
        }
        break;
      }
      case "result": {
        const errors: string[] = Array.isArray(evt.errors) ? evt.errors : [];
        if (errors.some(isMissingSession)) onResumeFailure();
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
