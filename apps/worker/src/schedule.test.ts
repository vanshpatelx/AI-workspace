import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScheduledPrompt } from "@ai-workspace/protocol";
import { ScheduledPrompts } from "./schedule.js";
import { fireAt } from "./deferred.js";

let dir: string;
let store: string;
const base = { workspaceId: "ws1", sessionId: null, text: "run the test suite" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aiw-sched-"));
  store = join(dir, "schedule.json");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("deferring to a wall-clock time", () => {
  it("fires when the deadline arrives", () => {
    const fired: string[] = [];
    fireAt(Date.now() + 60_000, () => fired.push("go"));
    vi.advanceTimersByTime(59_000);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(2_000);
    expect(fired).toHaveLength(1);
  });

  it("fires immediately for a deadline already past", () => {
    const fired: string[] = [];
    fireAt(Date.now() - 1000, () => fired.push("go"));
    expect(fired).toHaveLength(1);
  });

  // A single setTimeout would be late by however long the machine slept.
  it("survives a wait far longer than one timer step", () => {
    const fired: string[] = [];
    fireAt(Date.now() + 8 * 60 * 60 * 1000, () => fired.push("go"));
    vi.advanceTimersByTime(7 * 60 * 60 * 1000);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
    expect(fired).toHaveLength(1);
  });

  it("can be cancelled before it fires", () => {
    const fired: string[] = [];
    const timer = fireAt(Date.now() + 60_000, () => fired.push("go"));
    timer.cancel();
    vi.advanceTimersByTime(120_000);
    expect(fired).toHaveLength(0);
  });
});

describe("scheduling prompts", () => {
  it("runs a queued prompt at its time", () => {
    const run: ScheduledPrompt[] = [];
    const schedule = new ScheduledPrompts((p) => run.push(p), store);
    schedule.add({ ...base, runAt: Date.now() + 30 * 60 * 1000 });

    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(run).toHaveLength(0);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(run[0]?.text).toBe("run the test suite");
  });

  it("keeps several projects queued independently", () => {
    const run: ScheduledPrompt[] = [];
    const schedule = new ScheduledPrompts((p) => run.push(p), store);
    schedule.add({ ...base, workspaceId: "wsA", text: "A", runAt: Date.now() + 60_000 });
    schedule.add({ ...base, workspaceId: "wsB", text: "B", runAt: Date.now() + 120_000 });

    expect(schedule.forWorkspace("wsA")).toHaveLength(1);
    vi.advanceTimersByTime(61_000);
    expect(run.map((p) => p.text)).toEqual(["A"]);
    vi.advanceTimersByTime(61_000);
    expect(run.map((p) => p.text)).toEqual(["A", "B"]);
  });

  it("orders the queue by when each runs", () => {
    const schedule = new ScheduledPrompts(() => {}, store);
    schedule.add({ ...base, text: "later", runAt: Date.now() + 90_000 });
    schedule.add({ ...base, text: "sooner", runAt: Date.now() + 30_000 });
    expect(schedule.list().map((p) => p.text)).toEqual(["sooner", "later"]);
  });

  it("can run a prompt early", () => {
    const run: ScheduledPrompt[] = [];
    const schedule = new ScheduledPrompts((p) => run.push(p), store);
    const prompt = schedule.add({ ...base, runAt: Date.now() + 60 * 60 * 1000 });
    expect(schedule.runNow(prompt.id)).toBe(true);
    expect(run).toHaveLength(1);
    expect(schedule.list()).toHaveLength(0);
  });

  it("can cancel a prompt so it never runs", () => {
    const run: ScheduledPrompt[] = [];
    const schedule = new ScheduledPrompts((p) => run.push(p), store);
    const prompt = schedule.add({ ...base, runAt: Date.now() + 60_000 });
    expect(schedule.cancel(prompt.id)).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(run).toHaveLength(0);
  });

  it("reports unknown ids instead of pretending to act", () => {
    const schedule = new ScheduledPrompts(() => {}, store);
    expect(schedule.cancel("nope")).toBe(false);
    expect(schedule.runNow("nope")).toBe(false);
  });

  it("drops a prompt from the queue once it has run", () => {
    const schedule = new ScheduledPrompts(() => {}, store);
    schedule.add({ ...base, runAt: Date.now() + 1000 });
    vi.advanceTimersByTime(2000);
    expect(schedule.list()).toHaveLength(0);
  });
});

describe("surviving a restart", () => {
  it("keeps the queue on disk and re-arms it", () => {
    const first = new ScheduledPrompts(() => {}, store);
    first.add({ ...base, runAt: Date.now() + 60_000 });
    first.stopAll();

    const run: ScheduledPrompt[] = [];
    const reopened = new ScheduledPrompts((p) => run.push(p), store);
    expect(reopened.list()).toHaveLength(1);
    reopened.restore();
    vi.advanceTimersByTime(61_000);
    expect(run).toHaveLength(1);
  });

  // Queueing work overnight is the whole point, so a machine that was asleep
  // or shut down must still run it rather than silently skip it.
  it("runs work whose time passed while the Worker was down", () => {
    const first = new ScheduledPrompts(() => {}, store);
    first.add({ ...base, runAt: Date.now() + 1000 });
    first.stopAll();
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);

    const run: ScheduledPrompt[] = [];
    new ScheduledPrompts((p) => run.push(p), store).restore();
    expect(run).toHaveLength(1);
  });

  it("starts empty when the store is corrupt", () => {
    writeFileSync(store, "{ not json");
    expect(() => new ScheduledPrompts(() => {}, store)).not.toThrow();
    expect(new ScheduledPrompts(() => {}, store).list()).toEqual([]);
  });
});
