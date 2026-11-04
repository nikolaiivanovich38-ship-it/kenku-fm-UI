/**
 * DAT-4 (Should): the game master writes cue notes into titles ("Melancholy
 * tense - harbour at night (loops well)"). Lyre suggests tags from the
 * existing vocabulary, loop advice and a role from them; nothing changes until
 * the game master accepts, and accepting is one undo step.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestStore } from "../test/testStore";
import { UndoHistory } from "../undo";
import { createTrack, getTrack } from "../repo/tracks";
import { listTags, setTagSynonyms, tagTracks, tagsOfTrack, createTag, listTagGroups } from "../repo/tags";
import { applyTitleSuggestions, suggestFromTitles } from "./titleTags";

let t: ReturnType<typeof makeTestStore>;
let history: UndoHistory;
beforeEach(() => {
  t = makeTestStore();
  history = new UndoHistory(t.store);
});
afterEach(() => t.close());

const tag = (name: string) => listTags(t.store).find((x) => x.name === name)!;
const track = (title: string, extra: Record<string, unknown> = {}) =>
  createTrack(t.store, { title, file: { path: `/m/${Math.random().toString(36).slice(2)}.flac` }, ...extra });
const names = (s: { tags: { name: string }[] }) => s.tags.map((x) => x.name);

describe("suggestFromTitles (DAT-4)", () => {
  it("suggests tags, loop advice and role from a descriptive title", () => {
    const a = track("Melancholy tense - the harbour at night (loops well)");
    const b = track("Heroic sting - short rise, don't loop");
    const c = track("Eerie drone, crossfade the loop");
    const [sa, sb, sc] = suggestFromTitles(t.store, [a.id, b.id, c.id]);
    expect(sa).toMatchObject({ trackId: a.id, loopable: "yes", role: null });
    expect(names(sa)).toEqual(["Melancholy", "Tense"]);
    expect(sa.tags[0]).toMatchObject({ tagId: tag("Melancholy").id, groupName: "Mood", matched: "Melancholy" });
    expect(sb).toMatchObject({ loopable: "no", role: "sting" });
    expect(names(sb)).toEqual(["Heroic"]);
    expect(sc).toMatchObject({ loopable: "crossfade" });
    expect(names(sc)).toEqual(["Eerie"]);
  });

  it("matches whole words and synonyms, follows word endings of longer names, and skips a word after 'not'", () => {
    setTagSynonyms(t.store, tag("Melancholy").id, ["sad"]);
    const scene = listTagGroups(t.store).find((g) => g.name === "Scene type")!;
    createTag(t.store, { groupId: scene.id, name: "Boss fight" });
    const a = track("Sadly triumphantly marching; not tense; boss fight (phase 2)");
    const b = track("Tenses and warmth"); // neither "Tense" nor "Warm"
    const [sa, sb] = suggestFromTitles(t.store, [a.id, b.id]);
    expect(names(sa)).toEqual(["Triumphant", "Boss fight"]);
    expect(names(sb)).toEqual([]);
    const sad = track("Sad farewell");
    expect(suggestFromTitles(t.store, [sad.id])[0].tags[0]).toMatchObject({ name: "Melancholy", matched: "sad" });
  });

  it("leaves out what the track already has, and adds the file's mood and genre tags as hints", () => {
    const a = track("Tense standoff (loops well)", { loopable: "crossfade", role: "underscore" });
    tagTracks(t.store, [a.id], [tag("Tense").id]);
    const [s] = suggestFromTitles(t.store, [a.id], { hints: { [a.id]: ["Eerie", "Soundtrack"] } });
    expect(names(s)).toEqual(["Eerie"]);
    expect(s).toMatchObject({ loopable: null, role: null });
    expect(t.store.get("SELECT count(*) AS n FROM track_tags")).toEqual({ n: 1 });
  });
});

describe("applyTitleSuggestions", () => {
  it("applies only what was accepted, as one undo step", () => {
    const a = track("Melancholy tense (loops well)");
    const b = track("Heroic sting");
    const [sa, sb] = suggestFromTitles(t.store, [a.id, b.id]);
    applyTitleSuggestions(t.store, [
      { trackId: a.id, tagIds: [sa.tags[0].tagId], loopable: sa.loopable },
      { trackId: b.id, tagIds: sb.tags.map((x) => x.tagId), role: sb.role },
    ]);
    expect(tagsOfTrack(t.store, a.id).map((x) => x.name)).toEqual(["Melancholy"]);
    expect(getTrack(t.store, a.id)).toMatchObject({ loopable: "yes", role: null });
    expect(getTrack(t.store, b.id)).toMatchObject({ role: "sting" });
    expect(history.state().undoLabel).toBe("Apply suggestions to 2 tracks");
    history.undo();
    expect(tagsOfTrack(t.store, a.id)).toEqual([]);
    expect(getTrack(t.store, a.id)!.loopable).toBeNull();
    expect(getTrack(t.store, b.id)!.role).toBeNull();
  });
});
