/**
 * The audio cache's upkeep in the app (security review 3): tidied once a while after the window shows (never
 * during start-up), emptied by Settings > Clear cache, and closed before Lyre quits.
 */
import { describe, expect, it, vi } from "vitest";

import { MediaUpkeep } from "./mediaUpkeep";

function fakeCache() {
  return { sweep: vi.fn(async () => 2), clear: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
}

describe("MediaUpkeep", () => {
  it("tidies the cache once, a while after the window shows", async () => {
    vi.useFakeTimers();
    try {
      const cache = fakeCache();
      const upkeep = new MediaUpkeep(cache, { sweepAfterMs: 30_000, log: () => undefined });
      upkeep.windowShown();
      upkeep.windowShown();
      await vi.advanceTimersByTimeAsync(29_000);
      expect(cache.sweep).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(cache.sweep).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("empties the cache for Clear cache, and closes it (no tidy-up after closing)", async () => {
    vi.useFakeTimers();
    try {
      const cache = fakeCache();
      const upkeep = new MediaUpkeep(cache, { sweepAfterMs: 1000, log: () => undefined });
      await upkeep.clear();
      expect(cache.clear).toHaveBeenCalled();
      upkeep.windowShown();
      await upkeep.close();
      expect(cache.close).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(cache.sweep).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs a failed tidy-up instead of failing", async () => {
    vi.useFakeTimers();
    try {
      const cache = { ...fakeCache(), sweep: vi.fn(async () => Promise.reject(new Error("disk gone"))) };
      const log = vi.fn();
      new MediaUpkeep(cache, { sweepAfterMs: 10, log }).windowShown();
      await vi.advanceTimersByTimeAsync(20);
      expect(log).toHaveBeenCalledWith("Could not tidy the audio cache", expect.any(Error));
    } finally {
      vi.useRealTimers();
    }
  });
});
