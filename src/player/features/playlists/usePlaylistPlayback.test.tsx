import React from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeHowl } from "../../test/fakeHowler";
import { createPlayerStore, PlayerStore } from "../../test/createPlayerStore";
import { addPlaylist, addTracks, removePlaylist, removeTrack, Track } from "./playlistsSlice";
import {
  adjustVolume,
  mute,
  removeTrackFromQueue,
  Repeat,
  repeat as setRepeat,
  shuffle as setShuffle,
  startQueue,
} from "./playlistPlaybackSlice";
import { usePlaylistPlayback } from "./usePlaylistPlayback";

/**
 * Characterisation tests for playlist playback (WP0 S3). They pin the current
 * behaviour of next(), previous() and the track-end handler, which are three
 * near-copies of the same navigation logic, so WP4 can merge them safely.
 *
 * Shuffle is replaced by "reverse", so startQueue at "b" with shuffle on gives
 * the play order b, d, c, a.
 */
vi.mock("howler", () => import("../../test/fakeHowler"));
vi.mock("../../common/shuffle", () => ({
  shuffleArray: (array: unknown[]) => {
    array.reverse();
  },
}));

const TRACK_IDS = ["a", "b", "c", "d"];
const track = (id: string): Track => ({ id, url: `file:///${id}.mp3`, title: `Track ${id}` });
const urlOf = (id: string) => `file:///${id}.mp3`;

type Harness = {
  store: PlayerStore;
  onError: ReturnType<typeof vi.fn>;
  hook: ReturnType<typeof renderHook<ReturnType<typeof usePlaylistPlayback>, unknown>>;
};

function setup(options: { repeat?: Repeat; shuffle?: boolean; trackIds?: string[] } = {}): Harness {
  const store = createPlayerStore();
  const trackIds = options.trackIds ?? TRACK_IDS;
  store.dispatch(addPlaylist({ id: "p", title: "P", background: "", tracks: [] }));
  store.dispatch(addTracks({ playlistId: "p", tracks: trackIds.map(track) }));
  store.dispatch(setRepeat(options.repeat ?? "playlist"));
  store.dispatch(setShuffle(options.shuffle ?? false));
  const onError = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(() => usePlaylistPlayback(onError), { wrapper });
  return { store, onError, hook };
}

/** Start the queue at `id` the way the Playlist screen does, and let the file load. */
function startAt(h: Harness, id: string) {
  act(() => {
    h.store.dispatch(startQueue({ tracks: [...h.store.getState().playlists.playlists.byId.p.tracks], trackId: id, playlistId: "p" }));
    h.hook.result.current.play(track(id));
  });
  loadLatest();
}

function loadLatest(durationSeconds = 100) {
  act(() => {
    FakeHowl.latest.load(durationSeconds);
  });
}

/** Move forward `steps` times with repeat "playlist", loading each new track. */
function advance(h: Harness, steps: number) {
  const saved = h.store.getState().playlistPlayback.repeat;
  act(() => {
    h.store.dispatch(setRepeat("playlist"));
  });
  for (let i = 0; i < steps; i++) {
    act(() => h.hook.result.current.next());
    loadLatest();
  }
  act(() => {
    h.store.dispatch(setRepeat(saved));
  });
}

const playback = (h: Harness) => h.store.getState().playlistPlayback;

beforeEach(() => {
  vi.useFakeTimers();
  FakeHowl.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

type Action = "next" | "previous" | "end";
type Outcome = { plays: string; index: number } | "restart" | "stop";
type Row = {
  action: Action;
  shuffle: boolean;
  repeat: Repeat;
  start: string;
  steps: number;
  expected: Outcome;
};

/**
 * Navigation table. `start`/`steps`: the queue is started at `start` and moved
 * forward `steps` times. Shuffled play order from "b" is b, d, c, a.
 * `index` is the expected queue.current afterwards.
 */
const rows: Row[] = [
  // next / end, not shuffled, middle of the playlist
  ...(["next", "end"] as Action[]).flatMap((action): Row[] => [
    { action, shuffle: false, repeat: "off", start: "b", steps: 0, expected: { plays: "c", index: 2 } },
    { action, shuffle: false, repeat: "track", start: "b", steps: 0, expected: "restart" },
    { action, shuffle: false, repeat: "playlist", start: "b", steps: 0, expected: { plays: "c", index: 2 } },
    // last track
    { action, shuffle: false, repeat: "off", start: "d", steps: 0, expected: "stop" },
    { action, shuffle: false, repeat: "track", start: "d", steps: 0, expected: "restart" },
    { action, shuffle: false, repeat: "playlist", start: "d", steps: 0, expected: { plays: "a", index: 0 } },
    // shuffled, first in play order
    { action, shuffle: true, repeat: "off", start: "b", steps: 0, expected: { plays: "d", index: 1 } },
    { action, shuffle: true, repeat: "track", start: "b", steps: 0, expected: "restart" },
    { action, shuffle: true, repeat: "playlist", start: "b", steps: 0, expected: { plays: "d", index: 1 } },
    // shuffled, last in play order ("a")
    { action, shuffle: true, repeat: "off", start: "b", steps: 3, expected: "stop" },
    { action, shuffle: true, repeat: "track", start: "b", steps: 3, expected: "restart" },
    { action, shuffle: true, repeat: "playlist", start: "b", steps: 3, expected: { plays: "b", index: 0 } },
  ]),
  // previous (position under 5 s), not shuffled
  { action: "previous", shuffle: false, repeat: "off", start: "b", steps: 0, expected: { plays: "a", index: 0 } },
  { action: "previous", shuffle: false, repeat: "track", start: "b", steps: 0, expected: "restart" },
  { action: "previous", shuffle: false, repeat: "playlist", start: "b", steps: 0, expected: { plays: "a", index: 0 } },
  // first track
  { action: "previous", shuffle: false, repeat: "off", start: "a", steps: 0, expected: "stop" },
  { action: "previous", shuffle: false, repeat: "track", start: "a", steps: 0, expected: "restart" },
  { action: "previous", shuffle: false, repeat: "playlist", start: "a", steps: 0, expected: { plays: "d", index: 3 } },
  // shuffled, first in play order
  { action: "previous", shuffle: true, repeat: "off", start: "b", steps: 0, expected: "stop" },
  { action: "previous", shuffle: true, repeat: "track", start: "b", steps: 0, expected: "restart" },
  { action: "previous", shuffle: true, repeat: "playlist", start: "b", steps: 0, expected: { plays: "a", index: 3 } },
  // shuffled, second in play order ("d")
  { action: "previous", shuffle: true, repeat: "off", start: "b", steps: 1, expected: { plays: "b", index: 0 } },
  { action: "previous", shuffle: true, repeat: "playlist", start: "b", steps: 1, expected: { plays: "b", index: 0 } },
];

describe("usePlaylistPlayback navigation", () => {
  it.each(rows)(
    "$action shuffle=$shuffle repeat=$repeat from $start+$steps -> $expected",
    ({ action, shuffle, repeat, start, steps, expected }) => {
      const h = setup({ shuffle });
      startAt(h, start);
      advance(h, steps);
      act(() => {
        h.store.dispatch(setRepeat(repeat));
      });
      const current = FakeHowl.latest;
      const countBefore = FakeHowl.instances.length;
      current.setPosition(2);
      const indexBefore = playback(h).queue!.current;

      act(() => {
        if (action === "end") {
          current.end();
        } else {
          h.hook.result.current[action]();
        }
      });

      if (expected === "restart") {
        expect(FakeHowl.instances).toHaveLength(countBefore);
        expect(current.callsOf("seek")).toEqual([[0]]);
        // Only the end handler resumes the stopped Howl itself.
        expect(current.callsOf("play")).toEqual(action === "end" ? [[]] : []);
        expect(playback(h).queue!.current).toBe(indexBefore);
        expect(playback(h).playback!.progress).toBe(0);
      } else if (expected === "stop") {
        expect(FakeHowl.instances).toHaveLength(countBefore);
        expect(current.callsOf("stop")).toEqual([[]]);
        expect(playback(h).playing).toBe(false);
        expect(playback(h).playback!.progress).toBe(0);
        // The track and queue are kept, so play can resume from the start.
        expect(playback(h).track!.id).toBe(start === "b" && steps === 3 ? "a" : start);
        expect(playback(h).queue!.current).toBe(indexBefore);
      } else {
        expect(FakeHowl.instances).toHaveLength(countBefore + 1);
        expect(FakeHowl.latest.options.src).toBe(urlOf(expected.plays));
        expect(playback(h).queue!.current).toBe(expected.index);
        loadLatest();
        expect(playback(h).track!.id).toBe(expected.plays);
      }
    },
  );

  it.each(["next", "end"] as const)("%s on a one-track playlist with repeat playlist restarts it", (action) => {
    const h = setup({ trackIds: ["only"] });
    startAt(h, "only");
    const howl = FakeHowl.latest;

    act(() => {
      if (action === "end") {
        howl.end();
      } else {
        h.hook.result.current.next();
      }
    });

    expect(FakeHowl.instances).toHaveLength(1);
    expect(howl.callsOf("seek")).toEqual([[0]]);
    expect(howl.callsOf("play")).toEqual(action === "end" ? [[]] : []);
  });

  it.each([
    [4.9, "plays the previous track"],
    [5, "restarts"],
    [30, "restarts"],
  ])("previous at %s s %s", (position, outcome) => {
    const h = setup();
    startAt(h, "b");
    const howl = FakeHowl.latest;
    howl.setPosition(position);

    act(() => h.hook.result.current.previous());

    if (outcome === "restarts") {
      expect(FakeHowl.instances).toHaveLength(1);
      expect(howl.callsOf("seek")).toEqual([[0]]);
      expect(playback(h).queue!.current).toBe(1);
    } else {
      expect(FakeHowl.latest.options.src).toBe(urlOf("a"));
    }
  });

  it("previous more than 5 s into the first track restarts it even with repeat off", () => {
    const h = setup({ repeat: "off" });
    startAt(h, "a");
    const howl = FakeHowl.latest;
    howl.setPosition(10);

    act(() => h.hook.result.current.previous());

    expect(howl.callsOf("seek")).toEqual([[0]]);
    expect(howl.callsOf("stop")).toEqual([]);
  });

  it.each(["next", "previous"] as const)("%s does nothing before any track was played", (action) => {
    const h = setup();
    act(() => h.hook.result.current[action]());

    expect(FakeHowl.instances).toHaveLength(0);
    expect(playback(h).playing).toBe(false);
  });

  it.each(["next", "previous", "end"] as const)("%s without a queue stops the track", (action) => {
    const h = setup();
    act(() => h.hook.result.current.play(track("a")));
    loadLatest();
    const howl = FakeHowl.latest;

    act(() => {
      if (action === "end") {
        howl.end();
      } else {
        h.hook.result.current[action]();
      }
    });

    expect(howl.callsOf("stop")).toEqual([[]]);
    expect(playback(h).playing).toBe(false);
    expect(FakeHowl.instances).toHaveLength(1);
  });

  it.each(["next", "end"] as const)("%s skips nothing when the next track was deleted from the library", (action) => {
    const h = setup();
    startAt(h, "b");
    const howl = FakeHowl.latest;
    // Remove "c" from the library but not from the queue.
    act(() => {
      h.store.dispatch({ type: "playlists/removeTrack", payload: { playlistId: "p", trackId: "c" } });
    });

    act(() => {
      if (action === "end") {
        howl.end();
      } else {
        h.hook.result.current.next();
      }
    });

    expect(FakeHowl.instances).toHaveLength(1);
    expect(playback(h).queue!.current).toBe(1);
  });
});

describe("usePlaylistPlayback track changes", () => {
  it("creates an HTML5 Howl at volume 0 with the current mute state and does not start it", () => {
    const h = setup();
    act(() => {
      h.store.dispatch(mute(true));
    });
    act(() => h.hook.result.current.play(track("a")));

    expect(FakeHowl.latest.options).toEqual({ src: urlOf("a"), html5: true, mute: true, volume: 0 });
    // Playback starts when PlaylistPlaybackSync sees `playing` and calls pauseResume(true).
    expect(FakeHowl.latest.callsOf("play")).toEqual([]);
  });

  it("on load records the track and whole-second duration, then fades in over 1000 ms to the store volume", () => {
    const h = setup();
    act(() => {
      h.store.dispatch(adjustVolume(0.6));
    });
    act(() => h.hook.result.current.play(track("a")));
    loadLatest(125.9);

    expect(playback(h)).toMatchObject({ track: track("a"), playing: true, playback: { progress: 0, duration: 125 } });
    expect(FakeHowl.latest.callsOf("fade")).toEqual([[0, 0.6, 1000]]);
  });

  it("cross-fades over a fixed 1000 ms and unloads the old track when its fade ends", () => {
    const h = setup();
    startAt(h, "a");
    const first = FakeHowl.latest;
    act(() => first.finishFade());

    act(() => h.hook.result.current.next());
    const second = FakeHowl.latest;
    // Nothing happens to the old track until the new one has loaded.
    expect(first.callsOf("fade")).toHaveLength(1);
    loadLatest();

    expect(first.lastCallOf("fade")).toEqual([1, 0, 1000]);
    expect(second.callsOf("fade")).toEqual([[0, 1, 1000]]);
    expect(first.unloaded).toBe(false);
    act(() => first.finishFade());
    expect(first.unloaded).toBe(true);
    expect(second.unloaded).toBe(false);
  });

  it("the track-end handler follows the new track after a change", () => {
    const h = setup({ repeat: "off" });
    startAt(h, "a");
    const first = FakeHowl.latest;
    act(() => h.hook.result.current.next());
    loadLatest();
    const second = FakeHowl.latest;

    expect(first.listenerCount("end")).toBe(0);
    expect(second.listenerCount("end")).toBe(1);
  });

  it("updates progress at most once a second while playing", () => {
    const h = setup();
    startAt(h, "a");
    const howl = FakeHowl.latest;
    howl.isPlaying = true;
    howl.setPosition(7.8);

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(playback(h).playback!.progress).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(playback(h).playback!.progress).toBe(7);
  });
});

describe("usePlaylistPlayback errors", () => {
  it.each(["loaderror", "playerror"])("%s stops playback and reports the track title", (event) => {
    const h = setup();
    act(() => h.hook.result.current.play(track("b")));

    act(() => FakeHowl.latest.emit(event, 1, "decode failed"));

    expect(h.onError).toHaveBeenCalledWith("Unable to play track: Track b");
    expect(playback(h).track).toBeUndefined();
    expect(playback(h).playing).toBe(false);
  });

  it("an error unloads the previous track at once and leaves nothing to navigate", () => {
    const h = setup();
    startAt(h, "a");
    const first = FakeHowl.latest;
    act(() => h.hook.result.current.next());

    act(() => FakeHowl.latest.emit("loaderror", 1, "x"));

    expect(first.unloaded).toBe(true);
    expect(h.onError).toHaveBeenCalledWith("Unable to play track: Track b");
    const count = FakeHowl.instances.length;
    act(() => h.hook.result.current.next());
    expect(FakeHowl.instances).toHaveLength(count);
  });

  it("a Howl without a sound is reported at once", () => {
    const h = setup();
    FakeHowl.nextHasNoSound = true;
    act(() => h.hook.result.current.play(track("c")));

    expect(h.onError).toHaveBeenCalledWith("Unable to play track: Track c");
  });

  it("a Howl constructor failure is reported and unloads the previous track", () => {
    const h = setup();
    startAt(h, "a");
    const first = FakeHowl.latest;
    FakeHowl.nextThrows = true;

    act(() => h.hook.result.current.play(track("d")));

    expect(h.onError).toHaveBeenCalledWith("Unable to play track: Track d");
    expect(first.unloaded).toBe(true);
  });
});

describe("usePlaylistPlayback transport controls", () => {
  it("seek updates the store and the Howl", () => {
    const h = setup();
    startAt(h, "a");
    act(() => h.hook.result.current.seek(42));

    expect(FakeHowl.latest.callsOf("seek")).toEqual([[42]]);
    expect(playback(h).playback!.progress).toBe(42);
  });

  it("stop pauses, rewinds the progress and stops the Howl", () => {
    const h = setup();
    startAt(h, "a");
    act(() => h.hook.result.current.stop());

    expect(playback(h).playing).toBe(false);
    expect(playback(h).playback!.progress).toBe(0);
    expect(FakeHowl.latest.callsOf("stop")).toEqual([[]]);
  });

  it("pauseResume, mute and volume pass through to the Howl", () => {
    const h = setup();
    startAt(h, "a");
    const howl = FakeHowl.latest;
    act(() => {
      h.hook.result.current.pauseResume(true);
      h.hook.result.current.pauseResume(false);
      h.hook.result.current.mute(true);
      h.hook.result.current.volume(0.4);
    });

    expect(howl.callsOf("play")).toEqual([[]]);
    expect(howl.callsOf("pause")).toEqual([[]]);
    expect(howl.callsOf("mute")).toEqual([[true]]);
    expect(howl.callsOf("volume")).toEqual([[0.4]]);
  });

  it("controls without a track do nothing", () => {
    const h = setup();
    expect(() =>
      act(() => {
        h.hook.result.current.pauseResume(true);
        h.hook.result.current.mute(true);
        h.hook.result.current.volume(0.4);
        h.hook.result.current.seek(3);
        h.hook.result.current.stop();
      }),
    ).not.toThrow();
  });
});

describe("deleting the playing track (BUG-8)", () => {
  /** Delete a track the way the track's Delete menu item does. */
  function deleteTrack(h: Harness, id: string) {
    act(() => {
      h.store.dispatch(removeTrack({ playlistId: "p", trackId: id }));
      h.store.dispatch(removeTrackFromQueue({ playlistId: "p", trackId: id }));
    });
  }

  it("stops and unloads the track and clears it from the player bar", () => {
    const h = setup();
    startAt(h, "b");
    const howl = FakeHowl.latest;

    deleteTrack(h, "b");

    expect(howl.unloaded).toBe(true);
    expect(playback(h).track).toBeUndefined();
    expect(playback(h).playback).toBeUndefined();
    expect(playback(h).playing).toBe(false);
  });

  it("nothing can bring the deleted track back afterwards (play key, next, previous)", () => {
    const h = setup();
    startAt(h, "b");
    const howl = FakeHowl.latest;
    deleteTrack(h, "b");

    act(() => {
      h.hook.result.current.pauseResume(true);
      h.hook.result.current.next();
      h.hook.result.current.previous();
    });

    expect(howl.callsOf("play")).toEqual([]);
    expect(FakeHowl.instances).toHaveLength(1);
  });

  it("deleting the playlist that is playing stops its track too", () => {
    const h = setup();
    startAt(h, "c");
    const howl = FakeHowl.latest;

    act(() => {
      h.store.dispatch(removePlaylist("p"));
    });

    expect(howl.unloaded).toBe(true);
    expect(playback(h).track).toBeUndefined();
  });

  it("deleting the playing track while the next one loads stops the deleted one and lets the next play", () => {
    const h = setup();
    startAt(h, "a");
    const deleted = FakeHowl.latest;
    act(() => h.hook.result.current.next());
    const following = FakeHowl.latest;

    deleteTrack(h, "a");
    expect(deleted.unloaded).toBe(true);
    expect(following.unloaded).toBe(false);

    loadLatest();
    expect(playback(h).track?.id).toBe("b");
    expect(following.lastFade).toEqual({ from: 0, to: 1, duration: 1000 });
  });

  it("a track deleted before it finished loading never reaches the player bar", () => {
    const h = setup();
    act(() => h.hook.result.current.play(track("d")));
    const howl = FakeHowl.latest;
    act(() => {
      h.store.dispatch(removeTrack({ playlistId: "p", trackId: "d" }));
    });

    loadLatest();

    expect(howl.unloaded).toBe(true);
    expect(playback(h).track).toBeUndefined();
  });

  it("deleting another track leaves the playing track alone", () => {
    const h = setup();
    startAt(h, "b");
    const howl = FakeHowl.latest;

    deleteTrack(h, "d");

    expect(howl.unloaded).toBe(false);
    expect(playback(h).track?.id).toBe("b");
  });
});
