#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook.
 *
 * Claude invokes this before running a tool. We forward the request to the
 * Worker's loopback approval endpoint, which decides:
 *   - safe command      -> allowed immediately
 *   - sensitive command -> surfaces in the Approval Center and blocks here
 *                          until the user approves or rejects in the Desktop UI
 *
 * Classification lives in the Worker so there is a single source of truth.
 * Fails open to "ask" if the Worker is unreachable, so a dead Worker can never
 * silently auto-approve a destructive action.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};
  const toolName = input.tool_name ?? "";
  const command = input.tool_input?.command ?? "";

  // Matches the Worker's CONFIG_DIR resolution (env is inherited from it).
  const configDir = process.env.AIW_HOME ?? join(homedir(), ".ai-workspace");
  const configPath = join(configDir, "worker.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const url = `http://127.0.0.1:${config.port + 1}/approval`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolName, command }),
  });
  const { approved, reason } = await res.json();

  emit(approved ? "allow" : "deny", reason ?? "Decided in AI Workspace");
} catch (err) {
  // Worker unreachable — defer to Claude's normal permission flow.
  emit("ask", `AI Workspace approval unavailable: ${err.message}`);
}
