import { describe, expect, it } from "vitest";

import reducer, {
  addPlaylist,
  addTrack,
  addTracks,
  editPlaylist,
  editTrack,
  movePlaylist,
  moveTrack,
  PlaylistsState,
  removePlaylist,
  removeTrack,
  Track,
} from "./playlistsSlice";

/** Characterisation tests for the playlists library reducer (WP0 S3). */

const track = (id: string): Track => ({ id, url: `file:///${id}.mp3`, title: `Track ${id}` });

function stateWith(playlists: Record<string, string[]>): PlaylistsState {
  let state = reducer(undefined, { type: "init" });
  for (const [id, trackIds] of Object.entries(playlists)) {
    state = reducer(state, addPlaylist({ id, title: id, background: "bg", tracks: [] }));
    state = reducer(
      state,
      addTracks({ playlistId: id, tracks: trackIds.map(track) }),
    );
  }
  return state;
}

describe("playlistsSlice", () => {
  it("starts empty", () => {
    expect(reducer(undefined, { type: "init" })).toEqual({
      playlists: { byId: {}, allIds: [] },
      tracks: {},
    });
  });

  it("addPlaylist stores the playlist and appends its id", () => {
    let state = stateWith({ a: [] });
    state = reducer(state, addPlaylist({ id: "b", title: "B", background: "x", tracks: [] }));

    expect(state.playlists.allIds).toEqual(["a", "b"]);
    expect(state.playlists.byId.b).toEqual({ id: "b", title: "B", background: "x", tracks: [] });
  });

  it("removePlaylist deletes the playlist and all its tracks", () => {
    const state = reducer(stateWith({ a: ["1", "2"], b: ["3"] }), removePlaylist("a"));

    expect(state.playlists.allIds).toEqual(["b"]);
    expect(state.playlists.byId.a).toBeUndefined();
    expect(Object.keys(state.tracks)).toEqual(["3"]);
  });

  it("removePlaylist throws for an unknown id", () => {
    expect(() => reducer(stateWith({}), removePlaylist("missing"))).toThrow();
  });

  it("editPlaylist merges the given fields", () => {
    const state = reducer(stateWith({ a: ["1"] }), editPlaylist({ id: "a", title: "Renamed" }));

    expect(state.playlists.byId.a).toEqual({
      id: "a",
      title: "Renamed",
      background: "bg",
      tracks: ["1"],
    });
  });

  it("editPlaylist throws without an id", () => {
    expect(() => reducer(stateWith({ a: [] }), editPlaylist({ title: "x" }))).toThrow(
      "Id needed in editPlaylist payload",
    );
  });

  it("addTrack puts the new track first", () => {
    const state = reducer(stateWith({ a: ["1"] }), addTrack({ playlistId: "a", track: track("2") }));

    expect(state.playlists.byId.a.tracks).toEqual(["2", "1"]);
    expect(state.tracks["2"]).toEqual(track("2"));
  });

  it("addTracks puts the new tracks first, keeping their order", () => {
    const state = reducer(
      stateWith({ a: ["1"] }),
      addTracks({ playlistId: "a", tracks: [track("2"), track("3")] }),
    );

    expect(state.playlists.byId.a.tracks).toEqual(["2", "3", "1"]);
    expect(Object.keys(state.tracks).sort()).toEqual(["1", "2", "3"]);
  });

  it("removeTrack removes the track from its playlist and the library", () => {
    const state = reducer(stateWith({ a: ["1", "2", "3"] }), removeTrack({ playlistId: "a", trackId: "2" }));

    expect(state.playlists.byId.a.tracks).toEqual(["1", "3"]);
    expect(state.tracks["2"]).toBeUndefined();
  });

  it("editTrack merges the given fields", () => {
    const state = reducer(stateWith({ a: ["1"] }), editTrack({ id: "1", title: "New" }));

    expect(state.tracks["1"]).toEqual({ ...track("1"), title: "New" });
  });

  it("editTrack throws without an id", () => {
    expect(() => reducer(stateWith({ a: ["1"] }), editTrack({ title: "x" }))).toThrow(
      "Id needed in editTrack payload",
    );
  });

  it.each([
    ["forwards", "a", "c", ["b", "c", "a", "d"]],
    ["backwards", "d", "b", ["a", "d", "b", "c"]],
    ["onto itself", "b", "b", ["a", "b", "c", "d"]],
  ])("movePlaylist moves %s to the position of `over`", (_label, active, over, expected) => {
    const state = reducer(stateWith({ a: [], b: [], c: [], d: [] }), movePlaylist({ active, over }));

    expect(state.playlists.allIds).toEqual(expected);
  });

  it.each([
    ["forwards", "1", "3", ["2", "3", "1", "4"]],
    ["backwards", "4", "2", ["1", "4", "2", "3"]],
  ])("moveTrack moves %s to the position of `over`", (_label, active, over, expected) => {
    const state = reducer(
      stateWith({ a: ["1", "2", "3", "4"] }),
      moveTrack({ playlistId: "a", active, over }),
    );

    expect(state.playlists.byId.a.tracks).toEqual(expected);
  });
});
