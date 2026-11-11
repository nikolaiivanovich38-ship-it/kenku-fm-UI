import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createTracks } from "./tracks";
import { getDomainLookup } from "./domain";
import { createPlaylist } from "./playlists";
import { addPad, createBoard } from "./boards";
import {
  createTag,
  createTagGroup,
  deleteTag,
  deleteTagGroup,
  getTag,
  listTagGroups,
  listTags,
  mergeTags,
  moveTag,
  moveTagGroup,
  setTagSynonyms,
  suggestTags,
  tagTracks,
  tagUsage,
  tagsOfTrack,
  untagTracks,
  updateTag,
  updateTagGroup,
} from "./tags";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

const group = (name: string) => listTagGroups(t.store).find((g) => g.name === name)!;
const tag = (name: string) => listTags(t.store).find((x) => x.name === name)!;

describe("tag groups (DAT-10)", () => {
  it("adds, renames, colours, reorders and deletes groups", async () => {
    const weather = createTagGroup(t.store, { name: "Weather", color: "sea" });
    moveTagGroup(t.store, weather.id, { before: group("Mood").id });
    updateTagGroup(t.store, group("Scene type").id, { name: "Scene" });
    expect(listTagGroups(t.store).map((g) => g.name)).toEqual(["Weather", "Mood", "Leitmotif", "Scene"]);
    expect(() => createTagGroup(t.store, { name: "mood" })).toThrow(/already/);
    await deleteTagGroup(t.store, weather.id);
    expect(listTagGroups(t.store)).toHaveLength(3);
  });

  it("deleting a group removes its tags from every track in one go", async () => {
    const [a] = createTracks(t.store, [{ title: "A", file: { path: "/m/a.mp3" } }]);
    await tagTracks(t.store, [a.id], [tag("Heroic").id, tag("Eerie").id]);
    await deleteTagGroup(t.store, group("Mood").id);
    expect(tagsOfTrack(t.store, a.id)).toEqual([]);
  });
});

describe("tags (DAT-10)", () => {
  it("nests tags under a parent in the same group, with synonyms", async () => {
    const leitmotif = group("Leitmotif");
    const villain = createTag(t.store, { groupId: leitmotif.id, name: "Villain" });
    const strahd = createTag(t.store, { groupId: leitmotif.id, name: "Strahd", parentId: villain.id, color: "ember" });
    expect(getTag(t.store, strahd.id)).toMatchObject({ parentId: villain.id, color: "ember", synonyms: [] });
    setTagSynonyms(t.store, tag("Melancholy").id, ["sad", "Sorrowful", "sad"]);
    expect(getTag(t.store, tag("Melancholy").id)!.synonyms).toEqual(["sad", "Sorrowful"]);
    expect(() => createTag(t.store, { groupId: group("Mood").id, name: "x", parentId: villain.id })).toThrow(/same group/);
    expect(() => createTag(t.store, { groupId: leitmotif.id, name: "villain" })).toThrow(/already/);
    expect(() => updateTag(t.store, villain.id, { parentId: strahd.id })).toThrow(/inside itself/);
  });

  it("moving a tag to another group takes its sub-tags along", async () => {
    const leitmotif = group("Leitmotif");
    const faction = createTagGroup(t.store, { name: "Faction" });
    const villain = createTag(t.store, { groupId: leitmotif.id, name: "Villain" });
    const strahd = createTag(t.store, { groupId: leitmotif.id, name: "Strahd", parentId: villain.id });
    updateTag(t.store, villain.id, { groupId: faction.id });
    expect(getTag(t.store, villain.id)).toMatchObject({ groupId: faction.id, parentId: null });
    expect(getTag(t.store, strahd.id)).toMatchObject({ groupId: faction.id, parentId: villain.id });
  });

  it("tags and untags several tracks in one step and lists a track's tags by group order", async () => {
    const [a, b] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
    ]);
    const docks = createTag(t.store, { groupId: group("Scene type").id, name: "Docks" });
    await tagTracks(t.store, [a.id, b.id], [docks.id, tag("Tense").id]);
    await tagTracks(t.store, [a.id], [docks.id]); // already there: no error, no duplicate
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Tense", "Docks"]);
    await untagTracks(t.store, [a.id], [tag("Tense").id]);
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Docks"]);
    expect(tagsOfTrack(t.store, b.id).map((x) => x.name)).toEqual(["Tense", "Docks"]);
    expect(() => tagTracks(t.store, [a.id], ["missing"])).toThrow(/No tag/);
  });

  it("DAT-10: a track lists its tags in vocabulary order, whatever order they were added in", async () => {
    const [a] = createTracks(t.store, [{ title: "A", file: { path: "/m/a.mp3" } }]);
    const names = () => tagsOfTrack(t.store, a.id).map((x) => x.name);
    // Vocabulary: Mood (Melancholy, Heroic, Tense, Wistful, Warm, Triumphant, Eerie), then Leitmotif, then Scene type.
    const motif = createTag(t.store, { groupId: group("Leitmotif").id, name: "Abbess" });
    await tagTracks(t.store, [a.id], [motif.id]);
    await tagTracks(t.store, [a.id], [tag("Eerie").id]);
    await tagTracks(t.store, [a.id], [tag("Tense").id, tag("Heroic").id]);
    expect(names()).toEqual(["Heroic", "Tense", "Eerie", "Abbess"]);
    expect(getDomainLookup(t.store).track(a.id)?.tags[group("Mood").id]).toEqual(["Heroic", "Tense", "Eerie"]);
    // Taken off and added again: back in its place.
    await untagTracks(t.store, [a.id], [tag("Heroic").id]);
    await tagTracks(t.store, [a.id], [tag("Heroic").id]);
    expect(names()).toEqual(["Heroic", "Tense", "Eerie", "Abbess"]);
    // Moved in the vocabulary: it moves on the track too.
    moveTag(t.store, tag("Eerie").id, { before: tag("Heroic").id });
    expect(names()).toEqual(["Eerie", "Heroic", "Tense", "Abbess"]);
    expect(getDomainLookup(t.store).track(a.id)?.tags[group("Mood").id]).toEqual(["Eerie", "Heroic", "Tense"]);
  });

  it("DAT-10: a tag inside another is listed right after it, depth first, as on the Tags screen", async () => {
    const [a] = createTracks(t.store, [{ title: "A", file: { path: "/m/a.mp3" } }]);
    // Saved order: Melancholy, Heroic, Tense, Wistful, Warm, Triumphant, Eerie. Eerie goes inside Melancholy and
    // Wistful inside Eerie: the screen lists Melancholy › Eerie › Wistful, then Heroic, Tense, Warm, Triumphant.
    updateTag(t.store, tag("Eerie").id, { parentId: tag("Melancholy").id });
    updateTag(t.store, tag("Wistful").id, { parentId: tag("Eerie").id });
    await tagTracks(t.store, [a.id], [tag("Heroic").id, tag("Wistful").id, tag("Tense").id, tag("Melancholy").id, tag("Eerie").id]);
    const shown = ["Melancholy", "Eerie", "Wistful", "Heroic", "Tense"];
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(shown);
    expect(getDomainLookup(t.store).track(a.id)?.tags[group("Mood").id]).toEqual(shown);
    // Without its parent on the track, a tag inside still sits where the screen has it.
    await untagTracks(t.store, [a.id], [tag("Melancholy").id, tag("Eerie").id]);
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Wistful", "Heroic", "Tense"]);
  });

  it("DAT-10: after a merge each track lists the merged tag in its vocabulary place", async () => {
    const [a, b] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
    ]);
    // Vocabulary: Melancholy, Heroic, Tense, Wistful, Warm, Triumphant, Eerie. B gets Eerie first, then Melancholy and Warm.
    await tagTracks(t.store, [a.id], [tag("Melancholy").id, tag("Warm").id]);
    await tagTracks(t.store, [b.id], [tag("Eerie").id]);
    await tagTracks(t.store, [b.id], [tag("Melancholy").id, tag("Warm").id]);
    await mergeTags(t.store, [tag("Melancholy").id], tag("Eerie").id);
    // Eerie is last in the vocabulary, so it comes after Warm on both, never in Melancholy's place.
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Warm", "Eerie"]);
    expect(tagsOfTrack(t.store, b.id).map((x) => x.name)).toEqual(["Warm", "Eerie"]);
    expect(getDomainLookup(t.store).track(b.id)?.tags[group("Mood").id]).toEqual(["Warm", "Eerie"]);
  });

  it("renames, reorders and deletes tags", async () => {
    const warm = tag("Warm");
    updateTag(t.store, warm.id, { name: "Cosy" });
    moveTag(t.store, warm.id, "start");
    expect(listTags(t.store, { groupId: group("Mood").id }).map((x) => x.name)[0]).toBe("Cosy");
    await deleteTag(t.store, warm.id);
    expect(listTags(t.store, { groupId: group("Mood").id }).map((x) => x.name)).not.toContain("Cosy");
  });

  it("DAT-10: deleting a tag moves the tags inside it up a level, to where it was", async () => {
    const mood = group("Mood").id;
    const sorrow = createTag(t.store, { groupId: mood, name: "Sorrow", parentId: tag("Melancholy").id });
    const grief = createTag(t.store, { groupId: mood, name: "Grief", parentId: sorrow.id });
    await deleteTag(t.store, sorrow.id);
    expect(getTag(t.store, grief.id)!.parentId).toBe(tag("Melancholy").id);
    await deleteTag(t.store, tag("Melancholy").id);
    expect(getTag(t.store, grief.id)!.parentId).toBeNull();
  });

  it("merges tags: tracks move to the kept tag and the old names become synonyms", async () => {
    const [a, b] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
    ]);
    const sad = createTag(t.store, { groupId: group("Mood").id, name: "Sad" });
    const gloomy = createTag(t.store, { groupId: group("Mood").id, name: "Gloomy", synonyms: ["dour"] });
    const child = createTag(t.store, { groupId: group("Mood").id, name: "Grief", parentId: sad.id });
    await tagTracks(t.store, [a.id], [sad.id]);
    await tagTracks(t.store, [a.id, b.id], [gloomy.id, tag("Melancholy").id]);
    await mergeTags(t.store, [sad.id, gloomy.id], tag("Melancholy").id);
    expect(getTag(t.store, sad.id)).toBeNull();
    expect(getTag(t.store, gloomy.id)).toBeNull();
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Melancholy"]);
    expect(tagsOfTrack(t.store, b.id).map((x) => x.name)).toEqual(["Melancholy"]);
    expect(getTag(t.store, tag("Melancholy").id)!.synonyms).toEqual(["dour", "Gloomy", "Sad"]);
    expect(getTag(t.store, child.id)!.parentId).toBe(tag("Melancholy").id);
    expect(() => mergeTags(t.store, [tag("Melancholy").id], tag("Melancholy").id)).toThrow(ValidationError);
  });

  it("suggests tags while typing, by name or synonym, grouped", async () => {
    setTagSynonyms(t.store, tag("Melancholy").id, ["sad"]);
    createTag(t.store, { groupId: group("Scene type").id, name: "Sadovaya Street" });
    expect(suggestTags(t.store, "sa").map((s) => [s.groupName, s.tag.name, s.matched])).toEqual([
      ["Mood", "Melancholy", "sad"],
      ["Scene type", "Sadovaya Street", "Sadovaya Street"],
    ]);
    expect(suggestTags(t.store, "TRI").map((s) => s.tag.name)).toEqual(["Triumphant"]);
    expect(suggestTags(t.store, "  ")).toEqual([]);
    expect(suggestTags(t.store, "%")).toEqual([]);
  });
});

describe("where a tag is used (DB review 2)", () => {
  it("lists the rules and tag pads that use a tag, and how many tracks carry it, before it is deleted", async () => {
    const mood = group("Mood");
    const eerie = tag("Eerie");
    const [a, b] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
    ]);
    await tagTracks(t.store, [a.id, b.id], [eerie.id]);
    const crypt = createPlaylist(t.store, { title: "Crypt", kind: "dynamic", rule: { conds: [{ group: mood.id, match: "any", values: ["Eerie", "Tense"] }] } });
    createPlaylist(t.store, { title: "Tavern", kind: "dynamic", rule: { conds: [{ group: mood.id, match: "none", values: ["Warm"] }] } });
    const abbey = createPlaylist(t.store, { title: "Abbey", kind: "dynamic", rule: { conds: [{ group: mood.id, match: "none", values: ["Eerie"] }] } });
    const board = createBoard(t.store, { title: "Spooks" });
    const pad = addPad(t.store, board.id, { label: "Whispers", sound: { kind: "tag", tagId: eerie.id } });
    addPad(t.store, board.id, { label: "Other", sound: { kind: "tag", tagId: tag("Tense").id } });

    expect(tagUsage(t.store, eerie.id)).toEqual({
      tracks: 2,
      playlists: [
        { id: abbey.id, title: "Abbey" },
        { id: crypt.id, title: "Crypt" },
      ],
      pads: [{ id: pad.id, label: "Whispers", boardId: board.id, boardTitle: "Spooks" }],
    });
    expect(tagUsage(t.store, tag("Heroic").id)).toEqual({ tracks: 0, playlists: [], pads: [] });
    expect(() => tagUsage(t.store, "missing")).toThrow(/tag/);
  });
});
