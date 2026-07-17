import type { AgentKind } from "@ai-workspace/protocol";
import {
  configExists,
  configPath,
  generatePairingCode,
  generateWorkerId,
  loadConfig,
  saveConfig,
  type KeepAwakePolicy,
  type TransportKind,
  type WorkerConfig,
} from "./config.js";
import { detectAgents } from "./agents.js";
import { Prompt } from "./prompt.js";

export interface InitOptions {
  /** Skip all prompts and accept defaults (for unattended installs). */
  yes?: boolean;
  port?: number;
  transport?: TransportKind;
  keepAwake?: KeepAwakePolicy;
}

/** Unattended setup: defaults + all detected agents, no prompts. */
async function runInitNonInteractive(opts: InitOptions): Promise<void> {
  const existing = loadConfig();
  const detected = await detectAgents();
  const config: WorkerConfig = {
    workerId: existing?.workerId ?? generateWorkerId(),
    port: opts.port ?? existing?.port ?? 4501,
    transport: opts.transport ?? existing?.transport ?? "tailscale",
    keepAwake: opts.keepAwake ?? existing?.keepAwake ?? "while-active",
    agents: detected.map((a) => a.kind),
    pairingCode: existing?.pairingCode ?? generatePairingCode(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  saveConfig(config);
  console.log(`Saved ${configPath()}`);
  console.log(`  id=${config.workerId} transport=${config.transport} keepAwake=${config.keepAwake}`);
  console.log(`  agents=[${config.agents.join(", ") || "none"}]`);
  console.log(`  pairing code: ${config.pairingCode}`);
}

/**
 * Interactive `aiw worker init` — the onboarding wizard run once per machine.
 * Writes ~/.ai-workspace/worker.json. This is where transport, keep-awake, and
 * agent selection are decided, and where a pairing code is minted.
 */
export async function runInit(opts: InitOptions = {}): Promise<void> {
  if (opts.yes) {
    await runInitNonInteractive(opts);
    return;
  }
  const prompt = new Prompt();
  try {
    console.log("\n  AI Workspace — Worker setup\n");

    if (configExists()) {
      const overwrite = await prompt.confirm(
        `A config already exists at ${configPath()}. Reconfigure?`,
        false,
      );
      if (!overwrite) {
        console.log("Keeping existing config. Run `aiw worker start` to launch.");
        return;
      }
    }

    const existing = loadConfig();

    const port = Number(await prompt.text("Port for the local transport server", "4501"));

    const transport = await prompt.select<TransportKind>(
      "How will the Desktop app reach this Worker?",
      [
        { label: "Tailscale (recommended)", value: "tailscale" },
        { label: "WireGuard", value: "wireguard" },
        { label: "Local network", value: "local" },
        { label: "SSH tunnel", value: "ssh" },
      ],
      0,
    );

    const keepAwake = await prompt.select<KeepAwakePolicy>(
      "Keep this machine awake while agents run?",
      [
        { label: "While active — only during running tasks (recommended)", value: "while-active" },
        { label: "Always — never sleep while the Worker runs", value: "always" },
        { label: "Off — let the machine sleep normally", value: "off" },
      ],
      0,
    );

    console.log("\nDetecting installed agents…");
    const detected = await detectAgents();
    if (detected.length === 0) {
      console.log("  No supported agents found on PATH (you can install them later).");
    } else {
      detected.forEach((a) => console.log(`  ✓ ${a.label}  (${a.path})`));
    }

    const agents: AgentKind[] =
      detected.length === 0
        ? []
        : await prompt.multiSelect<AgentKind>(
            "\nWhich agents should this Worker expose?",
            detected.map((a) => ({ label: a.label, value: a.kind, preselected: true })),
          );

    const pairingCode = existing?.pairingCode ?? generatePairingCode();

    const config: WorkerConfig = {
      workerId: existing?.workerId ?? generateWorkerId(),
      port: Number.isFinite(port) && port > 0 ? port : 4501,
      transport,
      keepAwake,
      agents,
      pairingCode,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    saveConfig(config);

    console.log(`\n  Saved ${configPath()}`);
    console.log(`  Worker ID:    ${config.workerId}`);
    console.log(`  Transport:    ${config.transport}`);
    console.log(`  Keep awake:   ${config.keepAwake}`);
    console.log(`  Agents:       ${config.agents.join(", ") || "none"}`);
    console.log(`\n  Pairing code for the Desktop app:  ${config.pairingCode}\n`);
    console.log("  Next:  aiw worker start\n");
  } finally {
    prompt.close();
  }
}
