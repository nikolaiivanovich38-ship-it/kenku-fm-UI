import { describe, expect, it, vi } from "vitest";

import { GlobalKeys, type GlobalShortcutLike } from "./globalKeys";

/** Electron's globalShortcut, with keys another program holds. */
function fakeShortcuts(heldElsewhere: string[] = []) {
  const ours = new Map<string, () => void>();
  const shortcuts: GlobalShortcutLike & { ours: Map<string, () => void>; press(accelerator: string): void } = {
    ours,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (heldElsewhere.includes(accelerator) || ours.has(accelerator)) return false;
      ours.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      ours.delete(accelerator);
    }),
    press: (accelerator) => ours.get(accelerator)?.(),
  };
  return shortcuts;
}

describe("GlobalKeys: Next scene and Fade everything out from other programs (UX-12, globalShortcut)", () => {
  it("registers nothing until it is turned on", () => {
    const shortcuts = fakeShortcuts();
    new GlobalKeys(shortcuts, () => undefined);
    expect(shortcuts.register).not.toHaveBeenCalled();
  });

  it("registers the two actions' keys and tells which was pressed", () => {
    const shortcuts = fakeShortcuts();
    const pressed: string[] = [];
    const keys = new GlobalKeys(shortcuts, (action) => pressed.push(action));
    expect(keys.set({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } })).toEqual({ refused: [] });
    expect([...shortcuts.ours.keys()].sort()).toEqual(["F9", "Shift+Escape"]);
    shortcuts.press("F9");
    shortcuts.press("Shift+Escape");
    expect(pressed).toEqual(["nextScene", "fadeAll"]);
  });

  it("refuses, in plain words, a key another program holds, and keeps the other", () => {
    const shortcuts = fakeShortcuts(["F9"]);
    const keys = new GlobalKeys(shortcuts, () => undefined);
    expect(keys.set({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } })).toEqual({
      refused: [{ action: "nextScene", key: "F9", message: "Another program already uses F9 everywhere, so Next scene works only in Lyre. Give it another key, or close that program." }],
    });
    expect([...shortcuts.ours.keys()]).toEqual(["Shift+Escape"]);
  });

  it("refuses a typing key without registering it", () => {
    const shortcuts = fakeShortcuts();
    const keys = new GlobalKeys(shortcuts, () => undefined);
    const answer = keys.set({ on: true, keys: { nextScene: "Space", fadeAll: "Shift+Esc" } });
    expect(answer.refused).toEqual([{ action: "nextScene", key: "Space", message: expect.stringMatching(/^Space cannot work in other programs/) }]);
    expect(shortcuts.register).toHaveBeenCalledTimes(1);
  });

  it("an Electron refusal (a key it cannot listen to) is a refusal too, not a crash", () => {
    const shortcuts = fakeShortcuts();
    shortcuts.register = vi.fn(() => {
      throw new Error("conversion failure");
    });
    const keys = new GlobalKeys(shortcuts, () => undefined);
    expect(keys.set({ on: true, keys: { fadeAll: "Shift+Esc" } }).refused).toEqual([{ action: "fadeAll", key: "Shift+Esc", message: expect.stringMatching(/^Lyre cannot listen to Shift\+Esc in other programs/) }]);
  });

  it("changing a key lets go of the old one first; turning it off lets go of both", () => {
    const shortcuts = fakeShortcuts();
    const keys = new GlobalKeys(shortcuts, () => undefined);
    keys.set({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } });
    keys.set({ on: true, keys: { nextScene: "F10", fadeAll: "Shift+Esc" } });
    expect([...shortcuts.ours.keys()].sort()).toEqual(["F10", "Shift+Escape"]);
    keys.set({ on: false, keys: { nextScene: "F10", fadeAll: "Shift+Esc" } });
    expect([...shortcuts.ours.keys()]).toEqual([]);
  });

  it("two actions cannot share one key: the second is refused", () => {
    const shortcuts = fakeShortcuts();
    const keys = new GlobalKeys(shortcuts, () => undefined);
    expect(keys.set({ on: true, keys: { nextScene: "F9", fadeAll: "F9" } }).refused).toEqual([
      { action: "fadeAll", key: "F9", message: "F9 is already Next scene. Give Fade everything out another key." },
    ]);
  });

  it("dispose() lets go of every key it registered (quitting, or the window closing), and nothing else", () => {
    const shortcuts = fakeShortcuts();
    const keys = new GlobalKeys(shortcuts, () => undefined);
    keys.set({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } });
    keys.dispose();
    expect(shortcuts.ours.size).toBe(0);
    expect(shortcuts.unregister).toHaveBeenCalledTimes(2);
    keys.dispose();
    expect(shortcuts.unregister).toHaveBeenCalledTimes(2);
    // After dispose a late request registers nothing.
    expect(keys.set({ on: true, keys: { nextScene: "F9" } })).toEqual({ refused: [] });
    expect(shortcuts.ours.size).toBe(0);
  });
});
