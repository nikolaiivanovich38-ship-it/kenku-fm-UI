import { describe, expect, it } from "vitest";

import { acceleratorOf, globalKeyProblem, isGlobalKeysRequest } from "./globalKeys";

describe("keys that work in other programs too (UX-12, Settings › Keyboard shortcuts)", () => {
  it("turns Lyre's key names into Electron accelerators", () => {
    expect(acceleratorOf("Ctrl+Alt+N")).toBe("CommandOrControl+Alt+N");
    expect(acceleratorOf("Shift+Esc")).toBe("Shift+Escape");
    expect(acceleratorOf("F9")).toBe("F9");
    expect(acceleratorOf("Ctrl+Shift+Space")).toBe("CommandOrControl+Shift+Space");
    expect(acceleratorOf("Alt+Shift+Left")).toBe("Alt+Shift+Left");
    expect(acceleratorOf("Ctrl+Alt+/")).toBe("CommandOrControl+Alt+/");
    expect(acceleratorOf("Ctrl+Alt+PageDown")).toBe("CommandOrControl+Alt+PageDown");
  });

  it("refuses what is not a key Lyre can listen to", () => {
    expect(acceleratorOf("")).toBeNull();
    expect(acceleratorOf("Hyper+K")).toBeNull();
    expect(acceleratorOf("Ctrl+")).toBeNull();
  });

  it("accepts F keys, Shift+Esc and keys with two modifiers that include Ctrl or Alt", () => {
    for (const key of ["F9", "Shift+F2", "Ctrl+F12", "Shift+Esc", "Ctrl+Shift+N", "Alt+Shift+N", "Ctrl+Alt+PageDown", "Ctrl+Alt+Left", "Shift+F4", "F4"]) {
      expect(globalKeyProblem("nextScene", key), key).toBeNull();
    }
  });

  it("refuses keys used for typing, in plain words that say what to choose instead", () => {
    expect(globalKeyProblem("nextScene", "Space")).toBe(
      "Space cannot work in other programs: you type with it there. Give Next scene a key such as F9 or Ctrl+Shift+N (Change… above), then turn this on.",
    );
    for (const key of ["N", "Shift+N", "/", "Enter", "Esc", "Left", "Delete", "Tab"]) {
      expect(globalKeyProblem("fadeAll", key), key).toMatch(/^.+ cannot work in other programs: you type with it there\. Give Fade everything out a key such as F9/);
    }
  });

  it("refuses Ctrl or Alt with one key, which other programs use (copy, paste, undo, menus)", () => {
    for (const key of ["Ctrl+Z", "Ctrl+C", "Alt+N", "Ctrl+Space", "Alt+Left"]) {
      expect(globalKeyProblem("nextScene", key), key).toMatch(/^.+ is a key other programs use for themselves \(copy, paste, undo, their menus\)\. Give Next scene a key such as F9 or Ctrl\+Shift\+N/);
    }
  });

  it("CR-6 (review 0.5.0): refuses Ctrl+Alt with a typing key, which is AltGr on Belgian and other keyboards", () => {
    expect(globalKeyProblem("nextScene", "Ctrl+Alt+2")).toBe(
      "Ctrl+Alt+2 cannot work in other programs: on many keyboards, the Belgian one among them, Ctrl+Alt is AltGr, which types @, € or # there. Give Next scene a key such as F9 or Ctrl+Shift+N (Change… above), then turn this on.",
    );
    for (const key of ["Ctrl+Alt+E", "Ctrl+Alt+N", "Ctrl+Alt+/", "Ctrl+Alt+Space", "Ctrl+Alt+Shift+E", "Ctrl+Alt+Shift+2"]) {
      expect(globalKeyProblem("fadeAll", key), key).toMatch(/Ctrl\+Alt is AltGr/);
    }
  });

  it("CR-7 (review 0.5.0): refuses Alt+F4 and Ctrl+F4, which close windows and tabs in every program", () => {
    expect(globalKeyProblem("fadeAll", "Alt+F4")).toBe(
      "Alt+F4 is a key other programs use for themselves (closing a window or a tab). Give Fade everything out a key such as F9 or Ctrl+Shift+N (Change… above), then turn this on.",
    );
    for (const key of ["Ctrl+F4", "Ctrl+Alt+F4", "Alt+Shift+F4", "Ctrl+Shift+F4"]) {
      expect(globalKeyProblem("nextScene", key), key).toMatch(/closing a window or a tab/);
    }
  });

  it("checks the request the Lyre page sends: on or off, and the two actions' keys as short text", () => {
    expect(isGlobalKeysRequest({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } })).toBe(true);
    expect(isGlobalKeysRequest({ on: false, keys: {} })).toBe(true);
    expect(isGlobalKeysRequest({ on: true, keys: { nextScene: "F9", undo: "Ctrl+Z" } })).toBe(false);
    expect(isGlobalKeysRequest({ on: true, keys: { nextScene: "x".repeat(41) } })).toBe(false);
    expect(isGlobalKeysRequest({ on: "yes", keys: {} })).toBe(false);
    expect(isGlobalKeysRequest({ on: true, keys: {}, extra: 1 })).toBe(false);
    expect(isGlobalKeysRequest({ on: true, keys: [] })).toBe(false);
    expect(isGlobalKeysRequest(null)).toBe(false);
  });
});
