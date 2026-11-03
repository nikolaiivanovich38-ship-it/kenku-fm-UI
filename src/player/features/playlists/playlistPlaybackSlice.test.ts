import { describe, expect, it, vi } from "vitest";

import reducer, {
  addTrackToQueueIfNeeded,
  addTracksToQueueIfNeeded,
  adjustVolume,
  moveQueueIfNeeded,
  mute,
  playPause,
  PlaylistPlaybackState,
  playTrack,
  Queue,
  removeTrackFromQueue,
  repeat,
  shuffle,
  startQueue,
  stopTrack,
  updatePlayback,
  updateQueue,
} from "./playlistPlaybackSlice";

/**
 * Characterisation tests for the playlist queue reducer (WP0 S3).
 * "Shuffling" is replaced by reversing the array, so every order below is exact.
 */
vi.mock("../../common/shuffle", () => ({
  shuffleArray: (array: unknown[]) => {
    array.reverse();
  },
}));

const TRACKS = ["a", "b", "c", "d"];
const initial = (): PlaylistPlaybackState => reducer(undefined, { type: "init" });

function withQueue(queue: Partial<Queue>, overrides: Partial<PlaylistPlaybackState> = {}): PlaylistPlaybackState {
  return {
    ...initial(),
    ...overrides,
    queue: { playlistId: "p", tracks: [...TRACKS], shuffled: [0, 1, 2, 3], current: 0, ...queue },
  };
}

/** Track id that is "current" in either mode. */
function currentTrack(state: PlaylistPlaybackState) {
  const queue = state.queue!;
  return state.shuffle ? queue.tracks[queue.shuffled[queue.current]] : queue.tracks[queue.current];
}

describe("playlistPlaybackSlice initial state", () => {
  it("is stopped, full volume, unmuted, unshuffled, repeating the playlist", () => {
    expect(initial()).toEqual({
      playing: false,
      volume: 1,
      muted: false,
      shuffle: false,
      repeat: "playlist",
    });
  });
});

describe("startQueue", () => {
  it("without shuffle: current is the chosen track's index; shuffled starts with it", () => {
    const state = reducer(initial(), startQueue({ tracks: TRACKS, trackId: "c", playlistId: "p" }));

    // [0,1,2,3] minus 2 -> [0,1,3] -> "shuffled" [3,1,0] -> chosen first.
    expect(state.queue).toEqual({ playlistId: "p", tracks: TRACKS, shuffled: [2, 3, 1, 0], current: 2 });
    expect(currentTrack(state)).toBe("c");
  });

  it("with shuffle: current is 0 and the chosen track is first in the shuffled order", () => {
    const state = reducer(
      { ...initial(), shuffle: true },
      startQueue({ tracks: TRACKS, trackId: "c", playlistId: "p" }),
    );

    expect(state.queue!.current).toBe(0);
    expect(state.queue!.shuffled).toEqual([2, 3, 1, 0]);
    expect(currentTrack(state)).toBe("c");
  });

  it("replaces an existing queue", () => {
    const state = reducer(withQueue({ playlistId: "old" }), startQueue({ tracks: ["x"], trackId: "x", playlistId: "new" }));

    expect(state.queue).toEqual({ playlistId: "new", tracks: ["x"], shuffled: [0], current: 0 });
  });

  it("characterisation: a track id not in the list gives current -1 and drops the last index from shuffled", () => {
    const state = reducer(initial(), startQueue({ tracks: TRACKS, trackId: "zz", playlistId: "p" }));

    expect(state.queue!.current).toBe(-1);
    expect(state.queue!.shuffled).toEqual([-1, 2, 1, 0]);
  });
});

describe("updateQueue", () => {
  it("sets the current index", () => {
    expect(reducer(withQueue({}), updateQueue(3)).queue!.current).toBe(3);
  });

  it("does nothing without a queue", () => {
    expect(reducer(initial(), updateQueue(3))).toEqual(initial());
  });
});

describe("shuffle", () => {
  it("turning on keeps the current track first and shuffles the rest", () => {
    const state = reducer(withQueue({ current: 2, shuffled: [2, 3, 1, 0] }), shuffle(true));

    expect(state.shuffle).toBe(true);
    // [3,1,0] reversed -> [0,1,3], current track index 2 put first.
    expect(state.queue!.shuffled).toEqual([2, 0, 1, 3]);
    expect(state.queue!.current).toBe(0);
    expect(currentTrack(state)).toBe("c");
  });

  it("turning off points current at the same track in playlist order", () => {
    const state = reducer(withQueue({ current: 1, shuffled: [2, 0, 1, 3] }, { shuffle: true }), shuffle(false));

    expect(state.shuffle).toBe(false);
    expect(state.queue!.current).toBe(0);
    expect(currentTrack(state)).toBe("a");
    expect(state.queue!.shuffled).toEqual([2, 0, 1, 3]);
  });

  it("turning on while already on reshuffles around the current track", () => {
    const state = reducer(withQueue({ current: 1, shuffled: [2, 0, 1, 3] }, { shuffle: true }), shuffle(true));

    expect(state.queue!.shuffled).toEqual([0, 3, 1, 2]);
    expect(state.queue!.current).toBe(0);
    expect(currentTrack(state)).toBe("a");
  });

  it("without a queue only changes the flag", () => {
    expect(reducer(initial(), shuffle(true))).toEqual({ ...initial(), shuffle: true });
  });
});

describe("moveQueueIfNeeded", () => {
  it("reorders the queue like the playlist and follows the current track", () => {
    const state = reducer(withQueue({ current: 2 }), moveQueueIfNeeded({ playlistId: "p", active: "a", over: "d" }));

    expect(state.queue!.tracks).toEqual(["b", "c", "d", "a"]);
    expect(state.queue!.current).toBe(1);
    expect(currentTrack(state)).toBe("c");
    // The shuffled indices are not remapped.
    expect(state.queue!.shuffled).toEqual([0, 1, 2, 3]);
  });

  it("does nothing while shuffled", () => {
    const before = withQueue({ current: 2 }, { shuffle: true });
    expect(reducer(before, moveQueueIfNeeded({ playlistId: "p", active: "a", over: "d" }))).toEqual(before);
  });

  it("does nothing for another playlist or without a queue", () => {
    const before = withQueue({ current: 2 });
    expect(reducer(before, moveQueueIfNeeded({ playlistId: "other", active: "a", over: "d" }))).toEqual(before);
    expect(reducer(initial(), moveQueueIfNeeded({ playlistId: "p", active: "a", over: "d" }))).toEqual(initial());
  });
});

describe("removeTrackFromQueue (shuffled)", () => {
  // Shuffled play order: c, a, b, d.
  const shuffled = (current: number) => withQueue({ current, shuffled: [2, 0, 1, 3] }, { shuffle: true });

  it("removing the current track makes the next one in play order current", () => {
    const state = reducer(shuffled(0), removeTrackFromQueue({ playlistId: "p", trackId: "c" }));

    expect(state.queue).toMatchObject({ tracks: ["a", "b", "d"], shuffled: [0, 1, 2], current: 0 });
    expect(currentTrack(state)).toBe("a");
  });

  it("removing a track played before the current one keeps the current track", () => {
    const state = reducer(shuffled(2), removeTrackFromQueue({ playlistId: "p", trackId: "a" }));

    expect(state.queue).toMatchObject({ tracks: ["b", "c", "d"], shuffled: [1, 0, 2], current: 1 });
    expect(currentTrack(state)).toBe("b");
  });

  it("removing a track played after the current one keeps the current track", () => {
    const state = reducer(shuffled(1), removeTrackFromQueue({ playlistId: "p", trackId: "d" }));

    expect(state.queue).toMatchObject({ tracks: ["a", "b", "c"], shuffled: [2, 0, 1], current: 1 });
    expect(currentTrack(state)).toBe("a");
  });

  it("characterisation: removing the current track when it is last in play order gives current -1", () => {
    const state = reducer(shuffled(3), removeTrackFromQueue({ playlistId: "p", trackId: "d" }));

    expect(state.queue!.current).toBe(-1);
  });
});

describe("removeTrackFromQueue (not shuffled)", () => {
  // The reducer always walks the shuffled order, even when shuffle is off.
  // This is only right when `shuffled` happens to be [0, 1, 2, ...].
  it("with shuffled in playlist order: removing the current track moves to the next", () => {
    const state = reducer(withQueue({ current: 1 }), removeTrackFromQueue({ playlistId: "p", trackId: "b" }));

    expect(state.queue).toMatchObject({ tracks: ["a", "c", "d"], current: 1 });
    expect(currentTrack(state)).toBe("c");
  });

  it("with shuffled in playlist order: removing an earlier track keeps the current track", () => {
    const state = reducer(withQueue({ current: 2 }), removeTrackFromQueue({ playlistId: "p", trackId: "a" }));

    expect(currentTrack(state)).toBe("c");
  });

  it("with shuffled in playlist order: removing a later track keeps the current track", () => {
    const state = reducer(withQueue({ current: 1 }), removeTrackFromQueue({ playlistId: "p", trackId: "d" }));

    expect(currentTrack(state)).toBe("b");
  });

  // QUEUE-1 (documented bug): startQueue always builds a shuffled order, so with
  // shuffle off the reducer reads `current` as a position in that order. Here
  // the current track "b" becomes "c" (current stays 1 in tracks [b, c, d]).
  it.fails("QUEUE-1: removing an earlier track keeps the current track when shuffled is not in playlist order", () => {
    const state = reducer(
      withQueue({ current: 1, shuffled: [1, 3, 2, 0] }),
      removeTrackFromQueue({ playlistId: "p", trackId: "a" }),
    );

    expect(currentTrack(state)).toBe("b");
  });

  it("does nothing for another playlist or without a queue", () => {
    const before = withQueue({ current: 1 });
    expect(reducer(before, removeTrackFromQueue({ playlistId: "other", trackId: "b" }))).toEqual(before);
    expect(reducer(initial(), removeTrackFromQueue({ playlistId: "p", trackId: "b" }))).toEqual(initial());
  });
});

describe("adding tracks to the queue", () => {
  it("addTrackToQueueIfNeeded puts the track first and shifts every index by one", () => {
    const state = reducer(
      withQueue({ tracks: ["a", "b", "c"], shuffled: [1, 2, 0], current: 1 }),
      addTrackToQueueIfNeeded({ playlistId: "p", trackId: "x" }),
    );

    expect(state.queue).toMatchObject({ tracks: ["x", "a", "b", "c"], shuffled: [0, 2, 3, 1], current: 2 });
  });

  it.each([false, true])("addTrackToQueueIfNeeded keeps the current track (shuffle=%s)", (isShuffled) => {
    const before = withQueue({ tracks: ["a", "b", "c"], shuffled: [1, 2, 0], current: 1 }, { shuffle: isShuffled });
    const state = reducer(before, addTrackToQueueIfNeeded({ playlistId: "p", trackId: "x" }));

    expect(currentTrack(state)).toBe(currentTrack(before));
  });

  it("addTracksToQueueIfNeeded puts the tracks first and shuffles only the new ones to the front of the play order", () => {
    const state = reducer(
      withQueue({ tracks: ["a", "b", "c"], shuffled: [1, 2, 0], current: 1 }),
      addTracksToQueueIfNeeded({ playlistId: "p", trackIds: ["x", "y"] }),
    );

    expect(state.queue).toMatchObject({
      tracks: ["x", "y", "a", "b", "c"],
      shuffled: [1, 0, 3, 4, 2],
      current: 3,
    });
  });

  it.each([false, true])("addTracksToQueueIfNeeded keeps the current track (shuffle=%s)", (isShuffled) => {
    const before = withQueue({ tracks: ["a", "b", "c"], shuffled: [1, 2, 0], current: 1 }, { shuffle: isShuffled });
    const state = reducer(before, addTracksToQueueIfNeeded({ playlistId: "p", trackIds: ["x", "y"] }));

    expect(currentTrack(state)).toBe(currentTrack(before));
  });

  it("both do nothing for another playlist or without a queue", () => {
    const before = withQueue({});
    expect(reducer(before, addTrackToQueueIfNeeded({ playlistId: "o", trackId: "x" }))).toEqual(before);
    expect(reducer(before, addTracksToQueueIfNeeded({ playlistId: "o", trackIds: ["x"] }))).toEqual(before);
    expect(reducer(initial(), addTrackToQueueIfNeeded({ playlistId: "p", trackId: "x" }))).toEqual(initial());
    expect(reducer(initial(), addTracksToQueueIfNeeded({ playlistId: "p", trackIds: ["x"] }))).toEqual(initial());
  });
});

describe("track and transport state", () => {
  const track = { id: "t", url: "file:///t.mp3", title: "T" };

  it("playTrack sets the track, playing, and a fresh playback", () => {
    const state = reducer(initial(), playTrack({ track, duration: 90 }));

    expect(state).toMatchObject({ track, playing: true, playback: { progress: 0, duration: 90 } });
  });

  it("stopTrack clears track and playback and stops", () => {
    let state = reducer(initial(), playTrack({ track, duration: 90 }));
    state = reducer(state, stopTrack());

    expect(state.track).toBeUndefined();
    expect(state.playback).toBeUndefined();
    expect(state.playing).toBe(false);
  });

  it("stopTrack keeps the queue", () => {
    expect(reducer(withQueue({ current: 2 }), stopTrack()).queue!.current).toBe(2);
  });

  it("playPause sets playing", () => {
    expect(reducer(initial(), playPause(true)).playing).toBe(true);
    expect(reducer({ ...initial(), playing: true }, playPause(false)).playing).toBe(false);
  });

  it("updatePlayback sets progress only when there is playback", () => {
    const playing = reducer(initial(), playTrack({ track, duration: 90 }));
    expect(reducer(playing, updatePlayback(12)).playback!.progress).toBe(12);
    expect(reducer(initial(), updatePlayback(12)).playback).toBeUndefined();
  });

  it("adjustVolume, mute and repeat set their values", () => {
    expect(reducer(initial(), adjustVolume(0.3)).volume).toBe(0.3);
    expect(reducer(initial(), mute(true)).muted).toBe(true);
    expect(reducer(initial(), repeat("track")).repeat).toBe("track");
    expect(reducer(initial(), repeat("off")).repeat).toBe("off");
  });
});
