import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ParkedTask } from "@ai-workspace/protocol";
import { configDir } from "./config.js";

/**
 * Work the agent could not finish because the usage quota ran out.
 *
 * The point is that hitting a limit while you are away should cost nothing:
 * the prompt is kept, the reset time is known, and the turn runs itself again
 * when the window reopens. Parked work is written to disk so a Worker restart
 * — or a laptop that slept through the whole window — does not lose it.
 */
export class ParkedTasks {
  private readonly tasks = new Map<string, ParkedTask>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private seq = 0;

  constructor(
    private onResume: (task: ParkedTask) => void,
    private path: string = join(configDir(), "parked.json"),
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as ParkedTask[];
      for (const task of raw) this.tasks.set(task.id, task);
    } catch {
      // Corrupt store: start empty rather than refuse to boot.
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify([...this.tasks.values()], null, 2), "utf8");
    } catch {
      // Losing the queue is bad but never worth crashing the Worker over.
    }
  }

  /** Park a prompt until `resumeAt` (epoch ms). */
  park(task: Omit<ParkedTask, "id" | "parkedAt">): ParkedTask {
    const parked: ParkedTask = {
      ...task,
      id: `p${++this.seq}_${Math.random().toString(36).slice(2, 8)}`,
      parkedAt: Date.now(),
    };
    this.tasks.set(parked.id, parked);
    this.persist();
    this.schedule(parked);
    return parked;
  }

  /**
   * Arm the timer for a task.
   *
   * setTimeout is capped at ~24.8 days and, more importantly, does not advance
   * while the machine sleeps — so long waits are re-checked in chunks rather
   * than trusted to fire once.
   */
  private schedule(task: ParkedTask): void {
    this.clearTimer(task.id);
    const MAX_STEP = 5 * 60 * 1000;
    const delay = Math.max(0, task.resumeAt - Date.now());

    if (delay === 0) {
      this.fire(task.id);
      return;
    }
    const timer = setTimeout(() => {
      const current = this.tasks.get(task.id);
      if (!current) return;
      if (Date.now() >= current.resumeAt) this.fire(task.id);
      else this.schedule(current); // woke early, or the clock jumped
    }, Math.min(delay, MAX_STEP));
    timer.unref?.();
    this.timers.set(task.id, timer);
  }

  private fire(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    this.clearTimer(id);
    this.tasks.delete(id);
    this.persist();
    this.onResume(task);
  }

  /** Run a parked task immediately instead of waiting. */
  resumeNow(id: string): boolean {
    if (!this.tasks.has(id)) return false;
    this.fire(id);
    return true;
  }

  cancel(id: string): boolean {
    if (!this.tasks.delete(id)) return false;
    this.clearTimer(id);
    this.persist();
    return true;
  }

  /** Re-arm everything after a restart, running anything already due. */
  restore(): void {
    for (const task of [...this.tasks.values()]) this.schedule(task);
  }

  list(): ParkedTask[] {
    return [...this.tasks.values()].sort((a, b) => a.resumeAt - b.resumeAt);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
  }
}
