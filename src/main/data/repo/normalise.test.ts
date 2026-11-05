/**
 * Version 4's repository functions (PLY-15, DAT-15): the library's normalising setting, a track's and a playlist's
 * own choice, and the loudness measured from a track's file (kept with the file it came from, outside undo).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "../errors";
import { UndoHistory } from "../undo";
import { makeTestStore } from "../test/testStore";
import { getDomainLookup } from "./domain";
import { allLoudness, saveLoudness, trackLoudness, type LoudnessSource } from "./loudness";
import { getLibraryNormalise, setLibraryNormalise, setPlaylistNormalise, setTrackNormalise } from "./normalise";
import { createPlaylist } from "./playlists";
import { createTracks, deleteTracks, updateTrack } from "./tracks";

let t: ReturnType<typeof makeTestStore>;
let history: UndoHistory;
let ids: string[];
beforeEach(() => {
  t = makeTestStore();
  history = new UndoHistory(t.store);
  ids = createTracks(t.store, [
    { title: "Bells", file: { path: "/m/bells.flac", size: 100, mtimeMs: 5 } },
    { title: "Rain", file: { path: "/m/rain.flac", size: 200, mtimeMs: 6 } },
    { title: "Stream", url: "https://example.com/stream.mp3" },
  ]).map((x) => x.id);
  t.store.clearHistory();
});
afterEach(() => t.close());

const sourceOf = (id: string): LoudnessSource => {
  const state = trackLoudness(t.store, id);
  if (state.state !== "needed") throw new Error(`expected loudness to be needed, got ${state.state}`);
  return state.source;
};

describe("the library's setting (PLY-15)", () => {
  it("is off at first with the Standard target, and is one undo step when changed", async () => {
    expect(getLibraryNormalise(t.store)).toEqual({ on: false, target: "standard" });
    setLibraryNormalise(t.store, { on: true, target: "loud" });
    expect(getLibraryNormalise(t.store)).toEqual({ on: true, target: "loud" });
    expect(history.state()).toMatchObject({ canUndo: true, undoLabel: "Normalise volume" });
    await history.undo();
    expect(getLibraryNormalise(t.store)).toEqual({ on: false, target: "standard" });
  });

  it("makes no undo step when nothing changes, and refuses a target it does not know", () => {
    setLibraryNormalise(t.store, { on: false, target: "standard" });
    expect(history.state().canUndo).toBe(false);
    expect(() => setLibraryNormalise(t.store, { on: true, target: "deafening" as never })).toThrow(ValidationError);
    expect(() => setLibraryNormalise(t.store, { on: "yes" as never, target: "quiet" })).toThrow(ValidationError);
  });
});

describe("a track's and a playlist's own choice (PLY-15)", () => {
  it("a track is on, off or follows (null); the shared rules see it", async () => {
    setTrackNormalise(t.store, ids[0], "off");
    expect(getDomainLookup(t.store).track(ids[0])?.normalise).toBe("off");
    expect(getDomainLookup(t.store).track(ids[1])?.normalise).toBeNull();
    expect(history.state().undoLabel).toBe('Normalise volume of "Bells"');
    setTrackNormalise(t.store, ids[0], null);
    expect(getDomainLookup(t.store).track(ids[0])?.normalise).toBeNull();
    await history.undo();
    expect(getDomainLookup(t.store).track(ids[0])?.normalise).toBe("off");
  });

  it("a playlist is on, off or follows (null); the shared rules see it", () => {
    const p = createPlaylist(t.store, { title: "Ashen King", kind: "manual" });
    setPlaylistNormalise(t.store, p.id, "on");
    expect(getDomainLookup(t.store).playlist(p.id)?.normalise).toBe("on");
    setPlaylistNormalise(t.store, p.id, null);
    expect(getDomainLookup(t.store).playlist(p.id)?.normalise).toBeNull();
  });

  it("makes no undo step for the choice it has, and refuses unknown items and choices", () => {
    setTrackNormalise(t.store, ids[1], null);
    expect(history.state().canUndo).toBe(false);
    expect(() => setTrackNormalise(t.store, "nope", "on")).toThrow(NotFoundError);
    expect(() => setPlaylistNormalise(t.store, "nope", "on")).toThrow(NotFoundError);
    expect(() => setTrackNormalise(t.store, ids[0], "library" as never)).toThrow(ValidationError);
  });
});

describe("measured loudness (DAT-15)", () => {
  it("is needed for a file, ready once saved, and none for a web address or an unknown track", () => {
    const source = sourceOf(ids[0]);
    expect(source).toEqual({ trackId: ids[0], file: "/m/bells.flac", fileSize: 100, fileMtimeMs: 5 });
    expect(saveLoudness(t.store, source, { lufs: -22.6, truePeakDb: -8 })).toBe(true);
    expect(trackLoudness(t.store, ids[0])).toEqual({ state: "ready", loudness: { lufs: -22.6, truePeakDb: -8 } });
    expect(trackLoudness(t.store, ids[2])).toEqual({ state: "none" });
    expect(trackLoudness(t.store, "nope")).toEqual({ state: "none" });
    expect(getDomainLookup(t.store).track(ids[0])?.loudness).toEqual({ lufs: -22.6, truePeakDb: -8 });
    expect(getDomainLookup(t.store).track(ids[1])?.loudness).toBeNull();
    expect(allLoudness(t.store)).toEqual(new Map([[ids[0], { lufs: -22.6, truePeakDb: -8 }]]));
  });

  it("a file that could not be measured is not tried again until it changes", () => {
    saveLoudness(t.store, sourceOf(ids[1]), null);
    expect(trackLoudness(t.store, ids[1])).toEqual({ state: "unmeasurable" });
    expect(getDomainLookup(t.store).track(ids[1])?.loudness).toBeNull();
  });

  it("is needed again when the file changes, and counts only for the file it was measured from", () => {
    saveLoudness(t.store, sourceOf(ids[0]), { lufs: -22.6, truePeakDb: -8 });
    updateTrack(t.store, ids[0], { file: { path: "/m/bells.flac", size: 101, mtimeMs: 9 } });
    expect(trackLoudness(t.store, ids[0]).state).toBe("needed");
    expect(getDomainLookup(t.store).track(ids[0])?.loudness).toBeNull();
    expect(allLoudness(t.store).size).toBe(0);
  });

  it("is not saved for a file that changed or a track deleted meanwhile", async () => {
    const stale = sourceOf(ids[0]);
    updateTrack(t.store, ids[0], { file: { path: "/m/bells.flac", size: 101, mtimeMs: 9 } });
    expect(saveLoudness(t.store, stale, { lufs: -20, truePeakDb: -3 })).toBe(false);
    const gone = sourceOf(ids[1]);
    await deleteTracks(t.store, [ids[1]]);
    expect(saveLoudness(t.store, gone, { lufs: -20, truePeakDb: -3 })).toBe(false);
    expect(t.store.all("SELECT track_id FROM track_loudness")).toEqual([]);
  });

  it("is kept out of undo, and keeps the undo history", async () => {
    setTrackNormalise(t.store, ids[0], "on");
    saveLoudness(t.store, sourceOf(ids[0]), { lufs: -22.6, truePeakDb: -8 });
    expect(history.state()).toMatchObject({ canUndo: true, undoLabel: 'Normalise volume of "Bells"' });
    await history.undo();
    expect(trackLoudness(t.store, ids[0]).state).toBe("ready");
  });

  it("refuses figures the table cannot hold", () => {
    const source = sourceOf(ids[0]);
    expect(() => saveLoudness(t.store, source, { lufs: Number.NaN, truePeakDb: -3 })).toThrow(RangeError);
    expect(() => saveLoudness(t.store, source, { lufs: -90, truePeakDb: -3 })).toThrow(RangeError);
  });
});
