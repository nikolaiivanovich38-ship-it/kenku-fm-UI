import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestStore } from "../test/testStore";
import { createTrack, deleteTracks, updateTrack } from "./tracks";
import { addMarker } from "./markers";
import { createTag, listTagGroups, listTags, setTagSynonyms, tagTracks, updateTag } from "./tags";
import { addTracksToPlaylist, createPlaylist } from "./playlists";
import { addPad, createBoard } from "./boards";
import { createCampaign, createScene, createSession } from "./campaigns";
import { matchQuery, search } from "./search";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

const track = (title: string, extra: Record<string, unknown> = {}) =>
  createTrack(t.store, { title, file: { path: `/music/${title.replace(/\s+/g, "_")}.mp3` }, ...extra });
const titles = (text: string, options = {}) => search(t.store, text, options).map((hit) => hit.title);

describe("matchQuery", () => {
  it("turns typed words into prefix terms that must all match", () => {
    expect(matchQuery("dark for")).toBe('"dark"* "for"*');
    expect(matchQuery('say "hi"')).toBe('"say"* "hi"*');
    expect(matchQuery('it"s')).toBe('"its"*');
  });

  it("treats search syntax as plain text and ignores words with no letters or digits", () => {
    expect(matchQuery("AND OR NOT")).toBe('"AND"* "OR"* "NOT"*');
    expect(matchQuery("title:x (y) -z ^w")).toBe('"title:x"* "(y)"* "-z"* "^w"*');
    expect(matchQuery(' - * " ')).toBeNull();
    expect(matchQuery("   ")).toBeNull();
  });
});

describe("search (ORG-1)", () => {
  it("finds tracks by the start of any word in the title", () => {
    track("Tavern bustle");
    track("Dark forest");
    expect(titles("tav")).toEqual(["Tavern bustle"]);
    expect(titles("bus")).toEqual(["Tavern bustle"]);
    expect(titles("fo da")).toEqual(["Dark forest"]);
    expect(titles("zzz")).toEqual([]);
    expect(titles("")).toEqual([]);
  });

  it("finds tracks by file name, notes, marker labels, composer and album", () => {
    createTrack(t.store, {
      title: "Cue 4",
      file: { path: "H:\\OST\\Silver for Monsters.flac" },
      notes: "Use when the striga wakes",
      sourceComposer: "Marcin Przybyłowicz",
      sourceAlbum: "Wild Hunt",
    });
    const second = track("Plain");
    addMarker(t.store, second.id, { timeMs: 92_000, label: "crescendo" });
    expect(titles("silver")).toEqual(["Cue 4"]);
    expect(titles("striga")).toEqual(["Cue 4"]);
    expect(titles("przy")).toEqual(["Cue 4"]);
    expect(titles("wild hunt")).toEqual(["Cue 4"]);
    expect(titles("cresc")).toEqual(["Plain"]);
  });

  it("finds tracks by tag name and synonym, and follows renames", () => {
    const tense = listTags(t.store).find((x) => x.name === "Tense")!;
    const melancholy = listTags(t.store).find((x) => x.name === "Melancholy")!;
    const a = track("Ambush");
    const b = track("Funeral");
    tagTracks(t.store, [a.id], [tense.id]);
    tagTracks(t.store, [b.id], [melancholy.id]);
    setTagSynonyms(t.store, melancholy.id, ["sad"]);
    expect(titles("tense")).toEqual(["Ambush"]);
    expect(titles("sad")).toEqual(["Funeral"]);
    updateTag(t.store, tense.id, { name: "Suspense" });
    expect(titles("tense")).toEqual([]);
    expect(titles("susp")).toEqual(["Ambush"]);
  });

  it("ranks a title match above a match in the notes", () => {
    track("Storm at sea");
    track("Calm harbour", { notes: "before the storm" });
    expect(titles("storm")).toEqual(["Storm at sea", "Calm harbour"]);
  });

  it("ignores accents and letter case", () => {
    track("Café Noir");
    expect(titles("cafe")).toEqual(["Café Noir"]);
    expect(titles("CAFÉ")).toEqual(["Café Noir"]);
  });

  it("does not break on search syntax typed by the user", () => {
    track("Battle (Phase 2)");
    for (const text of ['"', "*", "(", "AND", "NEAR(", "-battle", "a:b", "^", "'", "\\", "🎵"]) {
      expect(() => search(t.store, text), text).not.toThrow();
    }
    expect(titles("(phase")).toEqual(["Battle (Phase 2)"]);
  });

  it("finds playlists, boards, campaigns, sessions and scenes, and can keep to some kinds", () => {
    createPlaylist(t.store, { title: "Harbour town" });
    createBoard(t.store, { title: "Harbour sounds" });
    const c = createCampaign(t.store, { name: "Harbour of Souls", notes: "pirates" });
    const s = createSession(t.store, { campaignId: c.id, name: "Session 3", notes: "the harbour fire" });
    createScene(t.store, { sessionId: s.id, name: "Harbour fight" });
    track("Harbour bells");
    const hits = search(t.store, "harbour");
    expect(hits.map((hit) => hit.kind).sort()).toEqual(["board", "campaign", "playlist", "scene", "session", "track"]);
    expect(titles("pirates")).toEqual(["Harbour of Souls"]);
    expect(search(t.store, "harbour", { kinds: ["playlist", "board"] }).map((hit) => hit.kind).sort()).toEqual([
      "board",
      "playlist",
    ]);
  });

  it("searches within one playlist or board", () => {
    const a = track("Rain light");
    const b = track("Rain heavy");
    const p = createPlaylist(t.store, { title: "Weather" });
    const board = createBoard(t.store, { title: "Rain board" });
    addTracksToPlaylist(t.store, p.id, [a.id]);
    addPad(t.store, board.id, { label: "Rain", sound: { kind: "variants", trackIds: [b.id] } });
    expect(titles("rain", { playlistId: p.id })).toEqual(["Rain light"]);
    expect(titles("rain", { boardId: board.id })).toEqual(["Rain heavy"]);
  });

  it("forgets deleted tracks and sees edits straight away", () => {
    const a = createTrack(t.store, { title: "Old name", file: { path: "/music/a.mp3" } });
    updateTrack(t.store, a.id, { title: "New name" });
    expect(titles("old")).toEqual([]);
    expect(titles("new")).toEqual(["New name"]);
    deleteTracks(t.store, [a.id]);
    expect(titles("new")).toEqual([]);
    expect(t.store.get("SELECT count(*) AS n FROM search_docs")).toEqual({ n: 0 });
  });

  it("returns at most `limit` hits with their ids", () => {
    for (let i = 0; i < 30; i++) track(`Loop ${i}`);
    const hits = search(t.store, "loop", { limit: 10 });
    expect(hits).toHaveLength(10);
    expect(hits[0]).toEqual({ kind: "track", id: expect.any(String), title: expect.stringMatching(/^Loop/), score: expect.any(Number) });
  });

  it("keeps the default tag groups out of the results", () => {
    expect(listTagGroups(t.store)).toHaveLength(3);
    expect(search(t.store, "mood")).toEqual([]);
  });

  it("serves the Library's search box: all three names, artist, album and tags, by word start (ORG-1)", () => {
    const tense = listTags(t.store).find((x) => x.name === "Tense")!;
    const a = createTrack(t.store, {
      title: "Melancholy tense - harbour at night (loops well)",
      metaTitle: "Dies Irae",
      file: { path: "H:\\Scores\\03 Requiem_Mass.flac" },
      sourceComposer: "Giuseppe Verdi",
      sourceAlbum: "Messa da Requiem",
    });
    const b = createTrack(t.store, { metaTitle: "Wings of Kynareth", file: { path: "/m/07.flac" } });
    tagTracks(t.store, [b.id], [tense.id]);
    const ids = (text: string) => search(t.store, text, { kinds: ["track"] }).map((hit) => hit.id);
    expect(ids("dies")).toEqual([a.id]); // the file-tag title
    expect(ids("requiem_m")).toEqual([a.id]); // the file name
    expect(ids("verd")).toEqual([a.id]);
    expect(ids("messa")).toEqual([a.id]);
    expect(ids("loops well")).toEqual([a.id]);
    expect(ids("kyn")).toEqual([b.id]);
    // A track with no title of its own is shown, and found, by its file-tag title.
    expect(search(t.store, "kyn")[0].title).toBe("Wings of Kynareth");
    expect(ids("tense").sort()).toEqual([a.id, b.id].sort());
    // The word in the title ranks above the tag.
    expect(ids("tense")[0]).toBe(a.id);
  });

  it("keeps to one lane of the Library: FX includes stings (ORG-1, the Library's kind filter)", () => {
    const music = track("Storm theme");
    const sting = track("Storm sting", { role: "sting" });
    const amb = track("Storm rain", { kind: "amb" });
    const fx = track("Storm thunder", { kind: "fx" });
    const lane = (l: "music" | "amb" | "fx") => search(t.store, "storm", { lane: l }).map((hit) => hit.id).sort();
    expect(lane("music")).toEqual([music.id, sting.id].sort());
    expect(lane("amb")).toEqual([amb.id]);
    expect(lane("fx")).toEqual([sting.id, fx.id].sort());
    expect(() => search(t.store, "storm", { lane: "loud" as never })).toThrow(/lane/);
  });

  it("finds a tag added to a group and a renamed track in one pass", () => {
    const docks = createTag(t.store, { groupId: listTagGroups(t.store)[2].id, name: "Docks" });
    const a = track("Gulls");
    tagTracks(t.store, [a.id], [docks.id]);
    expect(titles("dock")).toEqual(["Gulls"]);
  });
});

describe("keeping the search index up to date (DB review 5)", () => {
  const dirty = () => (t.store.get<{ n: number }>("SELECT count(*) AS n FROM temp.search_dirty") as { n: number }).n;

  it("rebuilds each changed track's search entry once, just before the change is saved", () => {
    const [mood] = listTagGroups(t.store);
    const tags = ["Eerie", "Tense", "Warm"].map((name) => listTags(t.store, { groupId: mood.id }).find((x) => x.name === name)!.id);
    const a = track("Abbey ruins");
    const b = track("Bell tower");
    t.store.change("Tag and rename", () => {
      tagTracks(t.store, [a.id, b.id], tags);
      updateTrack(t.store, a.id, { notes: "fog" });
      addMarker(t.store, a.id, { timeMs: 10, label: "toll" });
      // Every write marks the track; its entry is rebuilt once, at the end.
      expect(dirty()).toBe(2);
      expect(titles("eerie")).toEqual([]);
    });
    expect(dirty()).toBe(0);
    expect(titles("eerie").sort()).toEqual(["Abbey ruins", "Bell tower"]);
    expect(titles("fog toll")).toEqual(["Abbey ruins"]);
  });

  it("forgets the marks of a change that was not saved", () => {
    const a = track("Abbey ruins");
    expect(() =>
      t.store.change("Fails", () => {
        updateTrack(t.store, a.id, { title: "Harbour" });
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(dirty()).toBe(0);
    expect(titles("abbey")).toEqual(["Abbey ruins"]);
  });
});
