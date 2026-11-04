/**
 * PERF-6: while the user drags a slider (holds the mouse button or a key), the
 * library is saved at most about once a second, and the final value is saved
 * as soon as they let go. Other changes are saved at once, as before, because
 * Electron destroys the player page without warning when the app quits.
 * Kenku FM saved the whole library (every playlist and soundboard) on every
 * change, so dragging a sound's volume slider rewrote it dozens of times a second.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Sound } from "../features/soundboards/soundboardsSlice";

const sound: Sound = { id: "s1", url: "file:///s1.ogg", title: "Rain", loop: true, volume: 1, fadeIn: 0, fadeOut: 0 };

/** Load a fresh copy of the real store (it is created when the module loads) and wait until it has loaded saved data. */
async function loadStore() {
  vi.resetModules();
  const app = await import("./store");
  const soundboards = await import("../features/soundboards/soundboardsSlice");
  const playback = await import("../features/playlists/playlistPlaybackSlice");
  await vi.advanceTimersByTimeAsync(0);
  expect(app.persistor.getState().bootstrapped).toBe(true);
  app.store.dispatch(soundboards.addSoundboard({ id: "b1", title: "Weather", background: "", sounds: [] }));
  app.store.dispatch(soundboards.addSound({ soundboardId: "b1", sound }));
  await vi.advanceTimersByTimeAsync(5_000);
  return { ...app, editSound: soundboards.editSound, adjustVolume: playback.adjustVolume };
}

/** The sound's volume as saved on disk. */
function savedSoundVolume(): number | undefined {
  const saved = window.localStorage.getItem("persist:player");
  if (!saved) {
    return undefined;
  }
  return JSON.parse(JSON.parse(saved).soundboards).sounds.s1?.volume;
}

function savedPlayerVolume(): number | undefined {
  const saved = window.localStorage.getItem("persist:playback");
  return saved ? JSON.parse(JSON.parse(saved).volume) : undefined;
}

let writes: ReturnType<typeof vi.spyOn<Storage, "setItem">>;
const writesOf = (key: string) => writes.mock.calls.filter(([name]) => name === key).length;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  writes = vi.spyOn(Storage.prototype, "setItem");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const press = (event: string) => window.dispatchEvent(new Event(event));

describe("saving the player library (PERF-6)", () => {
  it("dragging a sound's volume for 3 seconds saves about once a second and the final value on release", async () => {
    const { store, editSound } = await loadStore();
    writes.mockClear();

    press("pointerdown");
    // 100 slider steps, 30 ms apart.
    for (let step = 1; step <= 100; step++) {
      store.dispatch(editSound({ id: "s1", volume: step / 200 }));
      await vi.advanceTimersByTimeAsync(30);
    }
    const duringDrag = writesOf("persist:player");
    press("pointerup");

    expect(duringDrag).toBeLessThanOrEqual(4);
    expect(savedSoundVolume()).toBe(0.5);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(writesOf("persist:player")).toBeLessThanOrEqual(5);
  });

  it("holding an arrow key on the player volume is throttled the same way", async () => {
    const { store, adjustVolume } = await loadStore();
    writes.mockClear();

    press("keydown");
    for (let step = 1; step <= 100; step++) {
      store.dispatch(adjustVolume(step / 100));
      await vi.advanceTimersByTimeAsync(30);
    }
    press("keyup");

    expect(writesOf("persist:playback")).toBeLessThanOrEqual(5);
    expect(writesOf("persist:player")).toBe(0);
    expect(savedPlayerVolume()).toBe(1);
  });

  it("changes made without holding a button or key are saved at once, as before", async () => {
    const { store, editSound, adjustVolume } = await loadStore();
    store.dispatch(editSound({ id: "s1", volume: 0.6 }));
    store.dispatch(adjustVolume(0.2));
    await vi.advanceTimersByTimeAsync(0);
    expect(savedSoundVolume()).toBe(0.6);
    expect(savedPlayerVolume()).toBe(0.2);

    store.dispatch(editSound({ id: "s1", volume: 0.3 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(savedSoundVolume()).toBe(0.3);
  });

  it.each(["pointerup", "pointercancel", "keyup", "blur", "pagehide"])(
    "a change still waiting is saved at once on %s",
    async (event) => {
      const { store, editSound, adjustVolume } = await loadStore();
      press("pointerdown");
      store.dispatch(editSound({ id: "s1", volume: 0.1 }));
      store.dispatch(adjustVolume(0.9));
      await vi.advanceTimersByTimeAsync(100);
      store.dispatch(editSound({ id: "s1", volume: 0.25 }));
      store.dispatch(adjustVolume(0.4));
      await vi.advanceTimersByTimeAsync(100);
      expect(savedSoundVolume()).toBe(0.1);
      expect(savedPlayerVolume()).toBe(0.9);

      press(event);

      expect(savedSoundVolume()).toBe(0.25);
      expect(savedPlayerVolume()).toBe(0.4);
    },
  );

  it("a change still waiting is saved when the page is hidden", async () => {
    const { store, editSound } = await loadStore();
    press("pointerdown");
    store.dispatch(editSound({ id: "s1", volume: 0.1 }));
    await vi.advanceTimersByTimeAsync(100);
    store.dispatch(editSound({ id: "s1", volume: 0.75 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(savedSoundVolume()).toBe(0.1);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(savedSoundVolume()).toBe(0.75);
    visibility.mockRestore();
  });
});
