import { describe, expect, it, vi } from "vitest";
import { holdCloseUntilSaved } from "./saveBeforeClose";

/**
 * PERF-6 (review 7): quitting, or closing the main window, waits until the
 * player has saved changes it was still holding back, then goes ahead.
 */
function setup() {
  let finishSaving: () => void = () => undefined;
  const save = vi.fn(() => new Promise<void>((resolve) => (finishSaving = resolve)));
  const close = vi.fn();
  const quit = vi.fn();
  const guard = holdCloseUntilSaved({ save, close, quit });
  return {
    guard,
    save,
    close,
    quit,
    event: () => ({ preventDefault: vi.fn() }),
    finishSaving: async () => {
      finishSaving();
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

describe("holdCloseUntilSaved (PERF-6)", () => {
  it("holds the first close of the window, saves, then closes it", async () => {
    const t = setup();
    const event = t.event();
    expect(t.guard.holdClose(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.close).not.toHaveBeenCalled();

    await t.finishSaving();
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(t.quit).not.toHaveBeenCalled();

    // The close that follows goes ahead.
    const again = t.event();
    expect(t.guard.holdClose(again)).toBe(false);
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it("holds the first quit before any window closes, saves, then quits", async () => {
    const t = setup();
    const event = t.event();
    expect(t.guard.holdQuit(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    await t.finishSaving();
    expect(t.quit).toHaveBeenCalledTimes(1);
    expect(t.close).not.toHaveBeenCalled();
    // The repeated quit, and the window closes it causes, go ahead.
    expect(t.guard.holdQuit(t.event())).toBe(false);
    expect(t.guard.holdClose(t.event())).toBe(false);
  });

  it("saves once when closing and quitting overlap, and then quits", async () => {
    const t = setup();
    t.guard.holdClose(t.event());
    const quitEvent = t.event();
    expect(t.guard.holdQuit(quitEvent)).toBe(true);
    expect(quitEvent.preventDefault).toHaveBeenCalled();
    const secondClose = t.event();
    expect(t.guard.holdClose(secondClose)).toBe(true);
    expect(secondClose.preventDefault).toHaveBeenCalled();
    await t.finishSaving();
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.quit).toHaveBeenCalledTimes(1);
    expect(t.close).not.toHaveBeenCalled();
  });

  it("still closes when saving fails", async () => {
    const close = vi.fn();
    const guard = holdCloseUntilSaved({
      save: () => Promise.reject(new Error("gone")),
      close,
      quit: vi.fn(),
    });
    guard.holdClose({ preventDefault: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
