import { describe, it, expect } from "vitest";
import { readRateLimit, looksRateLimited, resumeTime, formatWait } from "./ratelimit.js";

/**
 * This path only runs when a real quota is exhausted, which is not something
 * that can be triggered on demand — so the decision logic is covered here
 * against the exact event shapes the agent emits.
 */
describe("reading quota state", () => {
  it("reads the agent's rate_limit_event verbatim", () => {
    const state = readRateLimit({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1784440800, rateLimitType: "five_hour" },
    });
    expect(state).toEqual({ status: "allowed", resetsAt: 1784440800, kind: "five_hour" });
  });

  it("ignores events that carry no quota information", () => {
    expect(readRateLimit({ type: "assistant" })).toBeNull();
    expect(readRateLimit(null)).toBeNull();
    expect(readRateLimit("nonsense")).toBeNull();
  });

  it("tolerates missing fields rather than throwing", () => {
    const state = readRateLimit({ rate_limit_info: {} });
    expect(state).toEqual({ status: "unknown", resetsAt: null, kind: null });
  });
});

describe("deciding a turn was blocked by quota", () => {
  it("treats a non-allowed status as blocked", () => {
    expect(
      looksRateLimited({ state: { status: "rejected", resetsAt: 100, kind: "five_hour" } }),
    ).toBe(true);
  });

  it("does not park a turn that was allowed", () => {
    expect(
      looksRateLimited({ state: { status: "allowed", resetsAt: 100, kind: "five_hour" } }),
    ).toBe(false);
  });

  // A turn can fail before any rate_limit_event arrives, so the error text is
  // a second signal rather than a fallback.
  it.each([
    ["usage limit reached"],
    ["Rate limit exceeded"],
    ["429 Too Many Requests"],
    ["quota exceeded for this window"],
    ["limit reached, resets at 5pm"],
  ])("recognises %s from the error text", (errorText) => {
    expect(looksRateLimited({ state: null, errorText, isError: true })).toBe(true);
  });

  it("does not mistake an ordinary failure for a quota block", () => {
    expect(
      looksRateLimited({ state: null, errorText: "file not found", isError: true }),
    ).toBe(false);
  });

  it("ignores limit-like words when the turn did not fail", () => {
    expect(
      looksRateLimited({ state: null, errorText: "explain rate limit handling", isError: false }),
    ).toBe(false);
  });

  it("does not park on an unknown status alone", () => {
    // Absent information is not evidence of a block.
    expect(looksRateLimited({ state: { status: "unknown", resetsAt: null, kind: null } })).toBe(
      false,
    );
  });
});

describe("choosing when to retry", () => {
  const now = 1_700_000_000_000;

  it("waits until just after the reported reset", () => {
    const resetsAt = Math.floor(now / 1000) + 3600; // an hour out
    const at = resumeTime({ status: "rejected", resetsAt, kind: "five_hour" }, now);
    expect(at).toBeGreaterThan(resetsAt * 1000);
    // A small buffer, not a long one.
    expect(at - resetsAt * 1000).toBeLessThanOrEqual(60_000);
  });

  it("retries shortly when the reset has already passed", () => {
    const resetsAt = Math.floor(now / 1000) - 600; // ten minutes ago
    const at = resumeTime({ status: "rejected", resetsAt, kind: null }, now);
    expect(at).toBeGreaterThan(now);
    expect(at - now).toBeLessThanOrEqual(60_000);
  });

  it("waits a conservative hour when no reset is reported", () => {
    // Retrying blind against an endpoint already refusing us helps nobody.
    const at = resumeTime(null, now);
    expect(at - now).toBe(60 * 60 * 1000);
  });
});

describe("describing the wait", () => {
  it.each([
    [30_000, "1m"],
    [45 * 60_000, "45m"],
    [60 * 60_000, "1h"],
    [(4 * 60 + 12) * 60_000, "4h 12m"],
    [0, "now"],
    [-5000, "now"],
  ])("formats %sms as %s", (ms, expected) => {
    expect(formatWait(ms)).toBe(expected);
  });
});
