/**
 * Running something at a wall-clock time, hours away.
 *
 * `setTimeout` is the obvious tool and the wrong one on its own: it does not
 * advance while a laptop is asleep, so a timer armed for 5am fires late by
 * however long the machine was closed. Waiting in bounded steps and comparing
 * against the clock each time makes the deadline authoritative instead of the
 * timer.
 *
 * Shared by the two things that defer work — a turn parked on a usage limit,
 * and a prompt scheduled deliberately — so this only has to be right once.
 */

/** Longest single wait before re-checking the clock. */
const MAX_STEP_MS = 5 * 60 * 1000;

export interface DeferredTimer {
  cancel(): void;
}

/**
 * Call `onFire` at `runAt` (epoch ms), or immediately if that has passed.
 * The returned handle cancels it.
 */
export function fireAt(runAt: number, onFire: () => void, now = () => Date.now()): DeferredTimer {
  let timer: NodeJS.Timeout | null = null;
  let cancelled = false;

  const step = () => {
    if (cancelled) return;
    const remaining = runAt - now();
    if (remaining <= 0) {
      onFire();
      return;
    }
    timer = setTimeout(step, Math.min(remaining, MAX_STEP_MS));
    // Never hold the process open just to wait.
    timer.unref?.();
  };

  step();

  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
