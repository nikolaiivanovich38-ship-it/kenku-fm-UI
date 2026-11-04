/**
 * PERF-1: the player page must not wake up dozens of times a second when
 * nothing plays. Both playback hooks are mounted together, as in App.tsx, and
 * every timer and animation-frame callback is counted over one minute of fake
 * time.
 *
 * Measured before the fix (Kenku FM's per-frame loops; fake timers run 62.5
 * frames a second): nothing played since start-up 3,750 wake-ups a minute
 * (the soundboard loop ran from start-up); a paused or ended track 7,500 (both
 * loops); an ended sound 3,750; a playing track 7,500; after the player
 * closed 3,750 (the playlist loop was never cancelled). After the fix: 0 when
 * idle (at most 1 straggler tick), 60 a minute while a track plays.
 */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeHowl } from "../test/fakeHowler";
import { countWakeUps } from "../test/countWakeUps";
import { createPlayerStore } from "../test/createPlayerStore";
import { addPlaylist, addTracks, Track } from "./playlists/playlistsSlice";
import { repeat as setRepeat, startQueue } from "./playlists/playlistPlaybackSlice";
import { usePlaylistPlayback } from "./playlists/usePlaylistPlayback";
import { useSoundboardPlayback } from "./soundboards/useSoundboardPlayback";

vi.mock("howler", () => import("../test/fakeHowler"));

const ONE_MINUTE = 60_000;
const track = (id: string): Track => ({ id, url: `file:///${id}.mp3`, title: `Track ${id}` });

function setup() {
  const store = createPlayerStore();
  store.dispatch(addPlaylist({ id: "p", title: "P", background: "", tracks: [] }));
  store.dispatch(addTracks({ playlistId: "p", tracks: [track("a")] }));
  const wakeUps = countWakeUps();
  const onError = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    () => ({ playlist: usePlaylistPlayback(onError), soundboard: useSoundboardPlayback(onError) }),
    { wrapper },
  );
  return { store, wakeUps, hook };
}

/** Start track "a" and let it load and begin playing, as Howler would. */
function playTrack(h: ReturnType<typeof setup>) {
  act(() => {
    h.store.dispatch(startQueue({ tracks: ["a"], trackId: "a", playlistId: "p" }));
    h.hook.result.current.playlist.play(track("a"));
  });
  act(() => {
    FakeHowl.latest.load(600);
    FakeHowl.latest.play();
    FakeHowl.latest.startPlaying();
  });
}

function waitOneMinute() {
  act(() => {
    vi.advanceTimersByTime(ONE_MINUTE);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeHowl.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("idle player wake-ups (PERF-1)", () => {
  it("nothing played since start-up: no wake-ups", () => {
    const h = setup();
    h.wakeUps.reset();
    waitOneMinute();
    expect(h.wakeUps.total(), JSON.stringify(h.wakeUps.counts)).toBe(0);
  });

  it("a paused track: at most one wake-up, then none", () => {
    const h = setup();
    playTrack(h);
    act(() => h.hook.result.current.playlist.pauseResume(false));
    h.wakeUps.reset();
    waitOneMinute();
    expect(h.wakeUps.total(), JSON.stringify(h.wakeUps.counts)).toBeLessThanOrEqual(1);
  });

  it("Howler's pause event stops the progress updates at once", () => {
    const h = setup();
    playTrack(h);
    act(() => {
      h.hook.result.current.playlist.pauseResume(false);
      FakeHowl.latest.emit("pause", 1);
    });
    h.wakeUps.reset();
    waitOneMinute();
    expect(h.wakeUps.total(), JSON.stringify(h.wakeUps.counts)).toBe(0);
  });

  it("a track that ended with repeat off: at most one wake-up, then none", () => {
    const h = setup();
    act(() => {
      h.store.dispatch(setRepeat("off"));
    });
    playTrack(h);
    act(() => FakeHowl.latest.end());
    h.wakeUps.reset();
    waitOneMinute();
    expect(h.wakeUps.total(), JSON.stringify(h.wakeUps.counts)).toBeLessThanOrEqual(1);
  });

  it("a sound that has ended: no wake-ups", () => {
    const h = setup();
    act(() => {
      h.hook.result.current.soundboard.play({
        id: "s",
        url: "file:///s.ogg",
        title: "Sound s",
        loop: false,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      });
    });
    act(() => {
      FakeHowl.latest.load(2);
      FakeHowl.latest.startPlaying();
    });
    act(() => FakeHowl.latest.end());
    h.wakeUps.reset();
    waitOneMinute();
    expect(h.wakeUps.total(), JSON.stringify(h.wakeUps.counts)).toBe(0);
  });

  it("a playing track: progress moves on about once a second, with no per-frame loop", () => {
    const h = setup();
    playTrack(h);
    h.wakeUps.reset();
    for (let second = 1; second <= 60; second++) {
      FakeHowl.latest.setPosition(second);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(h.store.getState().playlistPlayback.playback?.progress).toBe(60);
    expect(h.wakeUps.counts.animationFrame).toBe(0);
    // "A few times a second" at most: 60 to 240 in a minute.
    expect(h.wakeUps.total()).toBeGreaterThanOrEqual(59);
    expect(h.wakeUps.total()).toBeLessThanOrEqual(240);
  });

  it("closing the player stops every loop", () => {
    const h = setup();
    playTrack(h);
    h.hook.unmount();
    h.wakeUps.reset();
    waitOneMinute();
    expect(h.wakeUps.total(), JSON.stringify(h.wakeUps.counts)).toBe(0);
  });
});
