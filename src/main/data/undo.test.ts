import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection } from "./sqlite";
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
import { search } from "./repo/search";

function setup(limit?: number) {
  const clock = makeClock();
  const db = openConnection(":memory:");
  migrate(db, MIGRATIONS, clock.now);
  const store = new Store(db, { now: clock.now });
  const history = new UndoHistory(store, { limit });
  return { db, store, history, clock };
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
    `SELECT d.kind, d.ref_id, f.title, f.file_name, f.tags, f.markers, f.notes, f.source
     FROM search_docs d JOIN search_fts f ON f.rowid = d.doc_id ORDER BY d.kind, d.ref_id`,
  );
  return result;
}

/** A small library with something of everything. */
function fixture(store: Store) {
  const root = roots.addRoot(store, { name: "Music", path: "/music" });
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
  const board = boards.createBoard(store, { title: "Fx" });
  const sounds = boards.addSoundsToBoard(store, board.id, [{ trackId: a.id, loop: true }, { trackId: b.id }]);
  const boardDivider = boards.addBoardDivider(store, board.id, "Doors");
  boards.createBoard(store, { title: "Ambience" });
  const mood = tags.listTagGroups(store)[0];
  const tense = tags.listTags(store, { groupId: mood.id })[2];
  const villain = tags.createTag(store, { groupId: mood.id, name: "Villain", synonyms: ["baddie"] });
  const strahd = tags.createTag(store, { groupId: mood.id, name: "Strahd", parentId: villain.id });
  tags.tagTracks(store, [a.id, b.id], [tense.id, villain.id]);
  tracks.setFollowWith(store, a.id, [b.id]);
  const campaign = campaigns.createCampaign(store, { name: "Strahd" });
  const otherCampaign = campaigns.createCampaign(store, { name: "Witcher" });
  campaigns.addToCampaign(store, campaign.id, { playlistIds: [playlist.id], boardIds: [board.id] });
  const session = campaigns.createSession(store, { campaignId: campaign.id, name: "S1" });
  campaigns.createSession(store, { campaignId: campaign.id, name: "S2" });
  const scene = campaigns.createScene(store, { sessionId: session.id, name: "Gates" });
  campaigns.createScene(store, { sessionId: session.id, name: "Village" });
  const sceneItems = campaigns.addSceneItems(store, scene.id, [{ playlistId: playlist.id }, { trackId: c.id }]);
  return {
    root, a, b, c, marker, folder, sub, playlist, items, divider, board, sounds, boardDivider,
    mood, tense, villain, strahd, campaign, otherCampaign, session, scene, sceneItems,
  };
}

type Fixture = ReturnType<typeof fixture>;

/** Every write command of the repository, run against the fixture. */
const COMMANDS: [string, (s: Store, f: Fixture) => unknown][] = [
  ["addRoot", (s) => roots.addRoot(s, { name: "Fx", path: "/fx" })],
  ["updateRoot", (s, f) => roots.updateRoot(s, f.root.id, { name: "Songs", path: "/songs" })],
  ["removeRoot", (s, f) => roots.removeRoot(s, f.root.id)],
  ["createTrack", (s) => tracks.createTrack(s, { title: "Delta", url: "https://example.com/d.mp3" })],
  ["createTracks", (s) => tracks.createTracks(s, [{ title: "D", file: { path: "/d.mp3" } }, { title: "E", file: { path: "/e.mp3" } }])],
  ["updateTrack", (s, f) => tracks.updateTrack(s, f.a.id, { title: "Alpha 2", energy: 3, transitionIn: { kind: "cut" } })],
  ["updateTrack (relocate)", (s, f) => tracks.updateTrack(s, f.c.id, { file: { path: "/music/sub/c.mp3", size: 5 } })],
  ["deleteTracks", (s, f) => tracks.deleteTracks(s, [f.a.id, f.c.id])],
  ["setFollowWith", (s, f) => tracks.setFollowWith(s, f.a.id, [f.c.id, f.b.id])],
  ["addMarker", (s, f) => markers.addMarker(s, f.b.id, { timeMs: 5, kind: "loop_in" })],
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
  ["createBoard", (s) => boards.createBoard(s, { title: "Weather" })],
  ["updateBoard", (s, f) => boards.updateBoard(s, f.board.id, { title: "Effects" })],
  ["moveBoard", (s, f) => boards.moveBoard(s, f.board.id, { placement: "end" })],
  ["deleteBoard", (s, f) => boards.deleteBoard(s, f.board.id)],
  ["addSoundsToBoard", (s, f) => boards.addSoundsToBoard(s, f.board.id, [{ trackId: f.c.id, volume: 0.5 }])],
  ["addBoardDivider", (s, f) => boards.addBoardDivider(s, f.board.id, "Doors")],
  ["renameBoardDivider", (s, f) => boards.renameBoardDivider(s, f.boardDivider.id, "Windows")],
  ["updateBoardSound", (s, f) => boards.updateBoardSound(s, f.sounds[0].id, { volume: 0.2, fadeOutMs: 900 })],
  ["moveBoardItems", (s, f) => boards.moveBoardItems(s, [f.sounds[0].id], "end")],
  ["removeBoardItems", (s, f) => boards.removeBoardItems(s, [f.sounds[1].id])],
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
  ["addToCampaign", (s, f) => campaigns.addToCampaign(s, f.otherCampaign.id, { playlistIds: [f.playlist.id] })],
  ["removeFromCampaign", (s, f) => campaigns.removeFromCampaign(s, f.campaign.id, { playlistIds: [f.playlist.id], boardIds: [f.board.id] })],
  ["createSession", (s, f) => campaigns.createSession(s, { campaignId: f.campaign.id, name: "S2", playedOn: "2026-11-07" })],
  ["updateSession", (s, f) => campaigns.updateSession(s, f.session.id, { name: "Session 1", playedOn: "2026-11-01" })],
  ["moveSession", (s, f) => campaigns.moveSession(s, f.session.id, { placement: "end" })],
  ["deleteSession", (s, f) => campaigns.deleteSession(s, f.session.id)],
  ["createScene", (s, f) => campaigns.createScene(s, { sessionId: f.session.id, name: "Castle" })],
  ["updateScene", (s, f) => campaigns.updateScene(s, f.scene.id, { notes: "fog" })],
  ["moveScene", (s, f) => campaigns.moveScene(s, f.scene.id, { placement: "end" })],
  ["deleteScene", (s, f) => campaigns.deleteScene(s, f.scene.id)],
  ["addSceneItems", (s, f) => campaigns.addSceneItems(s, f.scene.id, [{ boardId: f.board.id }], "start")],
  ["moveSceneItem", (s, f) => campaigns.moveSceneItem(s, f.sceneItems[1].id, "start")],
  ["removeSceneItems", (s, f) => campaigns.removeSceneItems(s, [f.sceneItems[0].id])],
];

describe("undo and redo of every command (EDT-2)", () => {
  it.each(COMMANDS)("%s is one step that undoes and redoes exactly", (_name, command) => {
    const f = fixture(t.store);
    t.history.clear();
    const before = snapshot(t.store);
    t.clock.advance(60_000);
    command(t.store, f);
    const after = snapshot(t.store);
    expect(after).not.toEqual(before);
    expect(t.history.state()).toMatchObject({ canUndo: true, canRedo: false });

    expect(t.history.undo()).toEqual(expect.any(String));
    expect(snapshot(t.store)).toEqual(before);
    expect(t.history.state()).toMatchObject({ canUndo: false, canRedo: true });

    t.history.redo();
    expect(snapshot(t.store)).toEqual(after);
    t.history.undo();
    expect(snapshot(t.store)).toEqual(before);
  });

  it("covers every exported write function", () => {
    const modules = { tracks, roots, markers, playlists, boards, folders, tags, campaigns };
    const readers = /^(get|list|track|campaignsOf|resolve|suggest|tagsOf|requireFolderFor|getFollowWith|ITEM_TABLES)/;
    const writers = Object.values(modules)
      .flatMap((m) => Object.keys(m))
      .filter((name) => !readers.test(name) && name !== "markTracksUsed");
    const covered = new Set(COMMANDS.map(([name]) => name.split(" ")[0]));
    expect(writers.filter((name) => !covered.has(name))).toEqual([]);
  });
});

describe("undo history", () => {
  it("names each step so the interface can say what Undo will do", () => {
    const [track] = tracks.createTracks(t.store, [{ title: "A", file: { path: "/a.mp3" } }, { title: "B", file: { path: "/b.mp3" } }]);
    tracks.deleteTracks(t.store, [track.id]);
    expect(t.history.state()).toEqual({ canUndo: true, canRedo: false, undoLabel: "Delete 1 track", redoLabel: null });
    expect(t.history.undo()).toBe("Delete 1 track");
    expect(t.history.state()).toEqual({ canUndo: true, canRedo: true, undoLabel: "Add 2 tracks", redoLabel: "Delete 1 track" });
  });

  it("restores a deleted track with its playlists, boards, tags, markers, links and scenes", () => {
    const f = fixture(t.store);
    const before = snapshot(t.store);
    tracks.deleteTracks(t.store, [f.a.id]);
    expect(tracks.getTrack(t.store, f.a.id)).toBeNull();
    t.history.undo();
    expect(snapshot(t.store)).toEqual(before);
    expect(search(t.store, "swell").map((hit) => hit.title)).toEqual(["Alpha"]);
    expect(search(t.store, "baddie").map((hit) => hit.title).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("keeps at least 50 steps (default 100) and drops the oldest beyond the limit", () => {
    const small = setup(3);
    const ids = Array.from({ length: 5 }, (_, i) => campaigns.createCampaign(small.store, { name: `C${i}` }).id);
    expect(small.history.undo()).toBe('Add campaign "C4"');
    small.history.undo();
    small.history.undo();
    expect(small.history.undo()).toBeNull();
    expect(campaigns.listCampaigns(small.store).map((c) => c.id)).toEqual(ids.slice(0, 2));
    small.db.close();

    for (let i = 0; i < 100; i++) campaigns.createCampaign(t.store, { name: `C${i}` });
    let undone = 0;
    while (t.history.undo() !== null) undone++;
    expect(undone).toBe(100);
    expect(campaigns.listCampaigns(t.store)).toEqual([]);
  });

  it("clears redo when a new change is made", () => {
    campaigns.createCampaign(t.store, { name: "A" });
    t.history.undo();
    campaigns.createCampaign(t.store, { name: "B" });
    expect(t.history.state().canRedo).toBe(false);
    expect(t.history.redo()).toBeNull();
  });

  it("records nothing for a change that fails, and nothing for a change that changes nothing", () => {
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

  it("keeps a change made of several commands as one step", () => {
    t.store.change("Prepare session", () => {
      const c = campaigns.createCampaign(t.store, { name: "A" });
      const s = campaigns.createSession(t.store, { campaignId: c.id, name: "S" });
      campaigns.createScene(t.store, { sessionId: s.id, name: "Sc" });
    });
    expect(t.history.undo()).toBe("Prepare session");
    expect(campaigns.listCampaigns(t.store)).toEqual([]);
    expect(t.history.state().canUndo).toBe(false);
  });

  it("does not record 'last used', and undoing an edit leaves 'last used' alone", () => {
    const track = tracks.createTrack(t.store, { title: "A", file: { path: "/a.mp3" } });
    tracks.updateTrack(t.store, track.id, { title: "B" });
    tracks.markTracksUsed(t.store, [track.id], 777);
    expect(t.history.state().undoLabel).toBe("Edit track");
    t.history.undo();
    expect(tracks.getTrack(t.store, track.id)).toMatchObject({ title: "A", lastUsedAt: 777 });
  });

  it("refuses to undo in the middle of a change, and keeps the step when an undo fails", () => {
    const c = campaigns.createCampaign(t.store, { name: "A" });
    expect(() => t.store.change("x", () => t.history.undo())).toThrow(/while a change/);
    // Something outside the history took the name of the row undo would bring back.
    campaigns.deleteCampaign(t.store, c.id);
    t.store.changeWithoutHistory(() =>
      t.store.run("INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES (?, 'X', 1, 1, 1)", c.id),
    );
    expect(() => t.history.undo()).toThrow();
    expect(t.history.state().undoLabel).toBe('Delete campaign "A"');
    expect(campaigns.getCampaign(t.store, c.id)!.name).toBe("X");
  });

  it("follows tables added by a later schema version", () => {
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
    history.undo();
    expect(store.all("SELECT * FROM cue_lists")).toEqual([]);
    history.redo();
    expect(store.all("SELECT * FROM cue_lists")).toEqual([{ id: "q1", name: "Main" }]);
    db.close();
  });

  it("leaves derived and bookkeeping tables out of the history", () => {
    const names = undoableTables(t.db).map((table) => table.name);
    expect(names).toContain("tracks");
    expect(names).not.toContain("search_docs");
    expect(names).not.toContain("search_fts");
    expect(names).not.toContain("schema_migrations");
    expect(names.some((name) => name.startsWith("search_fts_"))).toBe(false);
  });
});
