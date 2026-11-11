/**
 * Design round 5 (design/prototype/ROUND5.md): the rules Nik asked for after testing 0.3.0, written as tests first.
 * Each describe block names the behaviour as the game master sees it.
 */
import { describe, expect, it } from "vitest";

import { matchesRule, parsePlaceKey, placeKey, resolveProfile, ruleText, usesOfTrack } from "./rules";
import {
  DEFAULT_ORDER_ALONE,
  DEFAULT_ORDER_IN_SCENE,
  effectiveShape,
  orderWords,
  parseKeyOfPlace,
  profileKeysFor,
  profilePlacesFor,
  shapeOf,
  shuffledOrder,
  tracksInOrder,
  reflowBoard,
  resolvePlayOrder,
  shapeFromPeaks,
  trackShapeName,
  trackNameIn,
  keyOfPlace,
  whenTrackEnds,
  type PlayOrderOverrides,
  type TrackNames,
} from "./round5";
import { REPEATS, type DomainCampaign, type DomainTrack, type PlaylistRule } from "./types";

function track(id: string, over: Partial<DomainTrack> = {}): DomainTrack {
  return { id, kind: "music", title: id, metaTitle: "", fileName: id + ".flac", durationMs: 300_000, role: "underscore", loop: "no", energy: 3, tags: { mood: [], motif: [], scene: [] }, ...over };
}

/** A level curve of n points from a function of x (0 to 1), with a little ripple so it is not a perfect line. */
function curve(f: (x: number) => number, n = 48): number[] {
  return Array.from({ length: n }, (_, i) => f(i / (n - 1)) + (i % 2 ? 0.02 : -0.02));
}

describe("DAT-13 track shape: Lyre suggests it from the loudness", () => {
  it("a track that stays at much the same level is steady", () => {
    expect(shapeFromPeaks(curve(() => 0.6))).toBe("steady");
    expect(shapeFromPeaks(curve((x) => 0.55 + 0.08 * x))).toBe("steady");
  });

  it("a track that grows towards its end builds", () => {
    expect(shapeFromPeaks(curve((x) => 0.25 + 0.65 * x))).toBe("builds");
    expect(shapeFromPeaks(curve((x) => (x < 0.6 ? 0.3 : 0.3 + (x - 0.6) * 1.6)))).toBe("builds");
  });

  it("a track that starts loud and dies down falls away", () => {
    expect(shapeFromPeaks(curve((x) => 0.9 - 0.6 * x))).toBe("fallsAway");
  });

  it("a track with one high point in the middle peaks then falls", () => {
    expect(shapeFromPeaks(curve((x) => 0.3 + 0.6 * Math.sin(Math.PI * x)))).toBe("peaksThenFalls");
    expect(shapeFromPeaks(curve((x) => (x < 0.7 ? 0.3 + x * 0.85 : 0.9 - (x - 0.7) * 2)))).toBe("peaksThenFalls");
  });

  it("a track that goes up and down more than once rises and falls", () => {
    expect(shapeFromPeaks(curve((x) => 0.5 + 0.35 * Math.sin(Math.PI * 4 * x)))).toBe("risesAndFalls");
  });

  it("a few short blips do not count as rising and falling", () => {
    const flat = curve(() => 0.6);
    flat[10] = 0.95;
    flat[30] = 0.2;
    expect(shapeFromPeaks(flat)).toBe("steady");
  });

  it("with too few levels there is no suggestion", () => {
    expect(shapeFromPeaks([])).toBeNull();
    expect(shapeFromPeaks([0.2, 0.9, 0.3])).toBeNull();
  });

  it("levels outside 0 to 1 are clamped, so a bad reading cannot invent a shape", () => {
    expect(shapeFromPeaks(curve(() => 1.4))).toBe("steady");
    expect(shapeFromPeaks(curve(() => -3))).toBe("steady");
  });

  it("the game master's choice wins over the suggestion", () => {
    expect(effectiveShape("steady", curve((x) => 0.2 + 0.7 * x))).toEqual({ shape: "steady", source: "chosen" });
    expect(effectiveShape(null, curve((x) => 0.2 + 0.7 * x))).toEqual({ shape: "builds", source: "suggested" });
    expect(effectiveShape(undefined, undefined)).toEqual({ shape: null, source: null });
  });

  it("each shape has a plain word", () => {
    expect(["steady", "builds", "fallsAway", "peaksThenFalls", "risesAndFalls"].map((s) => trackShapeName(s as never))).toEqual(["Steady", "Builds", "Falls away", "Peaks then falls", "Rises and falls"]);
  });

  it("a dynamic playlist can ask for shapes, using the chosen shape or else the suggested one", () => {
    const rule: PlaylistRule = { conds: [], shapes: ["builds", "peaksThenFalls"] };
    expect(matchesRule(track("a", { shape: "builds" }), rule)).toBe(true);
    expect(matchesRule(track("b", { shape: null, suggestedShape: "peaksThenFalls" }), rule)).toBe(true);
    expect(matchesRule(track("c", { shape: "steady", suggestedShape: "builds" }), rule)).toBe(false);
    expect(matchesRule(track("d"), rule)).toBe(false);
    expect(matchesRule(track("e"), { conds: [], shapes: [] })).toBe(true);
    expect(ruleText(rule, {})).toBe("shape builds or peaks then falls");
  });
});

describe("PLY-13 play order: shuffle, repeat all, repeat one, per place", () => {
  const scene = { kind: "scene" as const, campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
  const session = { kind: "session" as const, campaignId: "crown", sessionId: "s14" };
  const overrides: PlayOrderOverrides = {
    [keyOfPlace(scene)]: { abbess: { shuffle: true, repeat: "one" } },
    [keyOfPlace(session)]: { wistful: { shuffle: true, repeat: "all" } },
  };

  it("places are written as keys and read back", () => {
    expect(keyOfPlace(scene)).toBe("sc:crown:s14:sc3");
    expect(keyOfPlace(session)).toBe("ss:crown:s14");
    expect(keyOfPlace({ kind: "campaign", campaignId: "crown" })).toBe("cp:crown");
    expect(parseKeyOfPlace("sc:crown:s14:sc3")).toEqual(scene);
    expect(parseKeyOfPlace("ss:crown:s14")).toEqual(session);
    expect(parseKeyOfPlace("cp:crown")).toEqual({ kind: "campaign", campaignId: "crown" });
    expect(parseKeyOfPlace("pl:abbess")).toBeNull();
    expect(parseKeyOfPlace("ss:crown")).toBeNull();
  });

  it("a choice made for a playlist in a scene applies only in that scene", () => {
    expect(resolvePlayOrder("abbess", { shuffle: false, repeat: "all" }, scene, overrides)).toEqual({ order: { shuffle: true, repeat: "one" }, source: "place" });
    expect(resolvePlayOrder("abbess", { shuffle: false, repeat: "all" }, session, overrides)).toEqual({ order: { shuffle: false, repeat: "all" }, source: "playlist" });
    expect(resolvePlayOrder("abbess", { shuffle: false, repeat: "all" }, { ...scene, sceneId: "sc4" }, overrides).source).toBe("playlist");
  });

  it("a session's choice does not reach the session's scenes: each place is its own", () => {
    expect(resolvePlayOrder("wistful", null, session, overrides).order).toEqual({ shuffle: true, repeat: "all" });
    expect(resolvePlayOrder("wistful", null, scene, overrides)).toEqual({ order: DEFAULT_ORDER_IN_SCENE, source: "default" });
  });

  it("without any choice, a playlist on its own repeats all, and in a scene it plays in order and moves on", () => {
    expect(resolvePlayOrder("x", null, null, {})).toEqual({ order: DEFAULT_ORDER_ALONE, source: "default" });
    expect(DEFAULT_ORDER_ALONE).toEqual({ shuffle: false, repeat: "all" });
    expect(DEFAULT_ORDER_IN_SCENE).toEqual({ shuffle: false, repeat: "off" });
    expect(resolvePlayOrder("x", { shuffle: true, repeat: "off" }, scene, {}).order).toEqual({ shuffle: true, repeat: "off" });
  });

  it("what happens when a track ends", () => {
    const one = { shuffle: false, repeat: "one" as const }, all = { shuffle: false, repeat: "all" as const }, off = { shuffle: false, repeat: "off" as const };
    expect(whenTrackEnds(one, { atLast: false, inScene: false })).toBe("again");
    expect(whenTrackEnds(one, { atLast: true, inScene: true })).toBe("again");
    expect(whenTrackEnds(all, { atLast: false, inScene: true })).toBe("next");
    expect(whenTrackEnds(all, { atLast: true, inScene: false })).toBe("first");
    expect(whenTrackEnds(all, { atLast: true, inScene: true })).toBe("first");
    expect(whenTrackEnds(off, { atLast: true, inScene: true })).toBe("moveOn");
    expect(whenTrackEnds(off, { atLast: true, inScene: false })).toBe("stop");
    expect(whenTrackEnds(off, { atLast: false, inScene: false })).toBe("next");
  });

  it("the order in plain words", () => {
    expect(orderWords({ shuffle: false, repeat: "off" })).toBe("In order, no repeat");
    expect(orderWords({ shuffle: true, repeat: "all" })).toBe("Shuffle, repeat all");
    expect(orderWords({ shuffle: false, repeat: "one" })).toBe("In order, repeat one");
  });
});

describe("DAT-14 a track's name in a scene", () => {
  const t = track("t07", { title: "Release after loss", metaTitle: "Now We Are Free", fileName: "17 Now We Are Free.flac" });
  const names: TrackNames = { "sc:crown:s14:sc6": { t07: "Dawn over the abbey" } };
  const sc6 = { kind: "scene" as const, campaignId: "crown", sessionId: "s14", sceneId: "sc6" };

  it("in the scene that names it, the scene's name shows, with the track's own name kept for hover", () => {
    expect(trackNameIn(t, sc6, names)).toEqual({ name: "Dawn over the abbey", own: "Release after loss", source: "scene" });
  });

  it("everywhere else the track's own name shows", () => {
    expect(trackNameIn(t, { ...sc6, sceneId: "sc5" }, names)).toEqual({ name: "Release after loss", own: "Release after loss", source: "title" });
    expect(trackNameIn(t, null, names).source).toBe("title");
  });

  it("without a title of its own, the title in the file, then the file name", () => {
    expect(trackNameIn(track("a", { title: "", metaTitle: "Lothlorien" }), null, {})).toEqual({ name: "Lothlorien", own: "Lothlorien", source: "file tags" });
    expect(trackNameIn(track("b", { title: "", metaTitle: "", fileName: "b.flac" }), null, {})).toEqual({ name: "b.flac", own: "b.flac", source: "file name" });
  });

  it("a blank scene name does not hide the track", () => {
    expect(trackNameIn(t, sc6, { "sc:crown:s14:sc6": { t07: "   " } }).source).toBe("title");
  });
});

describe("PLY-14 audio settings where a track is used", () => {
  it("from a scene, the scene's own settings come first, then the playlist the track plays from, then the track's own", () => {
    expect(profileKeysFor({ kind: "scene", campaignId: "c", sessionId: "s", sceneId: "x" }, "p")).toEqual(["sc:c:s:x", "pl:p"]);
  });

  it("from a session list, the session's own settings come first", () => {
    expect(profileKeysFor({ kind: "session", campaignId: "c", sessionId: "s" }, null)).toEqual(["ss:c:s"]);
    expect(profileKeysFor(null, "p")).toEqual(["pl:p"]);
    expect(profileKeysFor(null, null)).toEqual([]);
  });
});

describe("SFX-11 resizing a board fills the grid first", () => {
  const A = "A", B = "B", C = "C", D = "D", E = "E";

  it("pads fill the new grid left to right, top to bottom, in their order, closing gaps", () => {
    // 3 x 2:  A . B  /  . C D   ->  2 x 2:  A B / C D
    expect(reflowBoard([A, null, B, null, C, D], [], 2, 2)).toEqual({ slots: [A, B, C, D], spare: [], spilled: [] });
  });

  it("a pad goes to Spare pads only when the grid is full, and says which", () => {
    expect(reflowBoard([A, B, C, D, E, null], [], 2, 2)).toEqual({ slots: [A, B, C, D], spare: [E], spilled: [E] });
  });

  it("making the grid bigger brings spare pads back into the free slots, in their order", () => {
    expect(reflowBoard([A, B], [C, D], 2, 2)).toEqual({ slots: [A, B, C, D], spare: [], spilled: [] });
    expect(reflowBoard([A, B], [C, D, E], 2, 2)).toEqual({ slots: [A, B, C, D], spare: [E], spilled: [] });
  });

  it("free slots stay empty at the end", () => {
    expect(reflowBoard([A, null], [], 2, 2)).toEqual({ slots: [A, null, null, null], spare: [], spilled: [] });
  });

  it("nothing is lost or doubled, and the old layout is left as it was for Undo", () => {
    const slots = [A, B, null, C], spare = [D];
    const out = reflowBoard(slots, spare, 1, 2);
    expect([...out.slots, ...out.spare].filter(Boolean).sort()).toEqual([A, B, C, D]);
    expect(slots).toEqual([A, B, null, C]);
    expect(spare).toEqual([D]);
  });

  it("a size below one slot is treated as one", () => {
    expect(reflowBoard([A, B], [], 0, 0)).toEqual({ slots: [A], spare: [B], spilled: [B] });
  });

  it("a pad put in Spare pads by hand stays there when the grid grows; pads a resize moved come back (Nik, 5 Nov)", () => {
    const byHand = (p: string) => p === D;
    expect(reflowBoard([A, B], [C, D, E], 3, 2, byHand)).toEqual({ slots: [A, B, C, E, null, null], spare: [D], spilled: [] });
    expect(reflowBoard([A, B, C], [D], 2, 1, byHand)).toEqual({ slots: [A, B], spare: [C, D], spilled: [C] });
  });
});

describe("ORG-12 a track can be used in campaigns and sessions, not only scenes", () => {
  it("lists the campaigns and sessions that keep a track on hand, then the scenes", () => {
    const campaigns: DomainCampaign[] = [
      {
        id: "c",
        playlistIds: [],
        boardIds: [],
        trackIds: ["t1"],
        sessions: [{ id: "s", campaignId: "c", playlistIds: [], boardIds: [], trackIds: ["t1"], scenes: [{ id: "x", name: "X", music: [{ kind: "track", id: "t1" }], ambience: null, boardIds: [] }] }],
      },
    ];
    expect(usesOfTrack("t1", campaigns)).toEqual([
      { level: "campaign", campaignId: "c" },
      { level: "session", campaignId: "c", sessionId: "s" },
      { level: "scene", campaignId: "c", sessionId: "s", sceneId: "x", role: "music", position: 0 },
    ]);
  });
});

describe("Wave 4 contracts: the shared rules the data, the engine and the screens read", () => {
  it("PLY-14: a session list is a place with its own audio settings, written ss:<campaign>:<session>", () => {
    const place = { kind: "session" as const, campaignId: "crown", sessionId: "s14" };
    expect(placeKey(place)).toBe("ss:crown:s14");
    expect(parsePlaceKey("ss:crown:s14")).toEqual(place);
    expect(parsePlaceKey("ss:crown")).toBeNull();
  });

  it("PLY-14: the profile places for a track played from a place are profileKeysFor's, in the same order", () => {
    const scene = { kind: "scene" as const, campaignId: "c", sessionId: "s", sceneId: "x" };
    const session = { kind: "session" as const, campaignId: "c", sessionId: "s" };
    for (const [place, playlist] of [[scene, "p"], [session, "p"], [session, null], [null, "p"], [{ kind: "campaign" as const, campaignId: "c" }, "p"], [null, null]] as const) {
      expect(profilePlacesFor(place, playlist).map(placeKey)).toEqual(profileKeysFor(place, playlist));
    }
  });

  it("PLY-14: the session's own settings win over the playlist's, and the source says so", () => {
    const t = track("t1", { durationMs: 100_000 });
    const overrides = { "ss:c:s": { t1: { endMs: 50_000 } }, "pl:p": { t1: { endMs: 60_000 } } };
    const out = resolveProfile(t, profilePlacesFor({ kind: "session", campaignId: "c", sessionId: "s" }, "p"), overrides);
    expect(out.source).toBe("session");
    expect(out.profile.endMs).toBe(50_000);
  });

  it("DAT-13: the shape that applies is the chosen one, else the stored suggestion, with its source", () => {
    expect(shapeOf({ shape: "steady", suggestedShape: "builds" })).toEqual({ shape: "steady", source: "chosen" });
    expect(shapeOf({ shape: null, suggestedShape: "builds" })).toEqual({ shape: "builds", source: "suggested" });
    expect(shapeOf({})).toEqual({ shape: null, source: null });
  });

  it("PLY-13: the repeat choices are a fixed list", () => {
    expect(REPEATS).toEqual(["off", "all", "one"]);
  });

  it("PLY-13: a shuffled order is the same for the same seed, holds every track once, and differs between seeds", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const a = shuffledOrder(ids, 7);
    expect(shuffledOrder(ids, 7)).toEqual(a);
    expect([...a].sort()).toEqual([...ids].sort());
    expect(a).not.toEqual(ids);
    expect(shuffledOrder(ids, 8)).not.toEqual(a);
    expect(shuffledOrder([], 3)).toEqual([]);
    expect(ids[0]).toBe("t0");
  });

  it("PLY-13: tracksInOrder keeps the playlist's order unless the order shuffles", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(tracksInOrder(ids, { shuffle: false, repeat: "all" }, 5)).toEqual(ids);
    expect(tracksInOrder(ids, { shuffle: true, repeat: "off" }, 5)).toEqual(shuffledOrder(ids, 5));
  });
});
