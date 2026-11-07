/**
 * Design round 7 in the library (schema version 6): board dividers (ORG-4), steps and moving on (PLY-8), Follow with,
 * Pick up where it stopped and Ending (SHW-3, PLY-4), the mix-out marker (DAT-3), tags inside tags in rules (DAT-10),
 * keyboard shortcuts and the crossfade (UX-12, PLY-8), pads in search. Undo of each write is in undo.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CueStep } from "../../../common/domain";
import { NotFoundError, ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { UndoHistory } from "../undo";
import { addPad, createBoard, deletePads, resizeBoard } from "./boards";
import { createCampaign, createScene, createSession, deleteScene } from "./campaigns";
import { createPlaylist, deletePlaylist, listPlaylistTrackIds } from "./playlists";
import { getProfileOverride, setProfileOverride } from "./profiles";
import {
  boardDividers,
  getAllMovesOn,
  getAllSteps,
  getFollows,
  getMovesOn,
  getPlaySettings,
  getShortcuts,
  getSteps,
  getTagTree,
  resetShortcuts,
  setBoardDivider,
  setCrossfade,
  setMovesOn,
  setNextSceneGuard,
  setShortcut,
  setSteps,
  setTrackPlay,
  tagsWithInside,
  trackPlay,
} from "./round7";
import { search } from "./search";
import { createTag, listTagGroups, listTags, tagTracks } from "./tags";
import { createTracks, deleteTracks, getTrack } from "./tracks";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

function sample() {
  const [a, b] = createTracks(t.store, ["A", "B"].map((title, i) => ({ title, file: { path: `/m/${title}.flac`, size: i + 1, mtimeMs: 1 } })));
  const playlist = createPlaylist(t.store, { title: "Abbey" });
  const board = createBoard(t.store, { title: "Weather", cols: 2, rows: 3 });
  const thunder = addPad(t.store, board.id, { label: "Thunder crack", at: { row: 0, col: 0 } });
  const bell = addPad(t.store, board.id, { label: "Abbey bell", at: { row: 0, col: 1 } });
  const campaign = createCampaign(t.store, { name: "Crown" });
  const session = createSession(t.store, { campaignId: campaign.id, name: "Abbey" });
  const scene = createScene(t.store, { sessionId: session.id, name: "Ruins" });
  const next = createScene(t.store, { sessionId: session.id, name: "Crypt" });
  return { a, b, playlist, board, thunder, bell, campaign, session, scene, next };
}

describe("ORG-4 a pad board's dividers", () => {
  it("names a row, renames and removes it; one undo step each; a row the grid lost keeps its divider", async () => {
    const s = sample();
    const history = new UndoHistory(t.store);
    setBoardDivider(t.store, s.board.id, 1, "Spells");
    setBoardDivider(t.store, s.board.id, 0, "Weather");
    expect(boardDividers(t.store, s.board.id)).toEqual([
      { row: 0, name: "Weather" },
      { row: 1, name: "Spells" },
    ]);
    setBoardDivider(t.store, s.board.id, 1, "Charms");
    setBoardDivider(t.store, s.board.id, 0, null);
    expect(boardDividers(t.store, s.board.id)).toEqual([{ row: 1, name: "Charms" }]);
    resizeBoard(t.store, s.board.id, { cols: 2, rows: 1 });
    expect(boardDividers(t.store, s.board.id)).toEqual([{ row: 1, name: "Charms" }]);
    await history.undo();
    await history.undo();
    expect(boardDividers(t.store, s.board.id)).toEqual([
      { row: 0, name: "Weather" },
      { row: 1, name: "Charms" },
    ]);
    expect(() => setBoardDivider(t.store, s.board.id, 8, "Off")).toThrow(ValidationError);
    expect(() => setBoardDivider(t.store, s.board.id, 2, "  ")).toThrow(ValidationError);
    expect(() => setBoardDivider(t.store, "nope", 0, "x")).toThrow(NotFoundError);
  });
});

describe("PLY-8 steps for a scene's start and a pad", () => {
  it("keeps a scene's own steps in order and reads them back as CueSteps; null is the usual", () => {
    const s = sample();
    expect(getSteps(t.store, { sceneId: s.scene.id })).toBeNull();
    const steps: CueStep[] = [
      { do: "music", what: { kind: "playlist", id: s.playlist.id }, how: "crossfade", upNext: "replace", fromMs: 1500 },
      { do: "fade", level: 0.3, ms: 2000 },
      { do: "pad", boardId: s.board.id, padId: s.bell.id },
      { do: "wait", ms: 5000 },
      { do: "board", boardId: s.board.id },
      { do: "stop", what: "ambience" },
      { do: "play", what: { kind: "track", id: s.a.id }, how: "mixOut", upNext: "addToQueue", fromMs: null },
      { do: "scene", scene: { campaignId: s.campaign.id, sessionId: s.session.id, sceneId: s.next.id } },
    ];
    setSteps(t.store, { sceneId: s.scene.id }, steps);
    expect(getSteps(t.store, { sceneId: s.scene.id })).toEqual(steps);
    setSteps(t.store, { sceneId: s.scene.id }, []);
    expect(getSteps(t.store, { sceneId: s.scene.id })).toEqual([]);
    setSteps(t.store, { padId: s.thunder.id }, [{ do: "sound" }, { do: "fade", level: 0, ms: 1000 }]);
    expect(getAllSteps(t.store)).toEqual({ scenes: { [s.scene.id]: [] }, pads: { [s.thunder.id]: [{ do: "sound" }, { do: "fade", level: 0, ms: 1000 }] } });
    setSteps(t.store, { sceneId: s.scene.id }, null);
    expect(getSteps(t.store, { sceneId: s.scene.id })).toBeNull();
  });

  it("makes one undo step per save, and none when nothing changes", async () => {
    const s = sample();
    const history = new UndoHistory(t.store);
    setSteps(t.store, { padId: s.thunder.id }, [{ do: "sound" }, { do: "wait", ms: 1000 }]);
    setSteps(t.store, { padId: s.thunder.id }, [{ do: "sound" }, { do: "wait", ms: 1000 }]);
    setSteps(t.store, { padId: s.thunder.id }, [{ do: "wait", ms: 2000 }]);
    expect(history.state().undoLabel).toMatch(/Thunder crack/);
    await history.undo();
    expect(getSteps(t.store, { padId: s.thunder.id })).toEqual([{ do: "sound" }, { do: "wait", ms: 1000 }]);
    await history.undo();
    expect(getSteps(t.store, { padId: s.thunder.id })).toBeNull();
    expect(history.state().canUndo).toBe(false);
  });

  it("refuses steps that do not fit, or name what is not there", () => {
    const s = sample();
    expect(() => setSteps(t.store, { padId: s.thunder.id }, [{ do: "board", boardId: s.board.id }])).toThrow(ValidationError);
    expect(() => setSteps(t.store, { sceneId: s.scene.id }, [{ do: "sound" }])).toThrow(ValidationError);
    expect(() => setSteps(t.store, { sceneId: s.scene.id }, [{ do: "pad", boardId: s.board.id, padId: "nope" }])).toThrow(NotFoundError);
    expect(() => setSteps(t.store, { sceneId: s.scene.id }, [{ do: "jump" } as never])).toThrow(ValidationError);
    expect(() => setSteps(t.store, { sceneId: "nope" }, [])).toThrow(NotFoundError);
    // A pad named under another board is refused: the step's board is the pad's.
    const other = createBoard(t.store, { title: "Other", cols: 1, rows: 1 });
    expect(() => setSteps(t.store, { sceneId: s.scene.id }, [{ do: "pad", boardId: other.id, padId: s.bell.id }])).toThrow(ValidationError);
  });

  it("drops a step whose pad, scene, track or playlist is deleted; goes with its owner", async () => {
    const s = sample();
    setSteps(t.store, { sceneId: s.scene.id }, [
      { do: "pad", boardId: s.board.id, padId: s.bell.id },
      { do: "play", what: { kind: "track", id: s.b.id }, how: "cut", upNext: "replace", fromMs: null },
      { do: "play", what: { kind: "playlist", id: s.playlist.id }, how: "cut", upNext: "replace", fromMs: null },
      { do: "wait", ms: 10 },
    ]);
    deletePads(t.store, [s.bell.id]);
    await deleteTracks(t.store, [s.b.id]);
    deletePlaylist(t.store, s.playlist.id);
    expect(getSteps(t.store, { sceneId: s.scene.id })).toEqual([{ do: "wait", ms: 10 }]);
    deleteScene(t.store, s.scene.id);
    expect(getAllSteps(t.store).scenes).toEqual({});
  });

  it("a scene moves on by itself when its music ends or after a time", () => {
    const s = sample();
    expect(getMovesOn(t.store, s.scene.id)).toEqual({ when: "stay" });
    setMovesOn(t.store, s.scene.id, { when: "after", ms: 300_000 });
    setMovesOn(t.store, s.next.id, { when: "musicEnds" });
    expect(getAllMovesOn(t.store)).toEqual({ [s.scene.id]: { when: "after", ms: 300_000 }, [s.next.id]: { when: "musicEnds" } });
    setMovesOn(t.store, s.scene.id, { when: "stay" });
    expect(getMovesOn(t.store, s.scene.id)).toEqual({ when: "stay" });
    expect(() => setMovesOn(t.store, s.scene.id, { when: "after", ms: 10 })).toThrow(ValidationError);
    expect(() => setMovesOn(t.store, s.scene.id, { when: "soon" } as never)).toThrow(ValidationError);
  });
});

describe("PLY-4, SHW-3 how a track plays", () => {
  it("keeps Ending, Pick up and Follow with in one undo step; follow is a track or a playlist", async () => {
    const s = sample();
    const history = new UndoHistory(t.store);
    expect(trackPlay(t.store, s.a.id)).toEqual({ fadesOut: false, resume: false, follow: null });
    setTrackPlay(t.store, s.a.id, { fadesOut: true, resume: true, follow: { kind: "playlist", id: s.playlist.id } });
    expect(trackPlay(t.store, s.a.id)).toEqual({ fadesOut: true, resume: true, follow: { kind: "playlist", id: s.playlist.id } });
    expect(getTrack(t.store, s.a.id)).toMatchObject({ ending: "fades" });
    setTrackPlay(t.store, s.b.id, { follow: { kind: "track", id: s.a.id } });
    expect(getFollows(t.store)).toEqual({ [s.a.id]: { kind: "playlist", id: s.playlist.id }, [s.b.id]: { kind: "track", id: s.a.id } });
    setTrackPlay(t.store, s.a.id, { fadesOut: false, follow: null });
    expect(trackPlay(t.store, s.a.id)).toEqual({ fadesOut: false, resume: true, follow: null });
    await history.undo();
    expect(trackPlay(t.store, s.a.id).fadesOut).toBe(true);
    expect(() => setTrackPlay(t.store, s.a.id, { follow: { kind: "track", id: s.a.id } })).toThrow(ValidationError);
    expect(() => setTrackPlay(t.store, s.a.id, { follow: { kind: "track", id: "nope" } })).toThrow(NotFoundError);
  });

  it("DAT-3: one marker of a profile is the mix-out point", () => {
    const s = sample();
    const place = { kind: "playlist" as const, playlistId: s.playlist.id };
    setProfileOverride(t.store, place, s.a.id, { markers: [{ atMs: 1000, label: "Swell" }, { atMs: 2000, label: "Low", mix: true }] });
    expect(getProfileOverride(t.store, place, s.a.id)?.markers).toEqual([{ atMs: 1000, label: "Swell" }, { atMs: 2000, label: "Low", mix: true }]);
    expect(() => setProfileOverride(t.store, place, s.a.id, { markers: [{ atMs: 1, label: "a", mix: true }, { atMs: 2, label: "b", mix: true }] })).toThrow(ValidationError);
  });
});

describe("DAT-10 tags inside tags", () => {
  it("gives the tree by group and name, and the tags with every tag inside them", async () => {
    const mood = listTagGroups(t.store).find((g) => g.name === "Mood")!;
    const melancholy = listTags(t.store, { groupId: mood.id }).find((x) => x.name === "Melancholy")!;
    const grief = createTag(t.store, { groupId: mood.id, name: "Grief", parentId: melancholy.id });
    const mourning = createTag(t.store, { groupId: mood.id, name: "Mourning", parentId: grief.id });
    expect(getTagTree(t.store)).toEqual({ [mood.id]: { Grief: "Melancholy", Mourning: "Grief" } });
    expect(tagsWithInside(t.store, [melancholy.id]).sort()).toEqual([melancholy.id, grief.id, mourning.id].sort());
    // A dynamic rule naming Melancholy plays the tracks tagged with a tag inside it.
    const [sad] = createTracks(t.store, [{ title: "Sad", file: { path: "/m/sad.flac" } }]);
    await tagTracks(t.store, [sad.id], [mourning.id]);
    const rule = createPlaylist(t.store, { title: "Sad", kind: "dynamic", rule: { conds: [{ group: mood.id, match: "any", values: ["Melancholy"] }] } });
    expect(listPlaylistTrackIds(t.store, rule.id)).toEqual([sad.id]);
  });
});

describe("UX-12, PLY-8 the library's play settings", () => {
  it("keeps changed keys only, refuses a key in use naming its action, and resets", async () => {
    const history = new UndoHistory(t.store);
    expect(getShortcuts(t.store)).toEqual({});
    setShortcut(t.store, "palette", "ctrl+j");
    expect(getShortcuts(t.store)).toEqual({ palette: "Ctrl+J" });
    expect(() => setShortcut(t.store, "find", "Ctrl+J")).toThrow(/Find and play/);
    expect(() => setShortcut(t.store, "find", "Space")).toThrow(/Next scene/);
    expect(() => setShortcut(t.store, "find", "Hyper+X")).toThrow(ValidationError);
    expect(() => setShortcut(t.store, "dance" as never, "D")).toThrow(ValidationError);
    setShortcut(t.store, "palette", "Ctrl+K");
    expect(getShortcuts(t.store)).toEqual({});
    setShortcut(t.store, "nextScene", "N");
    setShortcut(t.store, "find", "Space");
    resetShortcuts(t.store);
    expect(getShortcuts(t.store)).toEqual({});
    await history.undo();
    expect(getShortcuts(t.store)).toEqual({ nextScene: "N", find: "Space" });
  });

  it("keeps the crossfade and the Next scene guard", () => {
    expect(getPlaySettings(t.store)).toEqual({ crossfade: { ms: 3000, curve: "even" }, nextSceneGuard: true });
    setCrossfade(t.store, { ms: 5000, curve: "power" });
    setNextSceneGuard(t.store, false);
    expect(getPlaySettings(t.store)).toEqual({ crossfade: { ms: 5000, curve: "power" }, nextSceneGuard: false });
    expect(() => setCrossfade(t.store, { ms: 30_000, curve: "even" })).toThrow(ValidationError);
  });
});

describe("UX-12 Find and play finds pads", () => {
  it("by the words of their label", () => {
    const s = sample();
    expect(search(t.store, "abb be", { kinds: ["pad"] }).map((h) => h.id)).toEqual([s.bell.id]);
  });
});
