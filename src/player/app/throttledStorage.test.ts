import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThrottledStorage, SyncStorage } from "./throttledStorage";

/** PERF-6: write coalescing for the player's saved data. */
function memoryStorage() {
  const data = new Map<string, string>();
  const writes: [string, string][] = [];
  const storage: SyncStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, writes, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createThrottledStorage (PERF-6)", () => {
  it("writes a single change at once", async () => {
    const disk = memoryStorage();
    const storage = createThrottledStorage(disk.storage, 1000);
    await storage.setItem("library", "v1");
    expect(disk.writes).toEqual([["library", "v1"]]);
  });

  it("writes a burst of changes at most once a second, ending with the last value", async () => {
    const disk = memoryStorage();
    const storage = createThrottledStorage(disk.storage, 1000);
    for (let step = 1; step <= 100; step++) {
      await storage.setItem("library", `v${step}`);
      vi.advanceTimersByTime(30);
    }
    vi.advanceTimersByTime(1000);
    expect(disk.writes.map(([, value]) => value)).toEqual(["v1", "v34", "v67", "v100"]);
  });

  it("when not busy, every change is written at once", async () => {
    const disk = memoryStorage();
    let busy = false;
    const storage = createThrottledStorage(disk.storage, 1000, () => busy);
    await storage.setItem("library", "v1");
    await storage.setItem("library", "v2");
    busy = true;
    await storage.setItem("library", "v3");
    busy = false;
    await storage.setItem("library", "v4");
    expect(disk.writes.map(([, value]) => value)).toEqual(["v1", "v2", "v4"]);
    vi.advanceTimersByTime(5000);
    expect(disk.writes).toHaveLength(3);
  });

  it("keys are throttled separately", async () => {
    const disk = memoryStorage();
    const storage = createThrottledStorage(disk.storage, 1000);
    await storage.setItem("library", "a");
    await storage.setItem("settings", "b");
    expect(disk.writes).toEqual([
      ["library", "a"],
      ["settings", "b"],
    ]);
  });

  it("reads see a value that is still waiting", async () => {
    const disk = memoryStorage();
    const storage = createThrottledStorage(disk.storage, 1000);
    await storage.setItem("library", "first");
    await storage.setItem("library", "second");
    expect(disk.data.get("library")).toBe("first");
    expect(await storage.getItem("library")).toBe("second");
  });

  it("flush writes waiting values straight away and cancels the timer", async () => {
    const disk = memoryStorage();
    const storage = createThrottledStorage(disk.storage, 1000);
    await storage.setItem("library", "first");
    await storage.setItem("library", "second");
    storage.flush();
    expect(disk.data.get("library")).toBe("second");
    vi.advanceTimersByTime(5000);
    expect(disk.writes).toHaveLength(2);
  });

  it("removing a key drops its waiting value", async () => {
    const disk = memoryStorage();
    const storage = createThrottledStorage(disk.storage, 1000);
    await storage.setItem("library", "first");
    await storage.setItem("library", "second");
    await storage.removeItem("library");
    vi.advanceTimersByTime(5000);
    expect(disk.data.has("library")).toBe(false);
  });

  it("a failed write is reported and the app carries on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const storage = createThrottledStorage(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => undefined,
      },
      1000,
    );
    await expect(storage.setItem("library", "x")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Unable to save the player library (library)", expect.any(Error));
    error.mockRestore();
  });
});
