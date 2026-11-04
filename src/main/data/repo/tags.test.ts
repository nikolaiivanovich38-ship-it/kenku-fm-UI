import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createTracks } from "./tracks";
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
  it("adds, renames, colours, reorders and deletes groups", () => {
    const weather = createTagGroup(t.store, { name: "Weather", color: "#336699" });
    moveTagGroup(t.store, weather.id, { before: group("Mood").id });
    updateTagGroup(t.store, group("Scene type").id, { name: "Scene" });
    expect(listTagGroups(t.store).map((g) => g.name)).toEqual(["Weather", "Mood", "Leitmotif", "Scene"]);
    expect(() => createTagGroup(t.store, { name: "mood" })).toThrow(/already/);
    deleteTagGroup(t.store, weather.id);
    expect(listTagGroups(t.store)).toHaveLength(3);
  });

  it("deleting a group removes its tags from every track in one go", () => {
    const [a] = createTracks(t.store, [{ title: "A", file: { path: "/m/a.mp3" } }]);
    tagTracks(t.store, [a.id], [tag("Heroic").id, tag("Eerie").id]);
    deleteTagGroup(t.store, group("Mood").id);
    expect(tagsOfTrack(t.store, a.id)).toEqual([]);
  });
});

describe("tags (DAT-10)", () => {
  it("nests tags under a parent in the same group, with synonyms", () => {
    const leitmotif = group("Leitmotif");
    const villain = createTag(t.store, { groupId: leitmotif.id, name: "Villain" });
    const strahd = createTag(t.store, { groupId: leitmotif.id, name: "Strahd", parentId: villain.id, color: "#880000" });
    expect(getTag(t.store, strahd.id)).toMatchObject({ parentId: villain.id, color: "#880000", synonyms: [] });
    setTagSynonyms(t.store, tag("Melancholy").id, ["sad", "Sorrowful", "sad"]);
    expect(getTag(t.store, tag("Melancholy").id)!.synonyms).toEqual(["sad", "Sorrowful"]);
    expect(() => createTag(t.store, { groupId: group("Mood").id, name: "x", parentId: villain.id })).toThrow(/same group/);
    expect(() => createTag(t.store, { groupId: leitmotif.id, name: "villain" })).toThrow(/already/);
    expect(() => updateTag(t.store, villain.id, { parentId: strahd.id })).toThrow(/inside itself/);
  });

  it("moving a tag to another group takes its sub-tags along", () => {
    const leitmotif = group("Leitmotif");
    const faction = createTagGroup(t.store, { name: "Faction" });
    const villain = createTag(t.store, { groupId: leitmotif.id, name: "Villain" });
    const strahd = createTag(t.store, { groupId: leitmotif.id, name: "Strahd", parentId: villain.id });
    updateTag(t.store, villain.id, { groupId: faction.id });
    expect(getTag(t.store, villain.id)).toMatchObject({ groupId: faction.id, parentId: null });
    expect(getTag(t.store, strahd.id)).toMatchObject({ groupId: faction.id, parentId: villain.id });
  });

  it("tags and untags several tracks in one step and lists a track's tags by group order", () => {
    const [a, b] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
    ]);
    const docks = createTag(t.store, { groupId: group("Scene type").id, name: "Docks" });
    tagTracks(t.store, [a.id, b.id], [docks.id, tag("Tense").id]);
    tagTracks(t.store, [a.id], [docks.id]); // already there: no error, no duplicate
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Tense", "Docks"]);
    untagTracks(t.store, [a.id], [tag("Tense").id]);
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Docks"]);
    expect(tagsOfTrack(t.store, b.id).map((x) => x.name)).toEqual(["Tense", "Docks"]);
    expect(() => tagTracks(t.store, [a.id], ["missing"])).toThrow(/No tag/);
  });

  it("renames, reorders and deletes tags", () => {
    const warm = tag("Warm");
    updateTag(t.store, warm.id, { name: "Cosy" });
    moveTag(t.store, warm.id, "start");
    expect(listTags(t.store, { groupId: group("Mood").id }).map((x) => x.name)[0]).toBe("Cosy");
    deleteTag(t.store, warm.id);
    expect(listTags(t.store, { groupId: group("Mood").id }).map((x) => x.name)).not.toContain("Cosy");
  });

  it("merges tags: tracks move to the kept tag and the old names become synonyms", () => {
    const [a, b] = createTracks(t.store, [
      { title: "A", file: { path: "/m/a.mp3" } },
      { title: "B", file: { path: "/m/b.mp3" } },
    ]);
    const sad = createTag(t.store, { groupId: group("Mood").id, name: "Sad" });
    const gloomy = createTag(t.store, { groupId: group("Mood").id, name: "Gloomy", synonyms: ["dour"] });
    const child = createTag(t.store, { groupId: group("Mood").id, name: "Grief", parentId: sad.id });
    tagTracks(t.store, [a.id], [sad.id]);
    tagTracks(t.store, [a.id, b.id], [gloomy.id, tag("Melancholy").id]);
    mergeTags(t.store, [sad.id, gloomy.id], tag("Melancholy").id);
    expect(getTag(t.store, sad.id)).toBeNull();
    expect(getTag(t.store, gloomy.id)).toBeNull();
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Melancholy"]);
    expect(tagsOfTrack(t.store, b.id).map((x) => x.name)).toEqual(["Melancholy"]);
    expect(getTag(t.store, tag("Melancholy").id)!.synonyms).toEqual(["dour", "Gloomy", "Sad"]);
    expect(getTag(t.store, child.id)!.parentId).toBe(tag("Melancholy").id);
    expect(() => mergeTags(t.store, [tag("Melancholy").id], tag("Melancholy").id)).toThrow(ValidationError);
  });

  it("suggests tags while typing, by name or synonym, grouped", () => {
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
