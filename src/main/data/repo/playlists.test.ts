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
  copyPlaylist,
  renamePlaylistDivider,
  updatePlaylist,
} from "./playlists";
import { deleteTag, listTagGroups, listTags, mergeTags, updateTag } from "./tags";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

/** Each call makes new files: the library keeps one track per file. */
let made = 0;
function tracks(n: number) {
  const first = made;
  made += n;
  return createTracks(
    t.store,
    Array.from({ length: n }, (_, i) => ({ title: `T${i + 1}`, file: { path: `/m/${first + i}/t${i + 1}.mp3` } })),
  );
}

const titles = (items: ReturnType<typeof listPlaylistItems>) =>
  items.map((item) => (item.kind === "track" ? item.title : `-- ${item.label}`));

describe("playlists", () => {
  it("creates, renames and orders playlists, keeping the background name", async () => {
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

  it("adds tracks at the end, the start or before an entry, and dividers between them", async () => {
    const [t1, t2, t3, t4] = tracks(4);
    const p = createPlaylist(t.store, { title: "Town" });
    const [first] = addTracksToPlaylist(t.store, p.id, [t1.id, t2.id]);
    addTracksToPlaylist(t.store, p.id, [t3.id], "start");
    addTracksToPlaylist(t.store, p.id, [t4.id], { before: first.id });
    addPlaylistDivider(t.store, p.id, "Night", { after: first.id });
    expect(titles(listPlaylistItems(t.store, p.id))).toEqual(["T3", "T4", "T1", "-- Night", "T2"]);
  });

  it("moves entries without renumbering the others", async () => {
    const p = createPlaylist(t.store, { title: "Town" });
    const items = addTracksToPlaylist(t.store, p.id, tracks(5).map((x) => x.id));
    const before = new Map(listPlaylistItems(t.store, p.id).map((item) => [item.id, item.position]));
    movePlaylistItems(t.store, [items[4].id], { after: items[0].id });
    const after = listPlaylistItems(t.store, p.id);
    expect(titles(after)).toEqual(["T1", "T5", "T2", "T3", "T4"]);
    const changed = after.filter((item) => before.get(item.id) !== item.position).map((item) => item.id);
    expect(changed).toEqual([items[4].id]);
  });

  it("moves several selected entries together, keeping their order", async () => {
    const p = createPlaylist(t.store, { title: "Town" });
    const items = addTracksToPlaylist(t.store, p.id, tracks(5).map((x) => x.id));
    movePlaylistItems(t.store, [items[3].id, items[1].id], "start");
    expect(titles(listPlaylistItems(t.store, p.id))).toEqual(["T2", "T4", "T1", "T3", "T5"]);
    expect(() => movePlaylistItems(t.store, [items[0].id], { before: items[0].id })).toThrow(/itself/);
  });

  it("allows a track in many playlists, and removing an entry never deletes the track", async () => {
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

  it("deleting a playlist keeps its tracks in the library (unlike the current player)", async () => {
    const p = createPlaylist(t.store, { title: "Town" });
    addTracksToPlaylist(t.store, p.id, tracks(3).map((x) => x.id));
    deletePlaylist(t.store, p.id);
    expect(getPlaylist(t.store, p.id)).toBeNull();
    expect(listTracks(t.store)).toHaveLength(3);
  });

  it("renames dividers and refuses entries that are not in the playlist", async () => {
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

  it("adds 500 tracks at once in one ordered block", async () => {
    const p = createPlaylist(t.store, { title: "Big" });
    const ids = tracks(500).map((x) => x.id);
    addTracksToPlaylist(t.store, p.id, ids);
    const items = listPlaylistItems(t.store, p.id);
    expect(items.map((item) => item.kind === "track" && item.trackId)).toEqual(ids);
  });
});

describe("design playlists: lanes, dynamic rules and notes (DAT-11)", () => {
  it("makes manual music playlists by default, with notes", async () => {
    const p = createPlaylist(t.store, { title: "Town" });
    expect(p).toMatchObject({ kind: "manual", lane: "music", rule: null, notes: "" });
    const amb = createPlaylist(t.store, { title: "Inn and hearth", lane: "amb", notes: "Low under speech" });
    expect(amb).toMatchObject({ lane: "amb", notes: "Low under speech" });
    expect(updatePlaylist(t.store, amb.id, { lane: "fx", notes: "" })).toMatchObject({ lane: "fx", notes: "" });
    expect(() => createPlaylist(t.store, { title: "x", lane: "voice" as never })).toThrow(ValidationError);
    expect(() => createPlaylist(t.store, { title: "x", kind: "smart" as never })).toThrow(ValidationError);
  });

  it("keeps a dynamic playlist's rule, checked, and refuses tracks added by hand", async () => {
    const mood = listTagGroups(t.store)[0];
    const rule = { conds: [{ group: mood.id, match: "any" as const, values: ["Eerie", "Tense"] }], energy: [0, 3] as [number, number], leaveOutStings: true };
    const p = createPlaylist(t.store, { title: "Abbey: eerie", kind: "dynamic", rule });
    expect(getPlaylist(t.store, p.id)).toMatchObject({ kind: "dynamic", rule });
    const changed = { conds: [{ group: mood.id, match: "all" as const, values: ["Wistful", "Warm"] }] };
    expect(updatePlaylist(t.store, p.id, { rule: changed }).rule).toEqual(changed);
    expect(() => addTracksToPlaylist(t.store, p.id, tracks(1).map((x) => x.id))).toThrow(/dynamic/);
    const bads: unknown[] = [
      null,
      { conds: "x" },
      { conds: [{ group: mood.id, match: "some", values: [] }] },
      { conds: [{ group: mood.id, match: "any", values: [3] }] },
      { conds: [], energy: [4, 2] },
      { conds: [], energy: [0, 9] },
      { conds: [], leaveOutStings: "yes" },
      { conds: [], extra: 1 },
    ];
    for (const bad of bads) {
      expect(() => updatePlaylist(t.store, p.id, { rule: bad as never }), JSON.stringify(bad)).toThrow(ValidationError);
    }
    expect(() => createPlaylist(t.store, { title: "No rule", kind: "dynamic" })).toThrow(ValidationError);
    // A rule names tags of its condition's group, in any case; another name is refused.
    expect(updatePlaylist(t.store, p.id, { rule: { conds: [{ group: mood.id, match: "any", values: ["eerie"] }] } }).rule).toEqual({
      conds: [{ group: mood.id, match: "any", values: ["Eerie"] }],
    });
    expect(() => updatePlaylist(t.store, p.id, { rule: { conds: [{ group: mood.id, match: "any", values: ["Seasick"] }] } })).toThrow(
      /no tag called "Seasick"/,
    );
    const manual = createPlaylist(t.store, { title: "Hand-picked" });
    expect(() => updatePlaylist(t.store, manual.id, { rule: changed })).toThrow(/manual/);
  });

  it("follows tag renames, merges and deletes in dynamic rules", async () => {
    const mood = listTagGroups(t.store)[0];
    const eerie = listTags(t.store, { groupId: mood.id }).find((x) => x.name === "Eerie")!;
    const tense = listTags(t.store, { groupId: mood.id }).find((x) => x.name === "Tense")!;
    const warm = listTags(t.store, { groupId: mood.id }).find((x) => x.name === "Warm")!;
    const p = createPlaylist(t.store, {
      title: "Gothic",
      kind: "dynamic",
      rule: { conds: [{ group: mood.id, match: "any", values: ["Eerie", "Tense", "Warm"] }] },
    });
    updateTag(t.store, eerie.id, { name: "Spooky" });
    await mergeTags(t.store, [tense.id], warm.id);
    expect(getPlaylist(t.store, p.id)!.rule!.conds[0].values).toEqual(["Spooky", "Warm"]);
    await deleteTag(t.store, warm.id);
    expect(getPlaylist(t.store, p.id)!.rule!.conds[0].values).toEqual(["Spooky"]);
  });

  it("copies a playlist; a dynamic one can become a manual list of what it matches now", async () => {
    const [a, b] = createTracks(t.store, [
      { title: "Bed", file: { path: "/m/bed.flac" }, energy: 2 },
      { title: "Battle", file: { path: "/m/battle.flac" }, energy: 5 },
    ]);
    const dyn = createPlaylist(t.store, { title: "Calm", kind: "dynamic", rule: { conds: [], energy: [1, 3] }, notes: "n" });
    const snapshot = copyPlaylist(t.store, dyn.id, { title: "Calm (fixed)", kind: "manual" });
    expect(snapshot).toMatchObject({ kind: "manual", lane: "music", notes: "n", title: "Calm (fixed)" });
    expect(listPlaylistItems(t.store, snapshot.id).map((i) => i.kind === "track" && i.trackId)).toEqual([a.id]);
    const copy = copyPlaylist(t.store, dyn.id, { title: "Calm 2" });
    expect(copy).toMatchObject({ kind: "dynamic", rule: { conds: [], energy: [1, 3] } });
    const manual = createPlaylist(t.store, { title: "Mix" });
    addTracksToPlaylist(t.store, manual.id, [b.id, a.id]);
    const manualCopy = copyPlaylist(t.store, manual.id, { title: "Mix 2" });
    expect(listPlaylistItems(t.store, manualCopy.id).map((i) => i.kind === "track" && i.trackId)).toEqual([b.id, a.id]);
    // The copy sits right after the original.
    expect(listPlaylists(t.store).map((x) => x.title)).toEqual(["Calm", "Calm 2", "Calm (fixed)", "Mix", "Mix 2"]);
  });
});
