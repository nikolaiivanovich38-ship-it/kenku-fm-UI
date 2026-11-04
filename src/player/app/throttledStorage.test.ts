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

  it("a failed write is reported once per run of failures, and the app carries on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let full = true;
    const disk = memoryStorage();
    const onError = vi.fn();
    const storage = createThrottledStorage(
      {
        ...disk.storage,
        setItem: (key, value) => {
          if (full) {
            throw new DOMException("Setting the value exceeded the quota.", "QuotaExceededError");
          }
          disk.storage.setItem(key, value);
        },
      },
      1000,
      () => false,
      onError,
    );
    await expect(storage.setItem("library", "x")).resolves.toBeUndefined();
    await storage.setItem("library", "y");
    await storage.setItem("settings", "z");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ name: "QuotaExceededError" });
    expect(error).toHaveBeenCalledTimes(1);

    // A save that works ends the run; the next failure is reported again.
    full = false;
    await storage.setItem("library", "ok");
    full = true;
    await storage.setItem("library", "fails again");
    expect(onError).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("a value that failed to save is tried again with the next change", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const disk = memoryStorage();
    let failures = 1;
    const storage = createThrottledStorage(
      {
        ...disk.storage,
        setItem: (key, value) => {
          if (failures > 0) {
            failures--;
            throw new Error("disk full");
          }
          disk.storage.setItem(key, value);
        },
      },
      1000,
      () => false,
      () => undefined,
    );
    await storage.setItem("library", "lost before");
    expect(disk.data.has("library")).toBe(false);
    // Reads still see it, so later changes build on it.
    expect(await storage.getItem("library")).toBe("lost before");

    await storage.setItem("settings", "s1");

    expect(disk.data.get("library")).toBe("lost before");
    expect(disk.data.get("settings")).toBe("s1");
    vi.restoreAllMocks();
  });

  it("flush tries a failed value again too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const disk = memoryStorage();
    let failures = 1;
    const storage = createThrottledStorage(
      {
        ...disk.storage,
        setItem: (key, value) => {
          if (failures-- > 0) throw new Error("disk full");
          disk.storage.setItem(key, value);
        },
      },
      1000,
      () => false,
      () => undefined,
    );
    await storage.setItem("library", "v1");
    storage.flush();
    expect(disk.data.get("library")).toBe("v1");
    vi.restoreAllMocks();
  });
});
