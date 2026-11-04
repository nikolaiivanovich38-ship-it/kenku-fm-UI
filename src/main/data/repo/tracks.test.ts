import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import {
  createTrack,
  createTracks,
  deleteTracks,
  getFollowWith,
  getTrack,
  listNewTrackIds,
  listTracks,
  markTracksUsed,
  resolveTrackLocation,
  setFollowWith,
  trackUsage,
  updateTrack,
} from "./tracks";
import { addRoot, listRoots, removeRoot, updateRoot } from "./roots";
import { addMarker, deleteMarker, listMarkers, updateMarker } from "./markers";
import { addTracksToPlaylist, createPlaylist, getPlaylist, listPlaylistItems } from "./playlists";
import { addPad, createBoard } from "./boards";
import { createTag, listTagGroups, tagTracks, tagsOfTrack } from "./tags";
import { addSceneMusic, createCampaign, createScene, createSession, setSceneAmbience } from "./campaigns";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

describe("library roots and file locations (DAT-1, DAT-8)", () => {
  it("stores a file under a root relative to it, with its facts for relinking", () => {
    const root = addRoot(t.store, { name: "Soundtracks", path: "H:\\Audio\\Soundtracks" });
    const track = createTrack(t.store, {
      title: "Silver for Monsters",
      file: { path: "H:\\Audio\\Soundtracks\\Witcher 3\\Silver for Monsters.flac", size: 1234, mtimeMs: 99, checksum: "sha256:ab" },
    });
    expect(track.location).toEqual({ kind: "root", rootId: root.id, path: "Witcher 3/Silver for Monsters.flac" });
    expect(track).toMatchObject({ fileName: "Silver for Monsters.flac", fileSize: 1234, fileMtimeMs: 99, checksum: "sha256:ab" });
    expect(resolveTrackLocation(t.store, track)).toBe("H:\\Audio\\Soundtracks\\Witcher 3\\Silver for Monsters.flac");
  });

  it("falls back to an absolute path outside every root, and accepts web addresses", () => {
    const file = createTrack(t.store, { title: "Rain", file: { path: "D:\\Sfx\\rain.wav" } });
    expect(file.location).toEqual({ kind: "absolute", path: "D:\\Sfx\\rain.wav" });
    const web = createTrack(t.store, { title: "Stream", url: "https://example.com/a.mp3" });
    expect(web.location).toEqual({ kind: "url", url: "https://example.com/a.mp3" });
    expect(web.fileName).toBe("a.mp3");
    expect(resolveTrackLocation(t.store, web)).toBe("https://example.com/a.mp3");
  });

  it("moves every track at once when a root's folder moves", () => {
    const root = addRoot(t.store, { name: "Soundtracks", path: "H:\\Audio\\Soundtracks" });
    const track = createTrack(t.store, { title: "A", file: { path: "H:\\Audio\\Soundtracks\\a.mp3" } });
    updateRoot(t.store, root.id, { path: "E:\\Music\\Soundtracks" });
    expect(resolveTrackLocation(t.store, getTrack(t.store, track.id)!)).toBe("E:\\Music\\Soundtracks\\a.mp3");
  });

  it("turns tracks back into absolute paths when their root is removed", () => {
    const root = addRoot(t.store, { name: "Soundtracks", path: "H:\\Audio\\Soundtracks" });
    const track = createTrack(t.store, { title: "A", file: { path: "H:\\Audio\\Soundtracks\\a.mp3" } });
    removeRoot(t.store, root.id);
    expect(listRoots(t.store)).toEqual([]);
    expect(getTrack(t.store, track.id)!.location).toEqual({ kind: "absolute", path: "H:\\Audio\\Soundtracks\\a.mp3" });
  });

  it("refuses roots and files that are not absolute paths, and duplicate root names", () => {
    expect(() => addRoot(t.store, { name: "X", path: "relative\\folder" })).toThrow(ValidationError);
    addRoot(t.store, { name: "Music", path: "/music" });
    expect(() => addRoot(t.store, { name: "music", path: "/other" })).toThrow(/already/);
    expect(() => createTrack(t.store, { title: "A", file: { path: "a.mp3" } })).toThrow(ValidationError);
    expect(() => createTrack(t.store, { title: "A" })).toThrow(/file or a web address/);
    expect(() => createTrack(t.store, { title: "A", url: "javascript:alert(1)" })).toThrow(ValidationError);
  });
});

describe("tracks live on their own (DAT-1)", () => {
  it("exists without any playlist and keeps an id given to it", () => {
    const track = createTrack(t.store, { id: "kenku-1", title: "Tavern", file: { path: "/m/tavern.mp3" } });
    expect(track.id).toBe("kenku-1");
    expect(listTracks(t.store).map((x) => x.id)).toEqual(["kenku-1"]);
    expect(trackUsage(t.store, track.id)).toEqual({ playlists: [], boards: [], scenes: [] });
  });

  it("can sit in several playlists and boards; one edit shows everywhere", () => {
    const track = createTrack(t.store, { title: "Tavern", file: { path: "/m/tavern.mp3" } });
    const p1 = createPlaylist(t.store, { title: "Town" });
    const p2 = createPlaylist(t.store, { title: "Rest" });
    const b = createBoard(t.store, { title: "Ambience" });
    addTracksToPlaylist(t.store, p1.id, [track.id]);
    addTracksToPlaylist(t.store, p2.id, [track.id]);
    addPad(t.store, b.id, { label: "Tavern", mode: "toggle", sound: { kind: "single", trackIds: [track.id] } });
    updateTrack(t.store, track.id, { title: "Busy tavern" });
    expect(listPlaylistItems(t.store, p1.id)[0]).toMatchObject({ kind: "track", title: "Busy tavern" });
    expect(listPlaylistItems(t.store, p2.id)[0]).toMatchObject({ kind: "track", title: "Busy tavern" });
    expect(trackUsage(t.store, track.id)).toEqual({
      playlists: [
        { id: p2.id, title: "Rest" },
        { id: p1.id, title: "Town" },
      ],
      boards: [{ id: b.id, title: "Ambience" }],
      scenes: [],
    });
  });

  it("deleting tracks takes them out of every list but leaves the lists", () => {
    const a = createTrack(t.store, { title: "A", file: { path: "/m/a.mp3" } });
    const b = createTrack(t.store, { title: "B", file: { path: "/m/b.mp3" } });
    const playlist = createPlaylist(t.store, { title: "Town" });
    addTracksToPlaylist(t.store, playlist.id, [a.id, b.id]);
    const campaign = createCampaign(t.store, { name: "C" });
    const session = createSession(t.store, { campaignId: campaign.id, name: "S1" });
    const scene = createScene(t.store, { sessionId: session.id, name: "Docks" });
    const quay = createScene(t.store, { sessionId: session.id, name: "Quay" });
    addSceneMusic(t.store, scene.id, [{ kind: "track", id: a.id }]);
    setSceneAmbience(t.store, quay.id, { kind: "track", id: a.id });
    expect(trackUsage(t.store, a.id).scenes).toEqual([
      { id: scene.id, name: "Docks" },
      { id: quay.id, name: "Quay" },
    ]);

    deleteTracks(t.store, [a.id]);
    expect(getTrack(t.store, a.id)).toBeNull();
    expect(getPlaylist(t.store, playlist.id)).not.toBeNull();
    expect(listPlaylistItems(t.store, playlist.id).map((item) => item.kind === "track" && item.trackId)).toEqual([b.id]);
  });
});

describe("scoring metadata (DAT-2)", () => {
  it("captures the example: Mood › Heroic, builds, sting, no loop, follow-with required", () => {
    const mood = listTagGroups(t.store).find((g) => g.name === "Mood")!;
    const heroic = createTag(t.store, { groupId: mood.id, name: "Heroic moment" });
    const track = createTrack(t.store, {
      title: "Very short heroic moment",
      file: { path: "/m/heroic.mp3" },
      arc: "builds",
      role: "sting",
      loopable: "no",
      followRequired: true,
      notes: "Cool vibe! Cue something up after.",
    });
    tagTracks(t.store, [track.id], [heroic.id]);
    expect(getTrack(t.store, track.id)).toMatchObject({
      arc: "builds",
      role: "sting",
      loopable: "no",
      followRequired: true,
      energy: null,
    });
    expect(tagsOfTrack(t.store, track.id).map((tag) => tag.name)).toEqual(["Heroic moment"]);
  });

  it("stores every field, all optional, and updates only what is given", () => {
    const track = createTrack(t.store, { title: "Cue", file: { path: "/m/c.mp3" } });
    expect(track).toMatchObject({
      energy: null,
      arc: null,
      role: null,
      loopable: null,
      ending: null,
      transitionIn: null,
      transitionOut: null,
      followRequired: false,
      notes: "",
      sourceComposer: null,
      sourceAlbum: null,
      sourceCueNumber: null,
      rating: null,
      lastUsedAt: null,
    });
    t.clock.advance(1000);
    const updated = updateTrack(t.store, track.id, {
      energy: 4,
      ending: "hard_stop",
      transitionIn: { kind: "crossfade", seconds: 2.5, curve: "equal_power" },
      transitionOut: { kind: "at_mix_out" },
      sourceComposer: "Marcin Przybyłowicz",
      sourceAlbum: "The Witcher 3",
      sourceCueNumber: "1M04",
      rating: 5,
      durationMs: 61_000,
    });
    expect(updated).toMatchObject({
      title: "Cue",
      energy: 4,
      ending: "hard_stop",
      transitionIn: { kind: "crossfade", seconds: 2.5, curve: "equal_power" },
      transitionOut: { kind: "at_mix_out" },
      sourceComposer: "Marcin Przybyłowicz",
      sourceCueNumber: "1M04",
      rating: 5,
      durationMs: 61_000,
      updatedAt: track.updatedAt + 1000,
    });
    const cleared = updateTrack(t.store, track.id, { energy: null, transitionIn: null });
    expect(cleared.energy).toBeNull();
    expect(cleared.transitionIn).toBeNull();
    expect(cleared.rating).toBe(5);
  });

  it("refuses values outside the allowed choices", () => {
    const track = createTrack(t.store, { title: "Cue", file: { path: "/m/c.mp3" } });
    const bad: [string, unknown][] = [
      ["energy", 6],
      ["energy", 2.5],
      ["arc", "explodes"],
      ["role", "Sting"],
      ["loopable", true],
      ["loopable", "with_crossfade"],
      ["kind", "voice"],
      ["metaTitle", 3],
      ["profile", { startMs: -5 }],
      ["profile", { after: "rewind" }],
      ["profile", { fadeIn: { ms: 100, shape: 101 } }],
      ["profile", { markers: [{ atMs: 1 }] }],
      ["profile", { speed: 2 }],
      ["rating", 0],
      ["transitionIn", { kind: "crossfade", seconds: -1, curve: "linear" }],
      ["transitionIn", { kind: "teleport" }],
      ["notes", "a\u0000b"],
    ];
    for (const [field, value] of bad) {
      expect(() => updateTrack(t.store, track.id, { [field]: value } as never), field).toThrow(ValidationError);
    }
    expect(() => updateTrack(t.store, "missing", { title: "x" })).toThrow(/No track/);
  });

  it("keeps 'follow with' links in order and refuses a link to itself", () => {
    const [a, b, c] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
      { title: "C", file: { path: "/m/c.mp3" } },
    ]);
    setFollowWith(t.store, a.id, [c.id, b.id]);
    expect(getFollowWith(t.store, a.id)).toEqual([c.id, b.id]);
    setFollowWith(t.store, a.id, [b.id]);
    expect(getFollowWith(t.store, a.id)).toEqual([b.id]);
    expect(() => setFollowWith(t.store, a.id, [a.id])).toThrow(ValidationError);
    deleteTracks(t.store, [b.id]);
    expect(getFollowWith(t.store, a.id)).toEqual([]);
  });

  it("records 'last used' without touching anything else", () => {
    const track = createTrack(t.store, { title: "A", file: { path: "/m/a.mp3" } });
    markTracksUsed(t.store, [track.id], 5555);
    expect(getTrack(t.store, track.id)).toMatchObject({ lastUsedAt: 5555, updatedAt: track.updatedAt });
  });

  it("lists tracks by title, filtered by tags (all of them must match)", () => {
    const groups = listTagGroups(t.store);
    const tense = createTag(t.store, { groupId: groups[0].id, name: "Tense!" });
    const docks = createTag(t.store, { groupId: groups[2].id, name: "Docks" });
    const [a, b] = createTracks(t.store, [
      { title: "beta", file: { path: "/m/b.mp3" } },
      { title: "Alpha", file: { path: "/m/a.mp3" } },
    ]);
    tagTracks(t.store, [a.id, b.id], [tense.id]);
    tagTracks(t.store, [a.id], [docks.id]);
    expect(listTracks(t.store).map((x) => x.title)).toEqual(["Alpha", "beta"]);
    expect(listTracks(t.store, { tagIds: [tense.id, docks.id] }).map((x) => x.title)).toEqual(["beta"]);
    expect(listTracks(t.store, { limit: 1, offset: 1 }).map((x) => x.title)).toEqual(["beta"]);
  });
});

describe("design fields (DAT-11): kind, three names, role, loop advice, audio profile", () => {
  it("keeps the game master's title (may be empty), the file-tag title and the file name", () => {
    const fresh = createTrack(t.store, { kind: "amb", metaTitle: "Far Horizons", file: { path: "/m/1-05 Far Horizons.flac" } });
    expect(fresh).toMatchObject({ kind: "amb", title: "", metaTitle: "Far Horizons", fileName: "1-05 Far Horizons.flac", profile: null });
    expect(createTrack(t.store, { file: { path: "/m/x.wav" } })).toMatchObject({ kind: "music", title: "", metaTitle: "" });
    expect(updateTrack(t.store, fresh.id, { title: "  Open road  " }).title).toBe("Open road");
    expect(updateTrack(t.store, fresh.id, { title: "" }).title).toBe("");
    // Untitled tracks sort by the name shown for them.
    createTrack(t.store, { title: "Zither", file: { path: "/m/z.wav" } });
    expect(listTracks(t.store).map((x) => x.title || x.metaTitle || x.fileName)).toEqual(["Far Horizons", "x.wav", "Zither"]);
  });

  it("takes every role of the design, loop advice yes/crossfade/no, and its own audio profile", () => {
    const track = createTrack(t.store, { kind: "fx", title: "Sword", file: { path: "/fx/sword.wav" }, role: "effect", loopable: "crossfade" });
    expect(track).toMatchObject({ role: "effect", loopable: "crossfade" });
    for (const role of ["loop_bed", "underscore", "sting", "transition", "effect"] as const) {
      expect(updateTrack(t.store, track.id, { role }).role).toBe(role);
    }
    const profile = {
      startMs: 8000,
      endMs: 412_000,
      after: "next" as const,
      loopStartMs: 8000,
      fadeIn: { ms: 3000, shape: 30 },
      fadeOut: { ms: 6000, shape: 65 },
      markers: [{ atMs: 140_000, label: "Builds" }],
    };
    expect(updateTrack(t.store, track.id, { profile }).profile).toEqual(profile);
    // Fields left out take the defaults when played (see resolveProfile).
    expect(updateTrack(t.store, track.id, { profile: { endMs: 1000 } }).profile).toEqual({ endMs: 1000 });
    expect(updateTrack(t.store, track.id, { profile: null }).profile).toBeNull();
  });
});

describe("markers (DAT-3 data)", () => {
  it("adds, renames, moves and deletes named markers, kept in time order", () => {
    const track = createTrack(t.store, { title: "A", file: { path: "/m/a.mp3" } });
    const swell = addMarker(t.store, track.id, { timeMs: 92_000, label: "swell 1" });
    const loopIn = addMarker(t.store, track.id, { timeMs: 4_000, kind: "loop_in" });
    addMarker(t.store, track.id, { timeMs: 120_000, kind: "mix_out", label: "mix out" });
    expect(listMarkers(t.store, track.id).map((m) => [m.kind, m.timeMs])).toEqual([
      ["loop_in", 4_000],
      ["marker", 92_000],
      ["mix_out", 120_000],
    ]);
    updateMarker(t.store, swell.id, { label: "big swell", timeMs: 1_000 });
    expect(listMarkers(t.store, track.id)[0]).toMatchObject({ label: "big swell", timeMs: 1_000 });
    deleteMarker(t.store, loopIn.id);
    expect(listMarkers(t.store, track.id)).toHaveLength(2);
    expect(() => addMarker(t.store, track.id, { timeMs: -1 })).toThrow(ValidationError);
    expect(() => addMarker(t.store, track.id, { timeMs: 1, kind: "drop" as never })).toThrow(ValidationError);
    expect(() => addMarker(t.store, "missing", { timeMs: 1 })).toThrow(/No track/);
  });
});

describe("new tracks (EDT-6: the Library's New mark)", () => {
  it("marks a track New when asked, lists new tracks, and settles it once titled and tagged", () => {
    const fresh = createTrack(t.store, { file: { path: "/m/new.flac" }, isNew: true });
    const old = createTrack(t.store, { title: "Old", file: { path: "/m/old.flac" } });
    expect(fresh.isNew).toBe(true);
    expect(old.isNew).toBe(false);
    expect(listNewTrackIds(t.store)).toEqual([fresh.id]);
    const tense = listTagGroups(t.store)[0];
    const tag = createTag(t.store, { groupId: tense.id, name: "Brooding" });
    tagTracks(t.store, [fresh.id], [tag.id]);
    expect(getTrack(t.store, fresh.id)?.isNew).toBe(true);
    updateTrack(t.store, fresh.id, { title: "Brooding storm" });
    expect(getTrack(t.store, fresh.id)?.isNew).toBe(false);
    expect(listNewTrackIds(t.store)).toEqual([]);
    expect(updateTrack(t.store, old.id, { isNew: true }).isNew).toBe(true);
  });
});
