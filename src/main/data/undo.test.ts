import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "./sqlite";
import { MIGRATIONS, migrate, type Migration } from "./schema";
import { Store } from "./store";
import { UndoHistory, undoableTables } from "./undo";
import { makeClock } from "./test/helpers";
import * as tracks from "./repo/tracks";
import * as roots from "./repo/roots";
import * as markers from "./repo/markers";
import * as playlists from "./repo/playlists";
import * as boards from "./repo/boards";
import * as folders from "./repo/folders";
import * as tags from "./repo/tags";
import * as campaigns from "./repo/campaigns";
import * as profiles from "./repo/profiles";
import * as cueActions from "./repo/cueActions";
import { search } from "./repo/search";
import { getDomainLookup } from "./repo/domain";

function setup(limit?: number) {
  const clock = makeClock();
  const db = openConnection(":memory:");
  migrate(db, MIGRATIONS, clock.now);
  const store = new Store(db, { now: clock.now });
  const history = new UndoHistory(store, { limit });
  return { db, store, history, clock };
}

/**
 * Makes the next `db.exec(sql)` fail with `message` without running it, the
 * way SQLite reports a full disk or an I/O error on COMMIT. Only that one
 * statement fails; the transaction stays open, as in SQLite.
 */
function failNextExec(db: DatabaseSync, sql: string, message: string) {
  const exec = db.exec.bind(db);
  let armed = true;
  db.exec = (text: string) => {
    if (armed && text === sql) {
      armed = false;
      throw Object.assign(new Error(message), { code: "ERR_SQLITE_ERROR", errcode: 13 });
    }
    return exec(text);
  };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});
afterEach(() => t.db.close());

/** Every row of every table the user's edits touch, plus the search index content. */
function snapshot(store: Store) {
  const result: Record<string, unknown[]> = {};
  for (const table of undoableTables(store.db)) {
    result[table.name] = store.all(`SELECT * FROM ${table.name} ORDER BY ${table.primaryKey.join(", ")}`);
  }
  result.search = store.all(
    `SELECT d.kind, d.ref_id, f.title, f.meta_title, f.file_name, f.artist, f.album, f.tags, f.markers, f.notes, f.cue
     FROM search_docs d JOIN search_fts f ON f.rowid = d.doc_id ORDER BY d.kind, d.ref_id`,
  );
  return result;
}

/** A small library with something of everything. */
async function fixture(store: Store) {
  const root = await roots.addRoot(store, { name: "Music", path: "/music" });
  const [a, b, c] = tracks.createTracks(store, [
    { title: "Alpha", file: { path: "/music/a.mp3" }, notes: "first" },
    { title: "Beta", file: { path: "/music/b.mp3" } },
    { title: "Gamma", file: { path: "/other/c.mp3" } },
  ]);
  const marker = markers.addMarker(store, a.id, { timeMs: 1000, label: "swell" });
  const folder = folders.createFolder(store, { scope: "playlists", name: "Town" });
  const sub = folders.createFolder(store, { scope: "playlists", name: "Inn", parentId: folder.id });
  const playlist = playlists.createPlaylist(store, { title: "Tavern", folderId: sub.id });
  const items = playlists.addTracksToPlaylist(store, playlist.id, [a.id, b.id, c.id]);
  const divider = playlists.addPlaylistDivider(store, playlist.id, "Night");
  const board = boards.createBoard(store, { title: "Fx", cols: 3, rows: 2 });
  const pads = ["Door", "Bell", "Wind", "Owl"].map((label, i) =>
    boards.addPad(store, board.id, { label, sound: { kind: "variants", trackIds: i === 0 ? [a.id, b.id] : [c.id] } }),
  );
  const sparePad = boards.addPad(store, board.id, { label: "Thunder", at: "spare" });
  boards.updatePad(store, pads[1].id, { hotkey: "1" });
  const board2 = boards.createBoard(store, { title: "Ambience" });
  const mood = tags.listTagGroups(store)[0];
  const tense = tags.listTags(store, { groupId: mood.id })[2];
  const villain = tags.createTag(store, { groupId: mood.id, name: "Villain", synonyms: ["baddie"] });
  const strahd = tags.createTag(store, { groupId: mood.id, name: "Strahd", parentId: villain.id });
  await tags.tagTracks(store, [a.id, b.id], [tense.id, villain.id]);
  // Its rule names tags, so renaming, merging or deleting them changes it too (in the same step).
  const dynamic = playlists.createPlaylist(store, {
    title: "Eerie",
    kind: "dynamic",
    lane: "amb",
    rule: { conds: [{ group: mood.id, match: "any", values: [tense.name, "Villain"] }], energy: [1, 3] },
  });
  tracks.setFollowWith(store, a.id, [b.id]);
  const campaign = campaigns.createCampaign(store, { name: "Strahd" });
  const otherCampaign = campaigns.createCampaign(store, { name: "Witcher" });
  campaigns.addToCampaign(store, campaign.id, { playlistIds: [playlist.id, dynamic.id], boardIds: [board.id] });
  const session = campaigns.createSession(store, { campaignId: campaign.id, name: "S1" });
  const session2 = campaigns.createSession(store, { campaignId: campaign.id, name: "S2" });
  campaigns.addToSession(store, session.id, { playlistIds: [playlist.id, dynamic.id], boardIds: [board.id] });
  const scene = campaigns.createScene(store, { sessionId: session.id, name: "Gates" });
  campaigns.createScene(store, { sessionId: session.id, name: "Village" });
  const music = campaigns.addSceneMusic(store, scene.id, [{ kind: "playlist", id: playlist.id }, { kind: "track", id: c.id }]);
  campaigns.setSceneAmbience(store, scene.id, { kind: "playlist", id: dynamic.id });
  campaigns.addSceneBoards(store, scene.id, [board.id, board2.id]);
  tracks.updateTrack(store, b.id, { profile: { endMs: 5000 } });
  const inScene = { kind: "scene" as const, campaignId: campaign.id, sessionId: session.id, sceneId: scene.id };
  profiles.setProfileOverride(store, inScene, a.id, { endMs: 1000, after: "stop" });
  return {
    root, a, b, c, marker, folder, sub, playlist, dynamic, items, divider, board, board2, pads, sparePad,
    mood, tense, villain, strahd, campaign, otherCampaign, session, session2, scene, music, inScene,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Every write command of the repository, run against the fixture. */
const COMMANDS: [string, (s: Store, f: Fixture) => unknown][] = [
  ["addRoot", (s) => roots.addRoot(s, { name: "Fx", path: "/fx" })],
  ["updateRoot", (s, f) => roots.updateRoot(s, f.root.id, { name: "Songs", path: "/songs", watched: true })],
  ["setHotkeyActions", (s, f) => cueActions.setHotkeyActions(s, "f1", [{ type: "playTrack", trackId: f.a.id, target: "all", from: { scene: f.inScene, at: 0 } }, { type: "firePad", boardId: f.board.id, padId: f.pads[0].id, target: "all" }])],
  [
    "setHotkeyActions (then the track is deleted)",
    (s, f) =>
      s.change("Key, then delete", () => {
        cueActions.setHotkeyActions(s, "f2", [{ type: "playTrack", trackId: f.c.id, target: "all" }]);
        void tracks.deleteTracks(s, [f.c.id]);
      }),
  ],
  ["removeRoot", (s, f) => roots.removeRoot(s, f.root.id)],
  ["createTrack", (s) => tracks.createTrack(s, { title: "Delta", url: "https://example.com/d.mp3" })],
  ["createTracks", (s) => tracks.createTracks(s, [{ title: "D", file: { path: "/d.mp3" } }, { title: "E", file: { path: "/e.mp3" } }])],
  ["updateTrack", (s, f) => tracks.updateTrack(s, f.a.id, { title: "Alpha 2", energy: 3 })],
  ["updateTrack (relocate)", (s, f) => tracks.updateTrack(s, f.c.id, { file: { path: "/music/sub/c.mp3", size: 5 } })],
  ["deleteTracks", (s, f) => tracks.deleteTracks(s, [f.a.id, f.c.id])],
  ["relocateTracks", (s, f) => tracks.relocateTracks(s, "Relink 2 files", [{ trackId: f.a.id, file: { path: "/elsewhere/a.mp3", size: 3 } }, { trackId: f.c.id, file: { path: "/music/c.mp3" } }])],
  ["setFollowWith", (s, f) => tracks.setFollowWith(s, f.a.id, [f.c.id, f.b.id])],
  ["addMarker", (s, f) => markers.addMarker(s, f.b.id, { timeMs: 5, kind: "mix_out" })],
  ["updateMarker", (s, f) => markers.updateMarker(s, f.marker.id, { label: "big swell", timeMs: 2 })],
  ["deleteMarker", (s, f) => markers.deleteMarker(s, f.marker.id)],
  ["createFolder", (s, f) => folders.createFolder(s, { scope: "playlists", name: "New", parentId: f.folder.id })],
  ["updateFolder", (s, f) => folders.updateFolder(s, f.folder.id, { name: "City", color: "#123456", collapsed: true })],
  ["moveFolder", (s, f) => folders.moveFolder(s, f.sub.id, { parentId: null, placement: "start" })],
  ["deleteFolder", (s, f) => folders.deleteFolder(s, f.sub.id)],
  ["createPlaylist", (s) => playlists.createPlaylist(s, { title: "Battle", placement: "start" })],
  ["updatePlaylist", (s, f) => playlists.updatePlaylist(s, f.playlist.id, { title: "Inn", background: "forest" })],
  ["movePlaylist", (s, f) => playlists.movePlaylist(s, f.playlist.id, { folderId: null, placement: "end" })],
  ["deletePlaylist", (s, f) => playlists.deletePlaylist(s, f.playlist.id)],
  ["addTracksToPlaylist", (s, f) => playlists.addTracksToPlaylist(s, f.playlist.id, [f.c.id, f.a.id], { before: f.items[1].id })],
  ["addPlaylistDivider", (s, f) => playlists.addPlaylistDivider(s, f.playlist.id, "Dawn", "start")],
  ["renamePlaylistDivider", (s, f) => playlists.renamePlaylistDivider(s, f.divider.id, "Midnight")],
  ["movePlaylistItems", (s, f) => playlists.movePlaylistItems(s, [f.items[2].id, f.divider.id], "start")],
  ["removePlaylistItems", (s, f) => playlists.removePlaylistItems(s, [f.items[0].id, f.items[1].id])],
  ["copyPlaylist", (s, f) => playlists.copyPlaylist(s, f.dynamic.id, { title: "Eerie now", kind: "manual" })],
  ["updatePlaylist (rule)", (s, f) => playlists.updatePlaylist(s, f.dynamic.id, { rule: { conds: [], leaveOutStings: true }, notes: "n", lane: "music" })],
  ["createBoard", (s) => boards.createBoard(s, { title: "Weather" })],
  ["updateBoard", (s, f) => boards.updateBoard(s, f.board.id, { title: "Effects" })],
  ["moveBoard", (s, f) => boards.moveBoard(s, f.board.id, { placement: "end" })],
  ["deleteBoard", (s, f) => boards.deleteBoard(s, f.board.id)],
  ["resizeBoard", (s, f) => boards.resizeBoard(s, f.board.id, { cols: 1, rows: 1 })],
  ["addPad", (s, f) => boards.addPad(s, f.board.id, { label: "Roar", hotkey: "r", sound: { kind: "single", trackIds: [f.c.id] } })],
  ["updatePad", (s, f) => boards.updatePad(s, f.pads[0].id, { label: "Doors", sound: { kind: "variants", trackIds: [f.c.id, f.a.id], order: "in_turn" }, volume: 0.3 })],
  ["takePadHotkey", (s, f) => boards.takePadHotkey(s, f.pads[0].id, "1")],
  ["movePad", (s, f) => boards.movePad(s, f.pads[0].id, { row: 0, col: 1 })],
  ["movePad (from spare onto a pad)", (s, f) => boards.movePad(s, f.sparePad.id, { row: 0, col: 0 })],
  ["putPadBack", (s, f) => boards.putPadBack(s, f.sparePad.id)],
  ["duplicatePad", (s, f) => boards.duplicatePad(s, f.pads[0].id)],
  ["deletePads", (s, f) => boards.deletePads(s, [f.pads[0].id, f.sparePad.id])],
  ["createTagGroup", (s) => tags.createTagGroup(s, { name: "Weather" })],
  ["updateTagGroup", (s, f) => tags.updateTagGroup(s, f.mood.id, { name: "Feeling", color: "#abcdef" })],
  ["moveTagGroup", (s, f) => tags.moveTagGroup(s, f.mood.id, "end")],
  ["deleteTagGroup", (s, f) => tags.deleteTagGroup(s, f.mood.id)],
  ["createTag", (s, f) => tags.createTag(s, { groupId: f.mood.id, name: "Spooky", synonyms: ["creepy"] })],
  ["updateTag", (s, f) => tags.updateTag(s, f.tense.id, { name: "Suspense" })],
  ["updateTag (other group)", (s, f) => tags.updateTag(s, f.villain.id, { groupId: tags.listTagGroups(s)[1].id })],
  ["moveTag", (s, f) => tags.moveTag(s, f.villain.id, "start")],
  ["deleteTag", (s, f) => tags.deleteTag(s, f.villain.id)],
  ["setTagSynonyms", (s, f) => tags.setTagSynonyms(s, f.tense.id, ["nervy", "edgy"])],
  ["mergeTags", (s, f) => tags.mergeTags(s, [f.villain.id], f.tense.id)],
  ["tagTracks", (s, f) => tags.tagTracks(s, [f.c.id], [f.tense.id, f.strahd.id])],
  ["untagTracks", (s, f) => tags.untagTracks(s, [f.a.id, f.b.id], [f.tense.id])],
  ["createCampaign", (s) => campaigns.createCampaign(s, { name: "Witcher" })],
  ["updateCampaign", (s, f) => campaigns.updateCampaign(s, f.campaign.id, { name: "Barovia", notes: "x" })],
  ["moveCampaign", (s, f) => campaigns.moveCampaign(s, f.campaign.id, "end")],
  ["deleteCampaign", (s, f) => campaigns.deleteCampaign(s, f.campaign.id)],
  ["updateCampaign (design fields)", (s, f) => campaigns.updateCampaign(s, f.campaign.id, { theme: "hearth", system: "5e", obsidian: { vault: "V" } })],
  ["addToCampaign", (s, f) => campaigns.addToCampaign(s, f.otherCampaign.id, { playlistIds: [f.playlist.id] })],
  ["removeFromCampaign", (s, f) => campaigns.removeFromCampaign(s, f.campaign.id, { playlistIds: [f.playlist.id], boardIds: [f.board.id] })],
  ["moveInCampaign", (s, f) => campaigns.moveInCampaign(s, f.campaign.id, { playlistId: f.dynamic.id }, "start")],
  ["addToSession", (s, f) => campaigns.addToSession(s, f.session2.id, { playlistIds: [f.playlist.id], boardIds: [f.board.id] })],
  ["removeFromSession", (s, f) => campaigns.removeFromSession(s, f.session.id, { playlistIds: [f.playlist.id], boardIds: [f.board.id] })],
  ["moveInSession", (s, f) => campaigns.moveInSession(s, f.session.id, { playlistId: f.dynamic.id }, "start")],
  ["createSession", (s, f) => campaigns.createSession(s, { campaignId: f.campaign.id, name: "S2", date: "2026-11-07" })],
  ["updateSession", (s, f) => campaigns.updateSession(s, f.session.id, { name: "Session 1", date: "2026-11-01", number: 9 })],
  ["updateSession (next)", (s, f) => campaigns.updateSession(s, f.session2.id, { status: "next" })],
  ["moveSession", (s, f) => campaigns.moveSession(s, f.session.id, { placement: "end" })],
  ["deleteSession", (s, f) => campaigns.deleteSession(s, f.session.id)],
  ["createScene", (s, f) => campaigns.createScene(s, { sessionId: f.session.id, name: "Castle" })],
  ["updateScene", (s, f) => campaigns.updateScene(s, f.scene.id, { notes: "fog" })],
  ["moveScene", (s, f) => campaigns.moveScene(s, f.scene.id, { placement: "end" })],
  ["deleteScene", (s, f) => campaigns.deleteScene(s, f.scene.id)],
  ["updateScene (design fields)", (s, f) => campaigns.updateScene(s, f.scene.id, { startsWhen: "Gates open", noteLink: "Gates.md" })],
  ["addSceneMusic", (s, f) => campaigns.addSceneMusic(s, f.scene.id, [{ kind: "track", id: f.a.id }, { kind: "playlist", id: f.dynamic.id }], "start")],
  ["moveSceneMusic", (s, f) => campaigns.moveSceneMusic(s, [f.music[1].id], "start")],
  ["removeSceneMusic", (s, f) => campaigns.removeSceneMusic(s, [f.music[0].id])],
  ["setSceneAmbience", (s, f) => campaigns.setSceneAmbience(s, f.scene.id, { kind: "track", id: f.b.id })],
  ["setSceneAmbience (none)", (s, f) => campaigns.setSceneAmbience(s, f.scene.id, null)],
  ["addSceneBoards", (s, f) => campaigns.addSceneBoards(s, campaigns.listScenes(s, f.session.id)[1].id, [f.board2.id, f.board.id], "start")],
  ["moveSceneBoard", (s, f) => campaigns.moveSceneBoard(s, f.scene.id, f.board.id, "end")],
  ["removeSceneBoards", (s, f) => campaigns.removeSceneBoards(s, f.scene.id, [f.board.id])],
  ["setPlaylistUses", (s, f) => campaigns.setPlaylistUses(s, f.playlist.id, [{ sessionId: f.session2.id }, { sceneId: f.scene.id }])],
  ["setBoardUses", (s, f) => campaigns.setBoardUses(s, f.board.id, [{ campaignId: f.otherCampaign.id }])],
  ["setProfileOverride", (s, f) => profiles.setProfileOverride(s, { kind: "playlist", playlistId: f.playlist.id }, f.c.id, { startMs: 10 })],
  ["setProfileOverride (replace)", (s, f) => profiles.setProfileOverride(s, f.inScene, f.a.id, { startMs: 10 })],
  ["clearProfileOverride", (s, f) => profiles.clearProfileOverride(s, f.inScene, f.a.id)],
  ["updateTrack (design fields)", (s, f) => tracks.updateTrack(s, f.c.id, { kind: "fx", title: "", metaTitle: "Gamma tag", role: "effect", loopable: "crossfade", profile: { endMs: 9 } })],
];

describe("undo and redo of every command (EDT-2)", () => {
  it.each(COMMANDS)("%s is one step that undoes and redoes exactly", async (_name, command) => {
    const f = await fixture(t.store);
    t.history.clear();
    const before = snapshot(t.store);
    t.clock.advance(60_000);
    await command(t.store, f);
    const after = snapshot(t.store);
    expect(after).not.toEqual(before);
    expect(t.history.state()).toMatchObject({ canUndo: true, canRedo: false });

    expect(await t.history.undo()).toEqual(expect.any(String));
    expect(snapshot(t.store)).toEqual(before);
    expect(t.history.state()).toMatchObject({ canUndo: false, canRedo: true });

    await t.history.redo();
    expect(snapshot(t.store)).toEqual(after);
    await t.history.undo();
    expect(snapshot(t.store)).toEqual(before);
  });

  it("covers every exported write function", async () => {
    const modules = { tracks, roots, markers, playlists, boards, folders, tags, campaigns, profiles, cueActions };
    const readers = /^(get|list|find|track|tagUsage|campaignsOf|resolve|suggest|tagsOf|requireFolderFor|getFollowWith|ITEM_TABLES|[A-Z_]+$)/;
    const writers = Object.values(modules)
      .flatMap((m) => Object.keys(m))
      .filter((name) => !readers.test(name) && name !== "markTracksUsed");
    const covered = new Set(COMMANDS.map(([name]) => name.split(" ")[0]));
    expect(writers.filter((name) => !covered.has(name))).toEqual([]);
  });
});

describe("undo history", () => {
  it("is cleared through the store after writes made outside it (imports; DB review item 10)", async () => {
    const [track] = tracks.createTracks(t.store, [{ title: "A", file: { path: "/a.mp3" } }]);
    await tracks.deleteTracks(t.store, [track.id]);
    await t.history.undo();
    expect(t.history.state()).toMatchObject({ canUndo: true, canRedo: true });
    t.store.clearHistory();
    expect(t.history.state()).toEqual({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
    expect(() => t.store.change("x", () => t.store.clearHistory())).toThrow(/while a change/);
  });

  it("keeps library order (the order tracks were added) through delete and undo, and through VACUUM (DB review 3)", async () => {
    const [a, b, c, d] = tracks.createTracks(
      t.store,
      ["a", "b", "c", "d"].map((title) => ({ title, file: { path: `/m/${title}.mp3` } })),
    );
    const everything = playlists.createPlaylist(t.store, { title: "All music", kind: "dynamic", rule: { conds: [] } });
    const order = () => ({
      lookup: [...getDomainLookup(t.store).tracks()].map((x) => x.title).join(""),
      playlist: playlists.listPlaylistTrackIds(t.store, everything.id).map((id) => tracks.getTrack(t.store, id)!.title).join(""),
    });
    await tracks.deleteTracks(t.store, [a.id, c.id]);
    await t.history.undo();
    expect(order()).toEqual({ lookup: "abcd", playlist: "abcd" });
    await t.history.redo();
    await t.history.undo();
    t.db.exec("VACUUM");
    expect(order()).toEqual({ lookup: "abcd", playlist: "abcd" });
    expect([b, d].map((x) => tracks.getTrack(t.store, x.id)!.title)).toEqual(["b", "d"]);
  });

  it("names each step so the interface can say what Undo will do", async () => {
    const [track] = tracks.createTracks(t.store, [{ title: "A", file: { path: "/a.mp3" } }, { title: "B", file: { path: "/b.mp3" } }]);
    await tracks.deleteTracks(t.store, [track.id]);
    expect(t.history.state()).toEqual({ canUndo: true, canRedo: false, undoLabel: "Delete 1 track", redoLabel: null });
    expect(await t.history.undo()).toBe("Delete 1 track");
    expect(t.history.state()).toEqual({ canUndo: true, canRedo: true, undoLabel: "Add 2 tracks", redoLabel: "Delete 1 track" });
  });

  it("restores a deleted track with its playlists, boards, tags, markers, links and scenes", async () => {
    const f = await fixture(t.store);
    const before = snapshot(t.store);
    await tracks.deleteTracks(t.store, [f.a.id]);
    expect(tracks.getTrack(t.store, f.a.id)).toBeNull();
    await t.history.undo();
    expect(snapshot(t.store)).toEqual(before);
    expect(search(t.store, "swell").map((hit) => hit.title)).toEqual(["Alpha"]);
    expect(search(t.store, "baddie").map((hit) => hit.title).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("keeps at least 50 steps (default 100) and drops the oldest beyond the limit", async () => {
    const small = setup(3);
    const ids = Array.from({ length: 5 }, (_, i) => campaigns.createCampaign(small.store, { name: `C${i}` }).id);
    expect(await small.history.undo()).toBe('Add campaign "C4"');
    await small.history.undo();
    await small.history.undo();
    expect(await small.history.undo()).toBeNull();
    expect(campaigns.listCampaigns(small.store).map((c) => c.id)).toEqual(ids.slice(0, 2));
    small.db.close();

    for (let i = 0; i < 100; i++) campaigns.createCampaign(t.store, { name: `C${i}` });
    let undone = 0;
    while ((await t.history.undo()) !== null) undone++;
    expect(undone).toBe(100);
    expect(campaigns.listCampaigns(t.store)).toEqual([]);
  });

  it("clears redo when a new change is made", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    await t.history.undo();
    campaigns.createCampaign(t.store, { name: "B" });
    expect(t.history.state().canRedo).toBe(false);
    expect(await t.history.redo()).toBeNull();
  });

  it("records nothing for a change that fails, and nothing for a change that changes nothing", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    expect(() =>
      t.store.change("Broken", () => {
        campaigns.createCampaign(t.store, { name: "B" });
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(campaigns.listCampaigns(t.store).map((c) => c.name)).toEqual(["A"]);
    expect(t.history.state().undoLabel).toBe('Add campaign "A"');
    t.store.change("Nothing", (): void => undefined);
    expect(t.history.state().undoLabel).toBe('Add campaign "A"');
  });

  it("keeps a change made of several commands as one step", async () => {
    t.store.change("Prepare session", () => {
      const c = campaigns.createCampaign(t.store, { name: "A" });
      const s = campaigns.createSession(t.store, { campaignId: c.id, name: "S" });
      campaigns.createScene(t.store, { sessionId: s.id, name: "Sc" });
    });
    expect(await t.history.undo()).toBe("Prepare session");
    expect(campaigns.listCampaigns(t.store)).toEqual([]);
    expect(t.history.state().canUndo).toBe(false);
  });

  it("does not record 'last used', and undoing an edit leaves 'last used' alone", async () => {
    const track = tracks.createTrack(t.store, { title: "A", file: { path: "/a.mp3" } });
    tracks.updateTrack(t.store, track.id, { title: "B" });
    tracks.markTracksUsed(t.store, [track.id], 777);
    expect(t.history.state().undoLabel).toBe("Edit track");
    await t.history.undo();
    expect(tracks.getTrack(t.store, track.id)).toMatchObject({ title: "A", lastUsedAt: 777 });
  });

  it("refuses to undo in the middle of a change and keeps the step for later", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    expect(() => t.store.change("x", () => t.history.undo())).toThrow(/while a change/);
    expect(t.history.state().undoLabel).toBe('Add campaign "A"');
    expect(await t.history.undo()).toBe('Add campaign "A"');
  });

  it("drops a step that cannot be undone, so the steps before it still can", async () => {
    campaigns.createCampaign(t.store, { name: "First" });
    const c = campaigns.createCampaign(t.store, { name: "A" });
    // Something outside the history took the id of the row undo would bring back.
    campaigns.deleteCampaign(t.store, c.id);
    t.store.changeWithoutHistory(() =>
      t.store.run("INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES (?, 'X', 1, 1, 1)", c.id),
    );
    await expect(t.history.undo()).rejects.toThrow();
    expect(campaigns.getCampaign(t.store, c.id)!.name).toBe("X");
    // Before: the failed step went back on top and every later undo failed the same way.
    expect(t.history.state()).toMatchObject({ undoLabel: 'Add campaign "A"', canRedo: false });
    expect(await t.history.undo()).toBe('Add campaign "A"');
    expect(campaigns.getCampaign(t.store, c.id)).toBeNull();
  });

  it("records no step when the commit itself fails, and keeps redo (review 4)", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    campaigns.createCampaign(t.store, { name: "C" });
    await t.history.undo();
    failNextExec(t.db, "COMMIT", "database or disk is full");

    expect(() => campaigns.createCampaign(t.store, { name: "B" })).toThrow("database or disk is full");

    expect(campaigns.listCampaigns(t.store).map((c) => c.name)).toEqual(["A"]);
    expect(t.history.state()).toEqual({
      canUndo: true,
      canRedo: true,
      undoLabel: 'Add campaign "A"',
      redoLabel: 'Add campaign "C"',
    });
    expect(await t.history.undo()).toBe('Add campaign "A"');
    expect(campaigns.listCampaigns(t.store)).toEqual([]);
  });

  it("drops an undo step whose commit fails instead of putting it back", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    campaigns.createCampaign(t.store, { name: "B" });
    failNextExec(t.db, "COMMIT", "disk I/O error");

    await expect(t.history.undo()).rejects.toThrow("disk I/O error");

    expect(campaigns.listCampaigns(t.store).map((c) => c.name)).toEqual(["A", "B"]);
    expect(t.history.state()).toMatchObject({ undoLabel: 'Add campaign "A"', canRedo: false });
  });

  it("passes on the real error when SQLite has already rolled the change back (review 5)", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    // SQLite ends the transaction by itself on some errors (full disk, I/O
    // error, out of memory); an explicit ROLLBACK then fails with "no
    // transaction is active", which used to hide the real error.
    expect(() =>
      t.store.change("Broken", () => {
        campaigns.createCampaign(t.store, { name: "B" });
        t.db.exec("ROLLBACK");
        throw new Error("database or disk is full");
      }),
    ).toThrow("database or disk is full");
    expect(() =>
      t.store.changeWithoutHistory(() => {
        t.db.exec("ROLLBACK");
        throw new Error("disk I/O error");
      }),
    ).toThrow("disk I/O error");

    // The store and the history still work afterwards.
    expect(t.store.inChange).toBe(false);
    campaigns.createCampaign(t.store, { name: "C" });
    expect(await t.history.undo()).toBe('Add campaign "C"');
    expect(campaigns.listCampaigns(t.store).map((c) => c.name)).toEqual(["A"]);
  });

  it("passes on the real error when SQLite has already rolled an undo back", async () => {
    campaigns.createCampaign(t.store, { name: "A" });
    const run = t.store.run.bind(t.store);
    let failed = false;
    t.store.run = (sql, ...params) => {
      if (!failed) {
        failed = true;
        t.db.exec("ROLLBACK");
        throw new Error("disk I/O error");
      }
      return run(sql, ...params);
    };
    await expect(t.history.undo()).rejects.toThrow("disk I/O error");
    expect(t.db.isTransaction).toBe(false);
    expect(campaigns.listCampaigns(t.store).map((c) => c.name)).toEqual(["A"]);
  });

  it("follows tables added by a later schema version", async () => {
    const later: Migration = {
      version: MIGRATIONS.length + 1,
      name: "cue lists (test stand-in)",
      up(db) {
        db.exec("CREATE TABLE cue_lists (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
      },
    };
    const db = openConnection(":memory:");
    migrate(db, [...MIGRATIONS, later]);
    const store = new Store(db);
    const history = new UndoHistory(store);
    store.change("Add cue list", () => store.run("INSERT INTO cue_lists VALUES ('q1', 'Main')"));
    await history.undo();
    expect(store.all("SELECT * FROM cue_lists")).toEqual([]);
    await history.redo();
    expect(store.all("SELECT * FROM cue_lists")).toEqual([{ id: "q1", name: "Main" }]);
    db.close();
  });

  it("leaves derived and bookkeeping tables out of the history", async () => {
    const names = undoableTables(t.db).map((table) => table.name);
    expect(names).toContain("tracks");
    expect(names).not.toContain("search_docs");
    expect(names).not.toContain("search_fts");
    expect(names).not.toContain("schema_migrations");
    expect(names.some((name) => name.startsWith("search_fts_"))).toBe(false);
  });
});
