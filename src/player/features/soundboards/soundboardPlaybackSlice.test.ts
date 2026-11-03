import { describe, expect, it } from "vitest";

import reducer, { playSound, stopSound, updatePlayback } from "./soundboardPlaybackSlice";
import { Sound } from "./soundboardsSlice";

/** Characterisation tests for the soundboard playback reducer (WP0 S3). */

const sound = (id: string): Sound => ({
  id,
  url: `file:///${id}.ogg`,
  title: id,
  loop: true,
  volume: 0.5,
  fadeIn: 0,
  fadeOut: 0,
});

describe("soundboardPlaybackSlice", () => {
  it("starts with nothing playing", () => {
    expect(reducer(undefined, { type: "init" })).toEqual({ playback: {} });
  });

  it("playSound copies the sound with progress 0 and the duration", () => {
    const state = reducer(undefined, playSound({ sound: sound("a"), duration: 12 }));

    expect(state.playback.a).toEqual({ ...sound("a"), progress: 0, duration: 12 });
  });

  it("playSound on a playing sound resets its progress", () => {
    let state = reducer(undefined, playSound({ sound: sound("a"), duration: 12 }));
    state = reducer(state, updatePlayback([{ id: "a", progress: 5 }]));
    state = reducer(state, playSound({ sound: sound("a"), duration: 12 }));

    expect(state.playback.a.progress).toBe(0);
  });

  it("stopSound removes only that sound and ignores unknown ids", () => {
    let state = reducer(undefined, playSound({ sound: sound("a"), duration: 1 }));
    state = reducer(state, playSound({ sound: sound("b"), duration: 1 }));
    state = reducer(state, stopSound("a"));
    state = reducer(state, stopSound("missing"));

    expect(Object.keys(state.playback)).toEqual(["b"]);
  });

  it("updatePlayback updates progress of playing sounds and ignores others", () => {
    let state = reducer(undefined, playSound({ sound: sound("a"), duration: 10 }));
    state = reducer(
      state,
      updatePlayback([
        { id: "a", progress: 3 },
        { id: "gone", progress: 4 },
      ]),
    );

    expect(state.playback.a.progress).toBe(3);
    expect(state.playback.gone).toBeUndefined();
  });
});
