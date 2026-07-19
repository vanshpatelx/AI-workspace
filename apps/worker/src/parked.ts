import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ParkedTask } from "@ai-workspace/protocol";
import { configDir } from "./config.js";
import { fireAt, type DeferredTimer } from "./deferred.js";

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
  private readonly timers = new Map<string, DeferredTimer>();
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

  /** Arm the deadline for a task; see deferred.ts for why this is not a plain setTimeout. */
  private schedule(task: ParkedTask): void {
    this.clearTimer(task.id);
    this.timers.set(
      task.id,
      fireAt(task.resumeAt, () => this.fire(task.id)),
    );
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
    this.timers.get(id)?.cancel();
    this.timers.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
  }
}
