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
  /** Optional relay to dial out to, e.g. ws://relay.example.com:8787 */
  relayUrl?: string;
}

/**
 * All Worker state lives under one directory. `AIW_HOME` overrides it, which
 * lets several Workers run on one machine with independent configs and
 * sessions.
 *
 * Resolved per call rather than at import: a module-level constant is fixed
 * before anything can set AIW_HOME, which silently sent state to the real
 * home directory instead of the intended one.
 */
export function configDir(): string {
  return process.env.AIW_HOME ?? join(homedir(), ".ai-workspace");
}

function configFile(): string {
  return join(configDir(), "worker.json");
}

export function configPath(): string {
  return configFile();
}

export function configExists(): boolean {
  return existsSync(configFile());
}

export function loadConfig(): WorkerConfig | null {
  if (!existsSync(configFile())) return null;
  try {
    return JSON.parse(readFileSync(configFile(), "utf8")) as WorkerConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: WorkerConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n", "utf8");
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
