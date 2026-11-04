import { vi } from "vitest";

/** How many timer and animation-frame callbacks ran, by kind. */
export type WakeUpCounts = { animationFrame: number; interval: number; timeout: number };

/**
 * Counts every requestAnimationFrame, setInterval and setTimeout callback that
 * runs (PERF-1). Each one wakes the player page up, so on an idle player the
 * total is the number of times the page woke up for nothing.
 *
 * Call after `vi.useFakeTimers()` (it wraps the fake timers) and undo with
 * `vi.restoreAllMocks()`. Only timers created after this call are counted.
 */
export function countWakeUps() {
  const counts: WakeUpCounts = { animationFrame: 0, interval: 0, timeout: 0 };
  const realAnimationFrame = globalThis.requestAnimationFrame;
  const realInterval = globalThis.setInterval;
  const realTimeout = globalThis.setTimeout;

  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) =>
    realAnimationFrame((time) => {
      counts.animationFrame += 1;
      callback(time);
    }),
  );
  vi.spyOn(globalThis, "setInterval").mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) =>
    realInterval(() => {
      counts.interval += 1;
      callback(...args);
    }, ms)) as typeof setInterval);
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) =>
    realTimeout(() => {
      counts.timeout += 1;
      callback(...args);
    }, ms)) as typeof setTimeout);

  return {
    counts,
    /** All callbacks counted since the last reset. */
    total: () => counts.animationFrame + counts.interval + counts.timeout,
    reset: () => {
      counts.animationFrame = 0;
      counts.interval = 0;
      counts.timeout = 0;
    },
  };
}
