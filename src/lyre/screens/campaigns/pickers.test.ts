import { describe, expect, it } from "vitest";

import { keyOfRef, musicAfterAdding } from "./pickers";

/* The 0.6.0 usability test (F-C10): Add music adds; a playlist made in it takes the ticked tracks out of the scene. */
describe("musicAfterAdding", () => {
  const had = ["track:a", "playlist:p", "track:b"];

  it("adds what was ticked at the end, in the order ticked, and never twice", () => {
    expect(musicAfterAdding(had, ["track:c", "track:a", "playlist:q"], null)).toEqual(["track:a", "playlist:p", "track:b", "track:c", "playlist:q"]);
  });

  it("puts a new playlist where the first of the scene's own tracks in it was, and takes those tracks out", () => {
    const made = { key: "playlist:new", tracks: ["track:x", "track:b", "track:a"] };
    expect(musicAfterAdding(had, ["playlist:new"], made)).toEqual(["playlist:new", "playlist:p"]);
  });

  it("puts a new playlist of tracks the scene did not have at the end", () => {
    expect(musicAfterAdding(had, ["playlist:new"], { key: "playlist:new", tracks: ["track:x"] })).toEqual([...had, "playlist:new"]);
  });

  it("names a scene's item as the picker does", () => {
    expect(keyOfRef({ kind: "playlist", id: "p" })).toBe("playlist:p");
    expect(keyOfRef({ kind: "track", id: "t" })).toBe("track:t");
  });
});
