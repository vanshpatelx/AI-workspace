/**
 * Recognising a usage limit, and knowing when it lifts.
 *
 * The agent reports quota state on its own stream:
 *
 *   {"type":"rate_limit_event","rate_limit_info":{
 *      "status":"allowed","resetsAt":1784440800,"rateLimitType":"five_hour"}}
 *
 * `resetsAt` is unix seconds, which means a blocked turn does not have to be
 * abandoned — it can be parked and retried exactly when the quota returns.
 */

export interface RateLimitState {
  /** Reported quota status; anything other than "allowed" is a block. */
  status: string;
  /** Unix seconds when the window resets, when the agent tells us. */
  resetsAt: number | null;
  /** e.g. "five_hour" — shown so the wait is understandable. */
  kind: string | null;
}

/** Read quota state from a `rate_limit_event`, if that's what this is. */
export function readRateLimit(event: unknown): RateLimitState | null {
  const info = (event as { rate_limit_info?: Record<string, unknown> })?.rate_limit_info;
  if (!info || typeof info !== "object") return null;
  return {
    status: typeof info.status === "string" ? info.status : "unknown",
    resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : null,
    kind: typeof info.rateLimitType === "string" ? info.rateLimitType : null,
  };
}

/** Text the agent produces when a turn dies for quota reasons. */
const LIMIT_TEXT =
  /(usage|rate)\s*limit|limit reached|too many requests|quota exceeded|429|resets? at/i;

/**
 * Did this turn fail because of a usage limit?
 *
 * Both signals are accepted: an explicit non-allowed status, or an error that
 * reads like a limit. Relying on the status alone would miss a turn that fails
 * before any rate_limit_event arrives.
 */
export function looksRateLimited(opts: {
  state: RateLimitState | null;
  errorText?: string;
  isError?: boolean;
}): boolean {
  const { state, errorText, isError } = opts;
  if (state && state.status !== "allowed" && state.status !== "unknown") return true;
  if (isError && errorText && LIMIT_TEXT.test(errorText)) return true;
  return false;
}

/**
 * When to retry, in epoch ms.
 *
 * A small buffer past the reset avoids retrying a second early and burning the
 * attempt; without a reported reset we wait a conservative hour rather than
 * hammering an endpoint that is already refusing us.
 */
export function resumeTime(state: RateLimitState | null, now = Date.now()): number {
  const BUFFER_MS = 30_000;
  const FALLBACK_MS = 60 * 60 * 1000;
  if (state?.resetsAt) {
    const at = state.resetsAt * 1000 + BUFFER_MS;
    // A reset already in the past means the window turned over while we were
    // failing; retry shortly rather than immediately.
    return at > now ? at : now + BUFFER_MS;
  }
  return now + FALLBACK_MS;
}

/** "4h 12m" — for telling the user how long the wait is. */
export function formatWait(ms: number): string {
  if (ms <= 0) return "now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
