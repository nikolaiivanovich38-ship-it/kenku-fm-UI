import { describe, expect, it } from "vitest";
import { prototypeSeed } from "../../../common/lyre/seed";
import type { LibraryTrack } from "../../../common/lyre/api";
import { tagTreeOf } from "../../../common/lyre/lookup";
import {
  DEFAULT_FILTER,
  addedText,
  filterCount,
  filterSummary,
  fmt,
  fmtLong,
  folderRows,
  isNewish,
  kindMark,
  profileSummary,
  ruleWords,
  visibleTracks,
  type LibraryFilter,
} from "./model";

const seed = prototypeSeed(Date.UTC(2026, 10, 5, 12));
const tracks = seed.tracks;
const groups = seed.tagGroups;
const titles = (list: LibraryTrack[]) => list.map((t) => t.title || t.metaTitle || t.fileName);
const missing = new Set(seed.missing);
const view = (change: Partial<LibraryFilter>, q = "", sort: Parameters<typeof visibleTracks>[3] = "title") =>
  visibleTracks(tracks, { ...DEFAULT_FILTER, ...change }, q, sort, missing);

describe("the Library's filters (library.js matches and visible)", () => {
  it("All shows every track, sorted by title", () => {
    const all = view({});
    expect(all).toHaveLength(69);
    const shown = titles(all);
    expect([...shown].sort((a, b) => a.localeCompare(b))).toEqual(shown);
  });

  it("FX shows sound effects and stings; Music leaves out effects; Ambience only ambience", () => {
    const fx = titles(view({ kind: "fx" }));
    expect(fx).toContain("Heavy door slams");
    expect(fx).toContain("Dread rising, choir stabs - monster approaches (sting)");
    expect(fx).not.toContain("Ashes");
    expect(titles(view({ kind: "amb" }))).toContain("Busy tavern crowd, mugs, laughter");
    expect(titles(view({ kind: "music" }))).toContain("Ashes");
    expect(titles(view({ kind: "music" }))).not.toContain("Heavy door slams");
  });

  it("a tag narrows the list; two values in one group widen it again (any of them)", () => {
    expect(view({ tags: { mood: ["Grief"] } })).toHaveLength(5);
    expect(view({ tags: { mood: ["Grief", "Dread"] } }).length).toBeGreaterThan(5);
  });

  it("DAT-10: a tag that holds others finds the tracks of the tags inside it (Mood › Melancholy › Grief)", () => {
    const tree = tagTreeOf(groups);
    const withTree = visibleTracks(tracks, { ...DEFAULT_FILTER, tags: { mood: ["Melancholy"] } }, "", "title", missing, tree);
    expect(titles(withTree)).toContain("Release after loss, ethereal voice, resolves - end of session or death of an NPC");
    expect(titles(view({ tags: { mood: ["Melancholy"] } }))).not.toContain("Release after loss, ethereal voice, resolves - end of session or death of an NPC");
  });

  it("New, not tagged yet: tracks just added or without tags", () => {
    const fresh = view({ newOnly: true });
    expect(fresh).toHaveLength(3);
    expect(titles(fresh)).toEqual(expect.arrayContaining(["Ashes", "Memories of Mother"]));
    expect(isNewish(tracks.find((t) => t.id === "t44"))).toBe(true);
  });

  it("energy limits leave out tracks outside the range", () => {
    expect(view({ emin: 5, emax: 5 }).every((t) => t.energy === 5)).toBe(true);
  });

  it("a folder shows the tracks in it and its subfolders", () => {
    const scores = view({ folder: "H:\\Audio\\Scores" });
    expect(scores.every((t) => t.folder.startsWith("H:\\Audio\\Scores"))).toBe(true);
    expect(scores.length).toBeGreaterThan(0);
  });

  it("search finds every word in titles, file names, artists, albums and tags", () => {
    const tavern = titles(view({}, "tavern"));
    expect(tavern).toContain("Busy tavern crowd, mugs, laughter");
    expect(tavern.length).toBeLessThan(10);
    expect(titles(view({}, "god of war ashes"))).toEqual(["Ashes"]);
  });

  it("sorts longest first, shortest first, newest first and by artist", () => {
    expect(titles(view({}, "", "long"))[0]).toMatch(/^Brutal battle/);
    const short = view({}, "", "short");
    expect(short[0].durationMs).toBeLessThanOrEqual(short[1].durationMs);
    expect(view({}, "", "new")[0].isNew).toBe(true);
    const byArtist = view({}, "", "artist").map((t) => t.artist);
    expect([...byArtist].sort((a, b) => a.localeCompare(b))).toEqual(byArtist);
  });

  it("DAT-13: Shape shows tracks of the shapes ticked, the game master's choice before Lyre's suggestion", () => {
    const builds = view({ shapes: ["builds"] });
    expect(titles(builds)).toContain("Brutal battle, driving brass and strings; long build to full war");
    // t15 is suggested steady, but the game master chose falls away.
    expect(builds.map((t) => t.id)).not.toContain("t15");
    expect(view({ shapes: ["fallsAway"] }).map((t) => t.id)).toContain("t15");
    expect(view({ shapes: ["builds", "fallsAway"] }).length).toBe(builds.length + view({ shapes: ["fallsAway"] }).length);
  });

  it("DAT-8: Missing shows only the tracks whose files Lyre cannot find", () => {
    expect(view({ missing: true }).map((t) => t.id).sort()).toEqual(["t19", "t26", "t37"]);
    expect(visibleTracks(tracks, { ...DEFAULT_FILTER, missing: true }, "", "title")).toHaveLength(0);
  });

  it("counts and describes the filters in use", () => {
    expect(filterCount(DEFAULT_FILTER)).toBe(0);
    expect(filterSummary(DEFAULT_FILTER, groups)).toBe("None: showing every track");
    const f = { ...DEFAULT_FILTER, kind: "fx" as const, newOnly: true, tags: { mood: ["Grief", "Eerie"] }, emin: 2, folder: "H:\\Audio\\Effects" };
    expect(filterCount(f)).toBe(6);
    expect(filterSummary(f, groups)).toBe("FX · New, not tagged yet · Grief, Eerie · energy 2 to 5 · Effects");
    const r5 = { ...DEFAULT_FILTER, missing: true, shapes: ["builds" as const, "peaksThenFalls" as const] };
    expect(filterCount(r5)).toBe(3);
    expect(filterSummary(r5, groups)).toBe("Missing files · Builds, Peaks then falls");
  });

  it("lists library folders with their counts, and a chosen folder's subfolders under it", () => {
    const rows = folderRows(tracks, seed.folders, "", "all");
    expect(rows[0]).toMatchObject({ path: "", label: "All folders", count: 69, sub: false });
    expect(rows.map((r) => r.path)).toContain("H:\\Audio\\Scores");
    const open = folderRows(tracks, seed.folders, "H:\\Audio\\Scores", "all");
    expect(open.some((r) => r.sub && r.label === "Bear McCreary")).toBe(true);
  });
});

describe("words the Library shows", () => {
  it("times as m:ss, and h:mm:ss for an hour or more", () => {
    expect(fmt(95_000)).toBe("1:35");
    expect(fmt(0)).toBe("0:00");
    expect(fmtLong(1_166_000)).toBe("19:26");
    expect(fmtLong(3_725_000)).toBe("1:02:05");
  });

  it("marks ambience, effects and stings with words as well as colour", () => {
    const sting = tracks.find((t) => t.role === "sting" && t.kind === "music");
    expect(kindMark(sting)).toEqual({ lane: "fx", text: "FX · Sting", title: "FX: a sting (short music cue)" });
    expect(kindMark(tracks.find((t) => t.kind === "amb"))?.text).toBe("Amb");
    expect(kindMark(tracks.find((t) => t.id === "t44"))).toBeNull();
  });

  it("says when a track was added: Today, or the day", () => {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(addedText(now - 1000, now)).toBe("Today");
    expect(addedText(Date.UTC(2026, 8, 12, 12), now)).toBe("12 Sep");
  });

  it("sums up a track's audio profile in one line", () => {
    const t13 = tracks.find((t) => t.id === "t13");
    expect(profileSummary(t13, {})).toMatch(/^(Whole track|Starts at|Ends at)/);
    const plain: LibraryTrack = { ...tracks.find((t) => t.id === "t44"), profile: null };
    expect(profileSummary(plain, {})).toBe("Whole track, then the next one.");
    expect(profileSummary(plain, { "pl:x": { t44: { startMs: 1000 } } })).toBe("Whole track, then the next one. Has its own settings in 1 place.");
  });

  it("writes a dynamic playlist's rule as the prototype does, leaving out conditions without values", () => {
    const names = { mood: "Mood", motif: "Leitmotif" };
    expect(ruleWords({ conds: [{ group: "motif", match: "any", values: ["Drowned Abbess"] }, { group: "mood", match: "all", values: [] }], energy: [0, 1], leaveOutStings: true }, names)).toBe(
      "Leitmotif any of Drowned Abbess; energy 0 to 1; not stings",
    );
    expect(ruleWords({ conds: [], shapes: ["builds", "peaksThenFalls"] }, names)).toBe("shape builds or peaks then falls");
  });
});
