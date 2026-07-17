import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { AgentKind } from "@ai-workspace/protocol";

export type TransportKind = "tailscale" | "wireguard" | "local" | "ssh";
export type KeepAwakePolicy = "while-active" | "always" | "off";

export interface WorkerConfig {
  workerId: string;
  port: number;
  transport: TransportKind;
  keepAwake: KeepAwakePolicy;
  agents: AgentKind[];
  pairingCode: string;
  createdAt: string;
}

const CONFIG_DIR = join(homedir(), ".ai-workspace");
const CONFIG_PATH = join(CONFIG_DIR, "worker.json");

export function configPath(): string {
  return CONFIG_PATH;
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): WorkerConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as WorkerConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: WorkerConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Short human-friendly pairing code, e.g. "AIW-4F9K-2Q7X". */
export function generatePairingCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `AIW-${block()}-${block()}`;
}

export function generateWorkerId(): string {
  return "w_" + Math.random().toString(36).slice(2, 10);
}
