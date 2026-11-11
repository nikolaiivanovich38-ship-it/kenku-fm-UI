import { describe, expect, it } from "vitest";
import type { LibraryTrack, TagGroup } from "../../../common/lyre/api";
import { inVocabularyOrder, tagTreeOf } from "../../../common/lyre/lookup";
import { childrenOf, colourName, orderedTags, otherTags, ownCount, sameLevel, tagCount, tagWords } from "./tagsModel";

const mood: TagGroup = {
  id: "mood",
  name: "Mood",
  color: null,
  values: ["Melancholy", "Heroic", "Grief", "Loss"],
  tags: [
    { name: "Melancholy", parent: null, also: ["sad", "sorrowful"], color: null },
    { name: "Heroic", parent: null, also: [], color: "gold" },
    { name: "Grief", parent: "Melancholy", also: [], color: null },
    { name: "Loss", parent: "Grief", also: [], color: null },
  ],
};
const track = (id: string, moods: string[]) => ({ id, tags: { mood: moods } }) as unknown as LibraryTrack;
const tracks = [track("a", ["Grief"]), track("b", ["Melancholy", "Heroic"]), track("c", ["Loss"]), track("d", [])];

describe("the Tags screen's rules (r7tags.js)", () => {
  it("lists each tag followed by the tags inside it, indented by depth", () => {
    expect(orderedTags(mood).map((t) => [t.info.name, t.depth])).toEqual([
      ["Melancholy", 0],
      ["Grief", 1],
      ["Loss", 2],
      ["Heroic", 0],
    ]);
  });

  it("DAT-10: a track lists its tags in the order this screen lists them", () => {
    const shown = orderedTags(mood).map((t) => t.info.name);
    expect(inVocabularyOrder(mood, ["Heroic", "Loss", "Grief", "Melancholy"])).toEqual(shown);
  });

  it("a tag counts the tracks of the tags inside it; Delete counts only its own", () => {
    const tree = tagTreeOf([mood]);
    expect(tagCount(tracks, "mood", "Melancholy", tree)).toBe(3);
    expect(tagCount(tracks, "mood", "Grief", tree)).toBe(2);
    expect(ownCount(tracks, "mood", "Melancholy")).toBe(1);
  });

  it("says where a tag sits, its other words and its count", () => {
    expect(tagWords(mood.tags[0], 3)).toBe("Also found by: sad, sorrowful. 3 tracks.");
    expect(tagWords(mood.tags[2], 1)).toBe("Inside Melancholy. 1 track.");
  });

  it("moves among the tags at the same level, and merges only into tags outside it", () => {
    expect(sameLevel(mood, "Heroic")).toEqual(["Melancholy", "Heroic"]);
    expect(sameLevel(mood, "Grief")).toEqual(["Grief"]);
    expect(otherTags(mood, "Melancholy").map((t) => t.info.name)).toEqual(["Heroic"]);
    expect(otherTags(mood, "Grief").map((t) => t.info.name)).toEqual(["Melancholy", "Heroic"]);
    expect(childrenOf(mood, "Melancholy")).toEqual(["Grief"]);
  });

  it("names colours as the pad palette does", () => {
    expect(colourName("sea")).toBe("Sea");
    expect(colourName(null)).toBe("");
  });
});
