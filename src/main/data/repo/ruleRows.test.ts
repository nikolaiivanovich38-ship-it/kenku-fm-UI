/**
 * DB review item 2: the database works out a dynamic playlist exactly as the
 * shared rule does (matchesRule, playlistTracks in src/common/domain), for every
 * kind of condition, including a saved condition with no tags, which matches
 * nothing (deleting a tag must never widen a playlist to its whole lane).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playlistTracks, type Lane, type PlaylistRule, type TrackKind, type TrackRole } from "../../../common/domain";
import { makeTestStore } from "../test/testStore";
import { getDomainLookup } from "./domain";
import { createPlaylist, listPlaylistTrackIds } from "./playlists";
import { createTag, createTagGroup, deleteTag, listTagGroups, listTags, tagTracks } from "./tags";
import { createTracks } from "./tracks";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

type Spec = { kind: TrackKind; role?: TrackRole; energy?: number; mood?: string[]; place?: string[] };

/** Every mix the rules look at: kinds, stings, energies (none counts as 0), tags in two groups, no tags. */
const SPECS: Spec[] = [
  { kind: "music", energy: 1, mood: ["Eerie"] },
  { kind: "music", energy: 3, mood: ["Eerie", "Tense"], place: ["Crypt"] },
  { kind: "music", mood: ["Tense"] },
  { kind: "music", energy: 5, role: "sting", mood: ["Eerie"] },
  { kind: "music", energy: 2, place: ["Tavern"] },
  { kind: "music", energy: 4 },
  { kind: "amb", energy: 1, mood: ["Eerie"], place: ["Crypt"] },
  { kind: "amb", place: ["Tavern"] },
  { kind: "fx", energy: 2, mood: ["Tense"] },
  { kind: "fx", role: "effect" },
];

async function library() {
  const [mood] = listTagGroups(t.store);
  const place = createTagGroup(t.store, { name: "Place" });
  for (const name of ["Crypt", "Tavern", "Harbour"]) createTag(t.store, { groupId: place.id, name });
  const tagId = (groupId: string, name: string) => listTags(t.store, { groupId }).find((x) => x.name === name)!.id;
  const tracks = createTracks(
    t.store,
    SPECS.map((s, i) => ({ title: `T${i}`, kind: s.kind, role: s.role ?? null, energy: s.energy ?? null, file: { path: `/m/${i}.flac` } })),
  );
  for (const [i, s] of SPECS.entries()) {
    const tags = [...(s.mood ?? []).map((n) => tagId(mood.id, n)), ...(s.place ?? []).map((n) => tagId(place.id, n))];
    if (tags.length) await tagTracks(t.store, [tracks[i].id], tags);
  }
  return { mood: mood.id, place: place.id };
}

/** Rule fixtures: [name, rule] for groups g (mood) and p (place). */
function fixtures(g: string, p: string): [string, PlaylistRule][] {
  const cond = (group: string, match: "any" | "all" | "none", values: string[]) => ({ group, match, values });
  return [
    ["no conditions", { conds: [] }],
    ["any", { conds: [cond(g, "any", ["Eerie", "Tense"])] }],
    ["all", { conds: [cond(g, "all", ["Eerie", "Tense"])] }],
    ["none", { conds: [cond(g, "none", ["Eerie"])] }],
    ["none of several", { conds: [cond(g, "none", ["Eerie", "Tense"])] }],
    ["two groups", { conds: [cond(g, "any", ["Eerie"]), cond(p, "any", ["Crypt"])] }],
    ["any and none", { conds: [cond(g, "any", ["Eerie", "Tense"]), cond(p, "none", ["Tavern"])] }],
    ["a tag on no track", { conds: [cond(p, "any", ["Harbour"])] }],
    ["energy from 0", { conds: [], energy: [0, 2] }],
    ["energy from 3", { conds: [], energy: [3, 5] }],
    ["energy and tags", { conds: [cond(g, "any", ["Eerie"])], energy: [1, 3] }],
    ["no stings", { conds: [cond(g, "any", ["Eerie"])], leaveOutStings: true }],
    ["empty any", { conds: [cond(g, "any", [])] }],
    ["empty all", { conds: [cond(g, "all", [])] }],
    ["empty none", { conds: [cond(g, "none", [])] }],
    ["empty with others", { conds: [cond(g, "any", ["Eerie"]), cond(p, "none", [])], energy: [0, 5] }],
  ];
}

describe("dynamic playlists in the database agree with the shared rule (DB review 2)", () => {
  it("gives the same tracks, in library order, for every rule fixture in every lane", async () => {
    const { mood, place } = await library();
    const lanes: Lane[] = ["music", "amb", "fx"];
    let compared = 0;
    for (const lane of lanes) {
      for (const [name, rule] of fixtures(mood, place)) {
        const playlist = createPlaylist(t.store, { title: `${lane} ${name}`, kind: "dynamic", lane, rule });
        const lookup = getDomainLookup(t.store);
        const expected = playlistTracks(lookup.playlist(playlist.id)!, lookup).map((x) => x.id);
        expect(listPlaylistTrackIds(t.store, playlist.id), `${lane}: ${name}`).toEqual(expected);
        compared++;
      }
    }
    expect(compared).toBe(48);
  });

  it("plays nothing once the last tag of a condition is deleted, instead of the whole lane", async () => {
    const { mood } = await library();
    const p = createPlaylist(t.store, { title: "Eerie", kind: "dynamic", rule: { conds: [{ group: mood, match: "any", values: ["Eerie"] }] } });
    expect(listPlaylistTrackIds(t.store, p.id)).toHaveLength(3);
    await deleteTag(t.store, listTags(t.store, { groupId: mood }).find((x) => x.name === "Eerie")!.id);
    expect(listPlaylistTrackIds(t.store, p.id)).toEqual([]);
  });
});
