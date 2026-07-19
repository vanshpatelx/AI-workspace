import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParkedTask } from "@ai-workspace/protocol";
import { ParkedTasks } from "./parked.js";

let dir: string;
let store: string;

const sample = { workspaceId: "ws1", sessionId: "s1", text: "finish the refactor", reason: "five-hour usage limit" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aiw-parked-"));
  store = join(dir, "parked.json");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("parking work until the quota returns", () => {
  it("holds a task and runs it when the reset arrives", () => {
    const resumed: ParkedTask[] = [];
    const parked = new ParkedTasks((t) => resumed.push(t), store);
    parked.park({ ...sample, resumeAt: Date.now() + 60_000 });

    vi.advanceTimersByTime(59_000);
    expect(resumed).toHaveLength(0); // still waiting

    vi.advanceTimersByTime(2_000);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.text).toBe("finish the refactor");
  });

  // setTimeout does not advance while a machine sleeps, so long waits are
  // re-checked in steps instead of trusted to a single fire.
  it("handles a wait longer than a single timer step", () => {
    const resumed: ParkedTask[] = [];
    const parked = new ParkedTasks((t) => resumed.push(t), store);
    parked.park({ ...sample, resumeAt: Date.now() + 5 * 60 * 60 * 1000 });

    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(resumed).toHaveLength(0);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
    expect(resumed).toHaveLength(1);
  });

  it("runs a task whose reset already passed", () => {
    const resumed: ParkedTask[] = [];
    const parked = new ParkedTasks((t) => resumed.push(t), store);
    parked.park({ ...sample, resumeAt: Date.now() - 1000 });
    expect(resumed).toHaveLength(1);
  });

  it("stops tracking a task once it has run", () => {
    const parked = new ParkedTasks(() => {}, store);
    parked.park({ ...sample, resumeAt: Date.now() + 1000 });
    vi.advanceTimersByTime(2000);
    expect(parked.list()).toHaveLength(0);
  });

  it("can run a task early on request", () => {
    const resumed: ParkedTask[] = [];
    const parked = new ParkedTasks((t) => resumed.push(t), store);
    const task = parked.park({ ...sample, resumeAt: Date.now() + 60 * 60 * 1000 });

    expect(parked.resumeNow(task.id)).toBe(true);
    expect(resumed).toHaveLength(1);
    expect(parked.list()).toHaveLength(0);
  });

  it("can drop a task without running it", () => {
    const resumed: ParkedTask[] = [];
    const parked = new ParkedTasks((t) => resumed.push(t), store);
    const task = parked.park({ ...sample, resumeAt: Date.now() + 60_000 });

    expect(parked.cancel(task.id)).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(resumed).toHaveLength(0);
  });

  it("reports unknown ids rather than pretending to act", () => {
    const parked = new ParkedTasks(() => {}, store);
    expect(parked.cancel("nope")).toBe(false);
    expect(parked.resumeNow("nope")).toBe(false);
  });

  it("orders the queue by when each task resumes", () => {
    const parked = new ParkedTasks(() => {}, store);
    parked.park({ ...sample, text: "later", resumeAt: Date.now() + 90_000 });
    parked.park({ ...sample, text: "sooner", resumeAt: Date.now() + 30_000 });
    expect(parked.list().map((t) => t.text)).toEqual(["sooner", "later"]);
  });
});

describe("surviving a restart", () => {
  it("keeps parked work on disk", () => {
    const first = new ParkedTasks(() => {}, store);
    first.park({ ...sample, resumeAt: Date.now() + 60_000 });
    first.stopAll();
    expect(existsSync(store)).toBe(true);

    const reopened = new ParkedTasks(() => {}, store);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0]?.text).toBe("finish the refactor");
  });

  it("re-arms a restored task so it still runs", () => {
    const first = new ParkedTasks(() => {}, store);
    first.park({ ...sample, resumeAt: Date.now() + 60_000 });
    first.stopAll();

    const resumed: ParkedTask[] = [];
    const reopened = new ParkedTasks((t) => resumed.push(t), store);
    reopened.restore();
    vi.advanceTimersByTime(61_000);
    expect(resumed).toHaveLength(1);
  });

  // The window can pass entirely while a laptop is closed.
  it("runs work whose window opened while the Worker was down", () => {
    const first = new ParkedTasks(() => {}, store);
    first.park({ ...sample, resumeAt: Date.now() + 1000 });
    first.stopAll();

    vi.advanceTimersByTime(10 * 60 * 1000); // time passes with nothing running

    const resumed: ParkedTask[] = [];
    new ParkedTasks((t) => resumed.push(t), store).restore();
    expect(resumed).toHaveLength(1);
  });

  it("starts empty when the store is corrupt", () => {
    require("node:fs").writeFileSync(store, "{ not json");
    expect(() => new ParkedTasks(() => {}, store)).not.toThrow();
    expect(new ParkedTasks(() => {}, store).list()).toEqual([]);
  });
});
