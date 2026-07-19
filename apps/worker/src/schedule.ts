import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ScheduledPrompt } from "@ai-workspace/protocol";
import { configDir } from "./config.js";
import { fireAt, type DeferredTimer } from "./deferred.js";

/**
 * Prompts queued to run at a chosen time.
 *
 * The use case is lining work up and walking away: queue a task against each
 * project before going to sleep and read the results in the morning. That only
 * holds if the queue outlives the process, so it is written to disk and re-armed
 * on boot — including anything whose time passed while the machine was off,
 * which runs immediately rather than being silently dropped.
 */
export class ScheduledPrompts {
  private readonly prompts = new Map<string, ScheduledPrompt>();
  private readonly timers = new Map<string, DeferredTimer>();
  private seq = 0;

  constructor(
    private onRun: (prompt: ScheduledPrompt) => void,
    private path: string = join(configDir(), "schedule.json"),
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as ScheduledPrompt[];
      for (const prompt of raw) this.prompts.set(prompt.id, prompt);
    } catch {
      // Corrupt store: start empty rather than refuse to boot.
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify([...this.prompts.values()], null, 2), "utf8");
    } catch {
      // Losing the queue is bad, but never worth crashing the Worker over.
    }
  }

  /** Queue a prompt to run at `runAt` (epoch ms). */
  add(input: Omit<ScheduledPrompt, "id" | "createdAt">): ScheduledPrompt {
    const prompt: ScheduledPrompt = {
      ...input,
      id: `sch${++this.seq}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    this.prompts.set(prompt.id, prompt);
    this.persist();
    this.arm(prompt);
    return prompt;
  }

  private arm(prompt: ScheduledPrompt): void {
    this.disarm(prompt.id);
    this.timers.set(
      prompt.id,
      fireAt(prompt.runAt, () => this.fire(prompt.id)),
    );
  }

  private fire(id: string): void {
    const prompt = this.prompts.get(id);
    if (!prompt) return;
    this.disarm(id);
    this.prompts.delete(id);
    this.persist();
    this.onRun(prompt);
  }

  /** Run a queued prompt now instead of waiting. */
  runNow(id: string): boolean {
    if (!this.prompts.has(id)) return false;
    this.fire(id);
    return true;
  }

  cancel(id: string): boolean {
    if (!this.prompts.delete(id)) return false;
    this.disarm(id);
    this.persist();
    return true;
  }

  /** Re-arm everything after a restart; anything overdue runs at once. */
  restore(): void {
    for (const prompt of [...this.prompts.values()]) this.arm(prompt);
  }

  list(): ScheduledPrompt[] {
    return [...this.prompts.values()].sort((a, b) => a.runAt - b.runAt);
  }

  /** Queued work for one workspace, for showing alongside that project. */
  forWorkspace(workspaceId: string): ScheduledPrompt[] {
    return this.list().filter((p) => p.workspaceId === workspaceId);
  }

  private disarm(id: string): void {
    this.timers.get(id)?.cancel();
    this.timers.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.disarm(id);
  }
}
