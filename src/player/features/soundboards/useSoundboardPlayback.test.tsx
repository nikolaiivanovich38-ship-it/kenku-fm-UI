import React from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeHowl } from "../../test/fakeHowler";
import { createPlayerStore, PlayerStore } from "../../test/createPlayerStore";
import { Sound as SoundType } from "./soundboardsSlice";
import { useSoundboardPlayback } from "./useSoundboardPlayback";

/** Characterisation tests for soundboard playback (WP0 S3). */
vi.mock("howler", () => import("../../test/fakeHowler"));

const sound = (id: string, overrides: Partial<SoundType> = {}): SoundType => ({
  id,
  url: `file:///${id}.ogg`,
  title: `Sound ${id}`,
  loop: false,
  volume: 0.7,
  fadeIn: 0,
  fadeOut: 0,
  ...overrides,
});

function setup() {
  const store: PlayerStore = createPlayerStore();
  const onError = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(() => useSoundboardPlayback(onError), { wrapper });
  const playback = () => store.getState().soundboardPlayback.playback;
  return { store, onError, hook, playback };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeHowl.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSoundboardPlayback", () => {
  it("play creates a Sound from the soundboard settings and records it on load", () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a", { loop: true })));

    expect(FakeHowl.latest.options).toMatchObject({ src: "file:///a.ogg", volume: 0.7, loop: true, autoplay: true });
    expect(h.playback()).toEqual({});

    act(() => FakeHowl.latest.load(12.9));

    expect(h.playback().a).toEqual({ ...sound("a", { loop: true }), progress: 0, duration: 12 });
  });

  it("playing a sound that is already playing replaces it at once", () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a")));
    const first = FakeHowl.latest;
    act(() => first.load());

    act(() => h.hook.result.current.play(sound("a")));

    expect(first.unloaded).toBe(true);
    expect(FakeHowl.instances).toHaveLength(2);
  });

  it("several sounds play together", () => {
    const h = setup();
    act(() => {
      h.hook.result.current.play(sound("a"));
      FakeHowl.latest.load();
      h.hook.result.current.play(sound("b"));
      FakeHowl.latest.load();
    });

    expect(Object.keys(h.playback()).sort()).toEqual(["a", "b"]);
    expect(FakeHowl.alive).toHaveLength(2);
  });

  it("when a non-looping sound ends it is removed and unloaded", () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a")));
    const howl = FakeHowl.latest;
    act(() => {
      howl.load();
      howl.startPlaying();
    });

    act(() => howl.end());

    expect(h.playback().a).toBeUndefined();
    expect(howl.unloaded).toBe(true);
    const syncedIds: string[] = [];
    h.hook.result.current.sync((id) => syncedIds.push(id));
    expect(syncedIds).toEqual([]);
  });

  it("a looping sound keeps playing when its file ends", () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a", { loop: true })));
    const howl = FakeHowl.latest;
    act(() => {
      howl.load();
      howl.startPlaying();
      howl.end();
    });

    expect(h.playback().a).toBeDefined();
    expect(howl.unloaded).toBe(false);
  });

  it("stop removes the sound from the store at once and unloads it after its fade-out", async () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a", { fadeOut: 400 })));
    const howl = FakeHowl.latest;
    act(() => {
      howl.load();
      howl.startPlaying();
    });

    let stopped!: Promise<void>;
    act(() => {
      stopped = h.hook.result.current.stop("a");
    });
    expect(h.playback().a).toBeUndefined();
    expect(howl.lastCallOf("fade")).toEqual([0.7, 0, 400]);
    expect(howl.unloaded).toBe(false);

    await act(async () => {
      howl.finishFade();
      await stopped;
    });
    expect(howl.unloaded).toBe(true);
  });

  it("stop of an unknown sound only updates the store", async () => {
    const h = setup();
    await act(async () => {
      await h.hook.result.current.stop("missing");
    });
    expect(FakeHowl.instances).toHaveLength(0);
  });

  it("seek updates the store and the sound", () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a")));
    const howl = FakeHowl.latest;
    act(() => howl.load());

    act(() => h.hook.result.current.seek("a", 4));

    expect(h.playback().a.progress).toBe(4);
    expect(howl.callsOf("seek")).toEqual([[4]]);
  });

  it("seek of an unknown sound does nothing to audio", () => {
    const h = setup();
    expect(() => act(() => h.hook.result.current.seek("missing", 4))).not.toThrow();
  });

  it("an error removes the sound and reports its title", async () => {
    const h = setup();
    act(() => h.hook.result.current.play(sound("a")));
    act(() => FakeHowl.latest.load());

    act(() => FakeHowl.latest.emit("loaderror", 1, "bad"));

    expect(h.onError).toHaveBeenCalledWith("Unable to play sound: Sound a");
    expect(h.playback().a).toBeUndefined();
  });

  it("a sound that cannot be created reports its title", async () => {
    const h = setup();
    FakeHowl.nextThrows = true;
    act(() => h.hook.result.current.play(sound("a")));
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.onError).toHaveBeenCalledWith("Unable to play sound: Sound a");
  });

  it("sync visits every live sound", () => {
    const h = setup();
    act(() => {
      h.hook.result.current.play(sound("a"));
      h.hook.result.current.play(sound("b"));
    });
    const visited: Record<string, number> = {};
    h.hook.result.current.sync((id, playing) => {
      visited[id] = playing.options.volume;
    });

    expect(visited).toEqual({ a: 0.7, b: 0.7 });
  });

  it("reports the progress of playing sounds at most once a second", () => {
    const h = setup();
    act(() => {
      h.hook.result.current.play(sound("a"));
      FakeHowl.latest.load();
      FakeHowl.latest.startPlaying();
      h.hook.result.current.play(sound("b"));
      FakeHowl.latest.load();
    });
    FakeHowl.instances[0].setPosition(3.5);

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(h.playback().a.progress).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Not rounded down, unlike playlist progress.
    expect(h.playback().a.progress).toBe(3.5);
    expect(h.playback().b.progress).toBe(0);
  });
});
