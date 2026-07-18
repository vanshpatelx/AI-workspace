import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AgentKind, TurnUsage } from "@ai-workspace/protocol";
import type { AgentAdapter, AgentTurnInput, AgentTurnResult } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, "..", "permission-hook.mjs");

/** The agent reports an unresolvable --resume target with this message. */
function isMissingSession(text: string): boolean {
  return /No conversation found with session ID/i.test(text);
}

/** Tool output arrives as a string or as content blocks; flatten to text. */
function stringifyToolOutput(content: unknown): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((c) =>
              c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
                ? (c as { text: string }).text
                : "",
            )
            .join("")
        : "";
  // Cap it: a tool can return a whole file, and this is a preview.
  const MAX = 8000;
  return text.length > MAX ? `${text.slice(0, MAX)}\n… (${text.length - MAX} more characters)` : text;
}

/**
 * Token, cost and timing accounting from the agent's final result event.
 *
 * `contextTokens` is what actually occupies the window — fresh input plus
 * everything read from or written to the cache — which is the number worth
 * showing against the model's limit.
 */
function readUsage(evt: any, mainModel: string | null): TurnUsage {
  const u = evt?.usage ?? {};
  const inputTokens = Number(u.input_tokens ?? 0);
  const outputTokens = Number(u.output_tokens ?? 0);
  const cacheReadTokens = Number(u.cache_read_input_tokens ?? 0);
  const cacheCreationTokens = Number(u.cache_creation_input_tokens ?? 0);

  // A turn can touch several models — the agent runs small helper models for
  // background work, and those can out-token the one doing the actual job.
  // The session's declared model is the one the user cares about, so prefer
  // it and only fall back to the largest context window on offer.
  const models = Object.entries(evt?.modelUsage ?? {}) as [string, any][];
  const chosen =
    models.find(([name]) => name === mainModel) ??
    models.sort((a, b) => (b[1]?.contextWindow ?? 0) - (a[1]?.contextWindow ?? 0))[0];

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    contextTokens: inputTokens + cacheReadTokens + cacheCreationTokens,
    contextWindow: chosen?.[1]?.contextWindow ?? null,
    costUsd: Number(evt?.total_cost_usd ?? 0),
    durationMs: Number(evt?.duration_ms ?? 0),
    model: mainModel ?? chosen?.[0] ?? null,
  };
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
      // The agent announces its model in the init event; helper models that
      // appear later in modelUsage are background work, not the main turn.
      let mainModel: string | null = null;
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
          if (line) {
            this.handleEvent(line, handlers, (id) => (sessionId = id), markResumeFailure, {
              get: () => mainModel,
              set: (m) => (mainModel = m),
            });
          }
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
          this.handleEvent(buffer.trim(), handlers, (id) => (sessionId = id), markResumeFailure, {
            get: () => mainModel,
            set: (m) => (mainModel = m),
          });
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
    model: { get: () => string | null; set: (m: string) => void },
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
    if (evt?.type === "system" && typeof evt.model === "string") model.set(evt.model);

    switch (evt?.type) {
      case "assistant": {
        for (const block of evt.message?.content ?? []) {
          if (block?.type === "text" && typeof block.text === "string") {
            handlers.onDelta(block.text);
          } else if (block?.type === "tool_use" && typeof block.name === "string") {
            handlers.onTool?.(String(block.id ?? ""), block.name, describeToolTarget(block.input));
          }
        }
        break;
      }
      case "user": {
        // Tool results arrive as a synthetic user turn referencing the call.
        for (const block of evt.message?.content ?? []) {
          if (block?.type === "tool_result") {
            handlers.onToolResult?.(
              String(block.tool_use_id ?? ""),
              stringifyToolOutput(block.content),
              Boolean(block.is_error),
            );
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
        handlers.onUsage?.(readUsage(evt, model.get()));
        break;
      }
      default:
        break;
    }
  }
}
