import type { WebStorage } from "redux-persist/es/types";

/** The part of `window.localStorage` the player writes to. */
export type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ThrottledStorage = WebStorage & {
  /** Write every waiting value now (synchronously). */
  flush(): void;
};

/**
 * PERF-6: storage for redux-persist that, while `isBusy()` is true, writes
 * each key (the library is one key, the player's volume and repeat settings
 * another) at most once per `intervalMs`. Kenku FM wrote the whole library to
 * disk on every change, so dragging a slider rewrote it dozens of times a
 * second.
 *
 * - When not busy, every change is written at once, exactly as before. When
 *   the app quits, Electron destroys the player page without warning, so any
 *   write held back then would be lost.
 * - While busy (the store treats a held mouse button or key as busy: a slider
 *   drag), the first change is written at once and later ones at most once per
 *   `intervalMs`, always with the latest value. The caller calls `flush()`
 *   when the user lets go, so the final value is written straight away.
 * - Reads see waiting values.
 * - A failed write (full disk, storage quota) keeps its value waiting and is
 *   tried again with the next change, or on `flush()`. `onError` hears about
 *   the first failure of a run; a write that works ends the run, so the next
 *   failure is reported again. The user is told once, not on every change.
 *
 * redux-persist's own `throttle` option is not used: it saves one part of the
 * state per tick and only writes when every changed part is done, so steady
 * editing kept postponing the save and a quit then lost it.
 */
export function createThrottledStorage(
  target: SyncStorage,
  intervalMs: number,
  isBusy: () => boolean = () => true,
  onError: (error: unknown) => void = () => undefined,
): ThrottledStorage {
  const waiting = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastWriteAt = new Map<string, number>();
  /** Keys whose last write failed; their values are still in `waiting`. */
  const failed = new Set<string>();

  function write(key: string) {
    const timer = timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(key);
    }
    if (!waiting.has(key)) {
      return;
    }
    const value = waiting.get(key)!;
    lastWriteAt.set(key, Date.now());
    try {
      target.setItem(key, value);
    } catch (error) {
      // For example a full disk or storage quota. Keep the app running and
      // the value waiting, so the next change tries again.
      const newRun = failed.size === 0;
      failed.add(key);
      if (newRun) {
        console.error(`Unable to save the player library (${key})`, error);
        onError(error);
      }
      return;
    }
    waiting.delete(key);
    failed.delete(key);
  }

  /** Write `key` now, or once `intervalMs` has passed since its last write while busy. */
  function schedule(key: string) {
    const wait = (lastWriteAt.get(key) ?? -Infinity) + intervalMs - Date.now();
    if (wait <= 0 || !isBusy()) {
      write(key);
    } else if (!timers.has(key)) {
      timers.set(key, setTimeout(() => write(key), wait));
    }
  }

  return {
    getItem(key) {
      return Promise.resolve(waiting.has(key) ? waiting.get(key)! : target.getItem(key));
    },
    setItem(key, value: string) {
      waiting.set(key, value);
      schedule(key);
      for (const other of [...failed]) {
        if (other !== key) {
          schedule(other);
        }
      }
      return Promise.resolve();
    },
    removeItem(key) {
      waiting.delete(key);
      failed.delete(key);
      target.removeItem(key);
      return Promise.resolve();
    },
    flush() {
      for (const key of [...waiting.keys()]) {
        write(key);
      }
    },
  };
}
