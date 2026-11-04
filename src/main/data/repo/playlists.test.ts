import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createTracks, getTrack, listTracks } from "./tracks";
import {
  addPlaylistDivider,
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylistItems,
  listPlaylists,
  movePlaylist,
  movePlaylistItems,
  removePlaylistItems,
  renamePlaylistDivider,
  updatePlaylist,
} from "./playlists";
import {
  addBoardDivider,
  addSoundsToBoard,
  createBoard,
  deleteBoard,
  listBoardItems,
  listBoards,
  moveBoardItems,
  updateBoardSound,
} from "./boards";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

function tracks(n: number) {
  return createTracks(
    t.store,
    Array.from({ length: n }, (_, i) => ({ title: `T${i + 1}`, file: { path: `/m/t${i + 1}.mp3` } })),
  );
}

const titles = (items: ReturnType<typeof listPlaylistItems>) =>
  items.map((item) => (item.kind === "track" ? item.title : `-- ${item.label}`));

describe("playlists", () => {
  it("creates, renames and orders playlists, keeping the background name", () => {
    const a = createPlaylist(t.store, { title: "Town", background: "tavern" });
    const b = createPlaylist(t.store, { title: "Battle" });
    const c = createPlaylist(t.store, { title: "Intro", placement: "start" });
    expect(listPlaylists(t.store).map((p) => p.title)).toEqual(["Intro", "Town", "Battle"]);
    updatePlaylist(t.store, a.id, { title: "Town square", background: "https://example.com/bg.jpg" });
    expect(getPlaylist(t.store, a.id)).toMatchObject({ title: "Town square", background: "https://example.com/bg.jpg" });
    movePlaylist(t.store, b.id, { placement: { before: c.id } });
    expect(listPlaylists(t.store).map((p) => p.title)).toEqual(["Battle", "Intro", "Town square"]);
    expect(() => createPlaylist(t.store, { title: "" })).toThrow(ValidationError);
  });

  it("adds tracks at the end, the start or before an entry, and dividers between them", () => {
    const [t1, t2, t3, t4] = tracks(4);
    const p = createPlaylist(t.store, { title: "Town" });
    const [first] = addTracksToPlaylist(t.store, p.id, [t1.id, t2.id]);
    addTracksToPlaylist(t.store, p.id, [t3.id], "start");
    addTracksToPlaylist(t.store, p.id, [t4.id], { before: first.id });
    addPlaylistDivider(t.store, p.id, "Night", { after: first.id });
    expect(titles(listPlaylistItems(t.store, p.id))).toEqual(["T3", "T4", "T1", "-- Night", "T2"]);
  });

  it("moves entries without renumbering the others", () => {
    const p = createPlaylist(t.store, { title: "Town" });
    const items = addTracksToPlaylist(t.store, p.id, tracks(5).map((x) => x.id));
    const before = new Map(listPlaylistItems(t.store, p.id).map((item) => [item.id, item.position]));
    movePlaylistItems(t.store, [items[4].id], { after: items[0].id });
    const after = listPlaylistItems(t.store, p.id);
    expect(titles(after)).toEqual(["T1", "T5", "T2", "T3", "T4"]);
    const changed = after.filter((item) => before.get(item.id) !== item.position).map((item) => item.id);
    expect(changed).toEqual([items[4].id]);
  });

  it("moves several selected entries together, keeping their order", () => {
    const p = createPlaylist(t.store, { title: "Town" });
    const items = addTracksToPlaylist(t.store, p.id, tracks(5).map((x) => x.id));
    movePlaylistItems(t.store, [items[3].id, items[1].id], "start");
    expect(titles(listPlaylistItems(t.store, p.id))).toEqual(["T2", "T4", "T1", "T3", "T5"]);
    expect(() => movePlaylistItems(t.store, [items[0].id], { before: items[0].id })).toThrow(/itself/);
  });

  it("allows a track in many playlists, and removing an entry never deletes the track", () => {
    const [t1] = tracks(1);
    const p1 = createPlaylist(t.store, { title: "A" });
    const p2 = createPlaylist(t.store, { title: "B" });
    const [entry] = addTracksToPlaylist(t.store, p1.id, [t1.id]);
    addTracksToPlaylist(t.store, p2.id, [t1.id]);
    removePlaylistItems(t.store, [entry.id]);
    expect(listPlaylistItems(t.store, p1.id)).toEqual([]);
    expect(listPlaylistItems(t.store, p2.id)).toHaveLength(1);
    expect(getTrack(t.store, t1.id)).not.toBeNull();
  });

  it("deleting a playlist keeps its tracks in the library (unlike the current player)", () => {
    const p = createPlaylist(t.store, { title: "Town" });
    addTracksToPlaylist(t.store, p.id, tracks(3).map((x) => x.id));
    deletePlaylist(t.store, p.id);
    expect(getPlaylist(t.store, p.id)).toBeNull();
    expect(listTracks(t.store)).toHaveLength(3);
  });

  it("renames dividers and refuses entries that are not in the playlist", () => {
    const p = createPlaylist(t.store, { title: "Town" });
    const other = createPlaylist(t.store, { title: "Other" });
    const divider = addPlaylistDivider(t.store, p.id, "Act 1");
    renamePlaylistDivider(t.store, divider.id, "Act one");
    expect(listPlaylistItems(t.store, p.id)[0]).toMatchObject({ kind: "divider", label: "Act one" });
    const [entry] = addTracksToPlaylist(t.store, other.id, tracks(1).map((x) => x.id));
    expect(() => renamePlaylistDivider(t.store, entry.id, "x")).toThrow(/not a divider/);
    expect(() => addTracksToPlaylist(t.store, p.id, ["missing"])).toThrow(/No track/);
    expect(() => addTracksToPlaylist(t.store, "missing", [])).toThrow(/No playlist/);
    expect(() => addTracksToPlaylist(t.store, p.id, tracks(1).map((x) => x.id), { before: entry.id })).toThrow(
      /No item in this list/,
    );
  });

  it("adds 500 tracks at once in one ordered block", () => {
    const p = createPlaylist(t.store, { title: "Big" });
    const ids = tracks(500).map((x) => x.id);
    addTracksToPlaylist(t.store, p.id, ids);
    const items = listPlaylistItems(t.store, p.id);
    expect(items.map((item) => item.kind === "track" && item.trackId)).toEqual(ids);
  });
});

describe("soundboards", () => {
  it("keeps each sound's loop, volume and fades per board", () => {
    const [rain] = tracks(1);
    const b1 = createBoard(t.store, { title: "Weather", background: "forest" });
    const b2 = createBoard(t.store, { title: "Storm" });
    const [s1] = addSoundsToBoard(t.store, b1.id, [{ trackId: rain.id, loop: true, volume: 0.4, fadeInMs: 500, fadeOutMs: 2000 }]);
    addSoundsToBoard(t.store, b2.id, [{ trackId: rain.id }]);
    expect(listBoardItems(t.store, b1.id)[0]).toMatchObject({
      kind: "sound",
      trackId: rain.id,
      title: "T1",
      loop: true,
      volume: 0.4,
      fadeInMs: 500,
      fadeOutMs: 2000,
    });
    expect(listBoardItems(t.store, b2.id)[0]).toMatchObject({ loop: false, volume: 1, fadeInMs: 0, fadeOutMs: 0 });
    updateBoardSound(t.store, s1.id, { volume: 0.8, loop: false });
    expect(listBoardItems(t.store, b1.id)[0]).toMatchObject({ volume: 0.8, loop: false, fadeInMs: 500 });
    expect(() => updateBoardSound(t.store, s1.id, { volume: 1.5 })).toThrow(ValidationError);
    expect(() => updateBoardSound(t.store, s1.id, { fadeInMs: -1 })).toThrow(ValidationError);
  });

  it("orders sounds and dividers, and deleting a board keeps the tracks", () => {
    const [a, b] = tracks(2);
    const board = createBoard(t.store, { title: "Fx" });
    const [sa, sb] = addSoundsToBoard(t.store, board.id, [{ trackId: a.id }, { trackId: b.id }]);
    addBoardDivider(t.store, board.id, "Doors", { before: sb.id });
    moveBoardItems(t.store, [sa.id], "end");
    expect(
      listBoardItems(t.store, board.id).map((item) => (item.kind === "sound" ? item.title : `-- ${item.label}`)),
    ).toEqual(["-- Doors", "T2", "T1"]);
    expect(listBoards(t.store).map((x) => x.title)).toEqual(["Fx"]);
    deleteBoard(t.store, board.id);
    expect(listBoards(t.store)).toEqual([]);
    expect(listTracks(t.store)).toHaveLength(2);
  });
});
