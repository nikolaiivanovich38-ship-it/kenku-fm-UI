import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SLEEP_AFTER_SILENT_MS, TabSleep, sleepDelay } from "./tabSleep";

let actions: { sleep: Mock<(id: number) => void>; wake: Mock<(id: number) => void> };
let sleep: TabSleep;

beforeEach(() => {
  vi.useFakeTimers();
  actions = { sleep: vi.fn<(id: number) => void>(), wake: vi.fn<(id: number) => void>() };
  sleep = new TabSleep(actions, 1_000);
  sleep.track(7);
});

describe("TabSleep (PERF-5)", () => {
  it("puts a hidden, silent tab to sleep after the delay", () => {
    sleep.hidden(7);
    vi.advanceTimersByTime(999);
    expect(actions.sleep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(actions.sleep).toHaveBeenCalledWith(7);
    expect(sleep.isAsleep(7)).toBe(true);
  });

  it("wakes the tab when it is shown again", () => {
    sleep.hidden(7);
    vi.advanceTimersByTime(1_000);
    sleep.shown(7);
    expect(actions.wake).toHaveBeenCalledWith(7);
    expect(sleep.isAsleep(7)).toBe(false);
  });

  it("never sleeps a visible tab", () => {
    vi.advanceTimersByTime(60_000);
    expect(actions.sleep).not.toHaveBeenCalled();
  });

  it("never sleeps a hidden tab that is playing sound (it is being sent to Discord)", () => {
    sleep.audible(7, true);
    sleep.hidden(7);
    vi.advanceTimersByTime(60_000);
    expect(actions.sleep).not.toHaveBeenCalled();
  });

  it("never sleeps a hidden tab whose video or audio is playing, even during a quiet passage", () => {
    sleep.mediaStarted(7);
    sleep.hidden(7);
    sleep.audible(7, false);
    vi.advanceTimersByTime(60_000);
    expect(actions.sleep).not.toHaveBeenCalled();
    sleep.mediaPaused(7);
    vi.advanceTimersByTime(1_000);
    expect(actions.sleep).toHaveBeenCalledWith(7);
  });

  it("starts counting again when a hidden tab plays and then falls silent", () => {
    sleep.hidden(7);
    vi.advanceTimersByTime(900);
    sleep.audible(7, true);
    vi.advanceTimersByTime(5_000);
    sleep.audible(7, false);
    vi.advanceTimersByTime(900);
    expect(actions.sleep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(actions.sleep).toHaveBeenCalledTimes(1);
  });

  it("does not wake a tab that was never asleep", () => {
    sleep.hidden(7);
    sleep.shown(7);
    expect(actions.wake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(actions.sleep).not.toHaveBeenCalled();
  });

  it("forgets a closed tab", () => {
    sleep.hidden(7);
    sleep.forget(7);
    vi.advanceTimersByTime(5_000);
    expect(actions.sleep).not.toHaveBeenCalled();
  });

  it("ignores tabs it does not track (the player)", () => {
    sleep.hidden(99);
    vi.advanceTimersByTime(5_000);
    expect(actions.sleep).not.toHaveBeenCalled();
  });

  it("does not count media below zero", () => {
    sleep.mediaPaused(7);
    sleep.mediaStarted(7);
    sleep.hidden(7);
    vi.advanceTimersByTime(5_000);
    expect(actions.sleep).not.toHaveBeenCalled();
  });
});

describe("sleepDelay", () => {
  it("is a minute of silence", () => {
    expect(SLEEP_AFTER_SILENT_MS).toBe(60_000);
    expect(sleepDelay({}, false)).toBe(SLEEP_AFTER_SILENT_MS);
  });

  it("can be shortened by automated tests, in test builds only", () => {
    expect(sleepDelay({ CUE_DESK_TAB_SLEEP_MS: "500" }, true)).toBe(500);
    expect(sleepDelay({ CUE_DESK_TAB_SLEEP_MS: "500" }, false)).toBe(SLEEP_AFTER_SILENT_MS);
    expect(sleepDelay({ CUE_DESK_TAB_SLEEP_MS: "soon" }, true)).toBe(SLEEP_AFTER_SILENT_MS);
  });
});
