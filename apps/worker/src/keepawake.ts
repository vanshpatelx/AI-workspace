import { spawn, type ChildProcess } from "node:child_process";
import type { KeepAwakePolicy } from "./config.js";

/**
 * Keeps the machine awake while agents are working, using the OS's native
 * power-assertion mechanism — no install required.
 *
 * macOS  -> `caffeinate -i` (prevent idle system sleep)
 * Linux  -> `systemd-inhibit --what=idle sleep infinity` (best effort)
 * other  -> no-op (logs a warning)
 *
 * Policy:
 *   while-active — assertion held only while >=1 task is running (default)
 *   always       — assertion held for the Worker's whole lifetime
 *   off          — never held; the machine sleeps normally
 */
export class KeepAwake {
  private proc: ChildProcess | null = null;
  private activeTasks = 0;

  constructor(private policy: KeepAwakePolicy) {}

  /** Call once when the Worker starts. */
  start(): void {
    if (this.policy === "always") this.assert();
  }

  /** Call when a task begins. */
  taskStarted(): void {
    this.activeTasks++;
    if (this.policy === "while-active") this.assert();
  }

  /** Call when a task ends. */
  taskEnded(): void {
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    if (this.policy === "while-active" && this.activeTasks === 0) this.release();
  }

  get held(): boolean {
    return this.proc !== null;
  }

  /** Release the assertion and let the machine sleep again. */
  stop(): void {
    this.release();
  }

  private assert(): void {
    if (this.proc) return; // already held
    const [cmd, args] = commandForPlatform();
    if (!cmd) {
      console.warn(`[keepawake] no power-assertion tool for platform ${process.platform}; skipping`);
      return;
    }
    this.proc = spawn(cmd, args, { stdio: "ignore" });
    this.proc.on("exit", () => {
      this.proc = null;
    });
    console.log(`[keepawake] holding (${this.policy}) via ${cmd}`);
  }

  private release(): void {
    if (!this.proc) return;
    this.proc.kill("SIGTERM");
    this.proc = null;
    console.log("[keepawake] released");
  }
}

function commandForPlatform(): [string | null, string[]] {
  switch (process.platform) {
    case "darwin":
      return ["caffeinate", ["-i"]];
    case "linux":
      return ["systemd-inhibit", ["--what=idle", "--why=ai-workspace", "sleep", "infinity"]];
    default:
      return [null, []];
  }
}
