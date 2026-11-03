import { describe, expect, it } from "vitest";

import reducer, {
  addSound,
  addSoundboard,
  addSounds,
  editSound,
  editSoundboard,
  moveSound,
  moveSoundboard,
  removeSound,
  removeSoundboard,
  Sound,
  SoundboardsState,
} from "./soundboardsSlice";

/** Characterisation tests for the soundboards library reducer (WP0 S3). */

const sound = (id: string): Sound => ({
  id,
  url: `file:///${id}.ogg`,
  title: `Sound ${id}`,
  loop: false,
  volume: 1,
  fadeIn: 100,
  fadeOut: 100,
});

function stateWith(boards: Record<string, string[]>): SoundboardsState {
  let state = reducer(undefined, { type: "init" });
  for (const [id, soundIds] of Object.entries(boards)) {
    state = reducer(state, addSoundboard({ id, title: id, background: "bg", sounds: [] }));
    state = reducer(state, addSounds({ soundboardId: id, sounds: soundIds.map(sound) }));
  }
  return state;
}

describe("soundboardsSlice", () => {
  it("starts empty", () => {
    expect(reducer(undefined, { type: "init" })).toEqual({
      soundboards: { byId: {}, allIds: [] },
      sounds: {},
    });
  });

  it("addSoundboard stores the board and appends its id", () => {
    const state = reducer(
      stateWith({ a: [] }),
      addSoundboard({ id: "b", title: "B", background: "x", sounds: [] }),
    );

    expect(state.soundboards.allIds).toEqual(["a", "b"]);
    expect(state.soundboards.byId.b.title).toBe("B");
  });

  it("removeSoundboard deletes the board and its sounds", () => {
    const state = reducer(stateWith({ a: ["1", "2"], b: ["3"] }), removeSoundboard("a"));

    expect(state.soundboards.allIds).toEqual(["b"]);
    expect(state.soundboards.byId.a).toBeUndefined();
    expect(Object.keys(state.sounds)).toEqual(["3"]);
  });

  it("editSoundboard merges fields and throws without an id", () => {
    const state = reducer(stateWith({ a: ["1"] }), editSoundboard({ id: "a", background: "new" }));
    expect(state.soundboards.byId.a).toEqual({ id: "a", title: "a", background: "new", sounds: ["1"] });

    expect(() => reducer(state, editSoundboard({ title: "x" }))).toThrow(
      "Id needed in editSoundboard payload",
    );
  });

  it("addSound puts the sound first", () => {
    const state = reducer(stateWith({ a: ["1"] }), addSound({ soundboardId: "a", sound: sound("2") }));

    expect(state.soundboards.byId.a.sounds).toEqual(["2", "1"]);
    expect(state.sounds["2"]).toEqual(sound("2"));
  });

  it("addSounds puts the sounds first, keeping their order", () => {
    const state = reducer(
      stateWith({ a: ["1"] }),
      addSounds({ soundboardId: "a", sounds: [sound("2"), sound("3")] }),
    );

    expect(state.soundboards.byId.a.sounds).toEqual(["2", "3", "1"]);
  });

  it("removeSound removes the sound from its board and the library", () => {
    const state = reducer(stateWith({ a: ["1", "2"] }), removeSound({ soundboardId: "a", soundId: "1" }));

    expect(state.soundboards.byId.a.sounds).toEqual(["2"]);
    expect(state.sounds["1"]).toBeUndefined();
  });

  it("editSound merges fields and throws without an id", () => {
    const state = reducer(stateWith({ a: ["1"] }), editSound({ id: "1", loop: true, fadeOut: 0 }));
    expect(state.sounds["1"]).toEqual({ ...sound("1"), loop: true, fadeOut: 0 });

    expect(() => reducer(state, editSound({ volume: 0.5 }))).toThrow("Id needed in editSound payload");
  });

  it("moveSoundboard moves `active` to the position of `over`", () => {
    const state = reducer(stateWith({ a: [], b: [], c: [] }), moveSoundboard({ active: "c", over: "a" }));

    expect(state.soundboards.allIds).toEqual(["c", "a", "b"]);
  });

  it("moveSound moves `active` to the position of `over`", () => {
    const state = reducer(
      stateWith({ a: ["1", "2", "3"] }),
      moveSound({ soundboardId: "a", active: "1", over: "3" }),
    );

    expect(state.soundboards.byId.a.sounds).toEqual(["2", "3", "1"]);
  });
});
