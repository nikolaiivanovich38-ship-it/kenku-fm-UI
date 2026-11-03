/**
 * SEC-6: sliding-window limiter used to stop a website from flooding the app
 * with new tabs via window.open. Pure; the clock is injectable for tests.
 */
export interface RateLimiter<K> {
  /** Record an attempt for `key`; false when the limit for the window is used up. */
  tryAcquire(key: K): boolean;
  /** Drop all history for `key` (e.g. when its tab closes). */
  forget(key: K): void;
}

export function createRateLimiter<K>({
  max,
  windowMs,
  now = Date.now,
}: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter<K> {
  const attempts = new Map<K, number[]>();

  return {
    tryAcquire(key) {
      const time = now();
      const recent = (attempts.get(key) ?? []).filter(
        (t) => t > time - windowMs,
      );
      if (recent.length >= max) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(time);
      attempts.set(key, recent);
      return true;
    },
    forget(key) {
      attempts.delete(key);
    },
  };
}

/** Popups turned into tabs: at most 3 per tab every 10 seconds. */
export const POPUP_LIMIT = { max: 3, windowMs: 10_000 } as const;
