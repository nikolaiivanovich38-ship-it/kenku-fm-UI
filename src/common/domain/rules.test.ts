/**
 * DAT-12: the rules the design prototype (design/prototype) proved, written as tests first.
 * Each describe block names the behaviour as the game master sees it.
 */
import { describe, expect, it } from "vitest";

import {
  envelopeAt,
  fadeInGain,
  fadeOutGain,
  isFx,
  matchesRule,
  parsePlaceKey,
  placeKey,
  playedLengthMs,
  playlistTracks,
  resolveProfile,
  roomsFor,
  ruleText,
  sceneRoom,
  sceneSequence,
  shapeName,
  stepSequence,
  usesOfBoard,
  usesOfPlaylist,
  usesOfTrack,
  withoutEmptyConditions,
} from "./rules";
import type { DomainCampaign, DomainLookup, DomainPlaylist, DomainScene, DomainTrack, PlaylistRule } from "./types";

function track(id: string, over: Partial<DomainTrack> = {}): DomainTrack {
  return { id, kind: "music", title: id, metaTitle: "", fileName: id + ".flac", durationMs: 300_000, role: "underscore", loop: "no", energy: 3, tags: { mood: [], motif: [], scene: [] }, ...over };
}

const tracks: DomainTrack[] = [
  track("eerie", { energy: 2, loop: "yes", tags: { mood: ["Eerie", "Dread"], motif: ["Drowned Abbess"], scene: ["Exploration"] } }),
  track("choir", { energy: 2, tags: { mood: ["Sacred", "Mysterious"], motif: ["Drowned Abbess"], scene: ["Revelation"] } }),
  track("battle", { energy: 5, tags: { mood: ["Tense", "Epic"], motif: [], scene: ["Combat"] } }),
  track("sting", { energy: 4, role: "sting", durationMs: 64_000, tags: { mood: ["Dread"], motif: [], scene: ["Combat"] } }),
  track("rain", { kind: "amb", loop: "yes", tags: { mood: ["Melancholy"], motif: [], scene: ["Exploration"] } }),
  track("door", { kind: "fx", role: "effect", durationMs: 1_600, tags: { mood: ["Tense"], motif: [], scene: [] } }),
];
const playlists: DomainPlaylist[] = [
  { id: "abbess", name: "The Abbess", lane: "music", kind: "manual", trackIds: ["choir", "eerie", "missing"] },
  { id: "abbeyEerie", name: "Abbey: eerie, low energy", lane: "music", kind: "dynamic", rule: { conds: [{ group: "motif", match: "any", values: ["Drowned Abbess"] }, { group: "mood", match: "any", values: ["Eerie", "Dread"] }], energy: [0, 3] } },
  { id: "stings", name: "Stings and hits", lane: "fx", kind: "dynamic", rule: { conds: [] } },
  { id: "abbeyAmb", name: "Abbey ambience", lane: "amb", kind: "manual", trackIds: ["rain"] },
  { id: "empty", name: "Empty", lane: "music", kind: "manual", trackIds: [] },
];
const lookup: DomainLookup = {
  track: (id) => tracks.find((t) => t.id === id),
  playlist: (id) => playlists.find((p) => p.id === id),
  tracks: () => tracks,
};

describe("FX means sound effects and stings", () => {
  it("counts effects and stings as FX, other music not", () => {
    expect(isFx(lookup.track("door")!)).toBe(true);
    expect(isFx(lookup.track("sting")!)).toBe(true);
    expect(isFx(lookup.track("battle")!)).toBe(false);
    expect(isFx(lookup.track("rain")!)).toBe(false);
  });
});

describe("dynamic playlists match tracks by their tags", () => {
  it("any of, all of and none of", () => {
    const eerie = lookup.track("eerie")!;
    expect(matchesRule(eerie, { conds: [{ group: "mood", match: "any", values: ["Eerie", "Warm"] }] })).toBe(true);
    expect(matchesRule(eerie, { conds: [{ group: "mood", match: "all", values: ["Eerie", "Warm"] }] })).toBe(false);
    expect(matchesRule(eerie, { conds: [{ group: "mood", match: "none", values: ["Warm"] }] })).toBe(true);
    expect(matchesRule(eerie, { conds: [{ group: "mood", match: "none", values: ["Dread"] }] })).toBe(false);
  });
  it("matches nothing on a saved condition with no values, so deleting a tag never widens a playlist to its whole lane", () => {
    expect(matchesRule(lookup.track("battle")!, { conds: [{ group: "mood", match: "any", values: [] }] })).toBe(false);
  });
  it("leaves out conditions still being written when the editor previews the rule", () => {
    const draft: PlaylistRule = { conds: [{ group: "mood", match: "all", values: [] }, { group: "mood", match: "any", values: ["Tense"] }] };
    expect(matchesRule(lookup.track("battle")!, withoutEmptyConditions(draft))).toBe(true);
  });
  it("applies the energy range and can leave out stings", () => {
    expect(matchesRule(lookup.track("battle")!, { conds: [], energy: [0, 3] })).toBe(false);
    expect(matchesRule(lookup.track("sting")!, { conds: [], leaveOutStings: true })).toBe(false);
  });
  it("says the rule in plain words, leaving out empty conditions", () => {
    const groups = { mood: "Mood", motif: "Leitmotif" };
    expect(ruleText(lookup.playlist("abbeyEerie")!.kind === "dynamic" ? (playlists[1] as Extract<DomainPlaylist, { kind: "dynamic" }>).rule : { conds: [] }, groups))
      .toBe("Leitmotif any of Drowned Abbess; Mood any of Eerie, Dread; energy 0 to 3");
    expect(ruleText({ conds: [{ group: "mood", match: "all", values: [] }], leaveOutStings: true }, groups)).toBe("no stings");
  });
});

describe("a playlist's tracks", () => {
  it("keeps a manual playlist's order and skips tracks that no longer exist", () => {
    expect(playlistTracks(lookup.playlist("abbess")!, lookup).map((t) => t.id)).toEqual(["choir", "eerie"]);
  });
  it("fills a dynamic playlist from its lane: music, ambience, or FX (effects and stings)", () => {
    expect(playlistTracks(lookup.playlist("abbeyEerie")!, lookup).map((t) => t.id)).toEqual(["eerie"]);
    expect(playlistTracks(lookup.playlist("stings")!, lookup).map((t) => t.id)).toEqual(["sting", "door"]);
  });
});

describe("a scene's music plays in order", () => {
  const scene: DomainScene = { id: "ruins", name: "The abbey ruins", music: [{ kind: "track" as const, id: "eerie" }, { kind: "playlist" as const, id: "abbess" }, { kind: "playlist" as const, id: "empty" }, { kind: "track" as const, id: "sting" }], ambience: null, boardIds: [] as string[] };
  it("each track, then each playlist's tracks; empty playlists add nothing", () => {
    expect(sceneSequence(scene, lookup)).toEqual([
      { trackId: "eerie", itemIndex: 0, playlistId: null },
      { trackId: "choir", itemIndex: 1, playlistId: "abbess" },
      { trackId: "eerie", itemIndex: 1, playlistId: "abbess" },
      { trackId: "sting", itemIndex: 3, playlistId: null },
    ]);
  });
  it("Next goes back to the start after the last item", () => {
    const seq = sceneSequence(scene, lookup);
    expect(stepSequence(seq, 3, 1)).toBe(0);
    expect(stepSequence(seq, 0, -1)).toBe(3);
  });
  it("never plays the same track twice in a row", () => {
    const twice: DomainScene = { ...scene, music: [{ kind: "track" as const, id: "choir" }, { kind: "playlist" as const, id: "abbess" }] };
    const seq = sceneSequence(twice, lookup); // choir, choir, eerie
    expect(stepSequence(seq, 0, 1)).toBe(2);
  });
  it("has nothing to step to in an empty scene", () => {
    expect(stepSequence([], 0, 1)).toBeNull();
  });
});

describe("audio profiles (PLY-12)", () => {
  const eerie = { ...lookup.track("eerie")!, durationMs: 441_000, profile: { endMs: 318_000, after: "loop" as const, loopStartMs: 64_000 } };
  const overrides = { "sc:crown:s14:ruins": { eerie: { endMs: 190_000, after: "next" as const } }, "pl:abbess": { eerie: { startMs: 5_000 } } };
  const ruins = { kind: "scene" as const, campaignId: "crown", sessionId: "s14", sceneId: "ruins" };
  const inAbbess = { kind: "playlist" as const, playlistId: "abbess" };

  it("defaults to the whole track, looping when the track loops well", () => {
    const p = resolveProfile(lookup.track("eerie")!, [], {});
    expect(p.source).toBe("track");
    expect(p.profile).toMatchObject({ startMs: 0, endMs: 300_000, after: "loop", loopStartMs: 0, fadeIn: { ms: 0, shape: 50 }, fadeOut: { ms: 0, shape: 50 } });
    expect(resolveProfile(lookup.track("battle")!, [], {}).profile.after).toBe("next");
  });
  it("uses the scene's settings first, then the playlist's, then the track's own", () => {
    expect(resolveProfile(eerie, [ruins, inAbbess], overrides)).toMatchObject({ source: "scene", profile: { endMs: 190_000, after: "next" } });
    expect(resolveProfile(eerie, [inAbbess], overrides)).toMatchObject({ source: "playlist", profile: { startMs: 5_000 } });
    expect(resolveProfile(eerie, [], overrides)).toMatchObject({ source: "track", profile: { endMs: 318_000, loopStartMs: 64_000 } });
  });
  it("keeps the points inside the track", () => {
    const p = resolveProfile({ ...eerie, profile: { startMs: -5, endMs: 900_000, loopStartMs: 999_000 } }, [], {}).profile;
    expect(p.startMs).toBe(0);
    expect(p.endMs).toBe(441_000);
    expect(p.loopStartMs).toBeLessThan(p.endMs);
  });
  it("keeps the loop crossfade to at most half the looped part", () => {
    const p = resolveProfile(track("x", { profile: { startMs: 0, endMs: 100_000, loopStartMs: 60_000, loopCrossfadeMs: 90_000 } }), [], {}).profile;
    expect(p.loopCrossfadeMs).toBe(20_000);
  });
  it("says how long it will play", () => {
    expect(playedLengthMs(resolveProfile(eerie, [ruins], overrides).profile)).toBe(190_000);
  });
  it("writes places as keys and reads them back", () => {
    expect(placeKey(ruins)).toBe("sc:crown:s14:ruins");
    expect(placeKey(inAbbess)).toBe("pl:abbess");
    expect(parsePlaceKey("sc:crown:s14:ruins")).toEqual(ruins);
    expect(parsePlaceKey("pl:abbess")).toEqual(inAbbess);
    expect(parsePlaceKey("nonsense")).toBeNull();
  });
});

describe("fades: gentle, even, sharp", () => {
  it("names the intensity ranges", () => {
    expect([0, 35, 36, 64, 65, 100].map(shapeName)).toEqual(["Gentle", "Gentle", "Even", "Even", "Sharp", "Sharp"]);
  });
  it("an even fade is a straight line; gentle drops early, sharp holds then drops", () => {
    expect(fadeOutGain(0.5, 50)).toBeCloseTo(0.5);
    expect(fadeOutGain(0.5, 0)).toBeLessThan(0.5);
    expect(fadeOutGain(0.5, 100)).toBeGreaterThan(0.5);
    expect(fadeOutGain(0, 0)).toBe(1);
    expect(fadeOutGain(1, 100)).toBe(0);
    expect(fadeInGain(0.25, 30)).toBeCloseTo(fadeOutGain(0.75, 30));
  });
  it("applies the fade in after Start and the fade out before End, not again after a loop", () => {
    const p = resolveProfile(track("x", { profile: { startMs: 10_000, endMs: 100_000, fadeIn: { ms: 4_000, shape: 50 }, fadeOut: { ms: 10_000, shape: 50 } } }), [], {}).profile;
    expect(envelopeAt(p, 12_000, false)).toBeCloseTo(0.5);
    expect(envelopeAt(p, 12_000, true)).toBe(1);
    expect(envelopeAt(p, 95_000, false)).toBeCloseTo(0.5);
    expect(envelopeAt(p, 50_000, false)).toBe(1);
  });
});

describe("where things are used", () => {
  const campaigns: DomainCampaign[] = [{
    id: "crown", playlistIds: ["abbess"], boardIds: ["combat"], sessions: [{
      id: "s14", campaignId: "crown", playlistIds: [], boardIds: ["abbey"], scenes: [
        { id: "ruins", name: "Ruins", music: [{ kind: "track", id: "eerie" }, { kind: "playlist", id: "abbess" }], ambience: { kind: "playlist", id: "abbeyAmb" }, boardIds: ["abbey", "combat"] },
      ],
    }],
  }];
  it("lists campaign, session and scene uses with their role and position", () => {
    expect(usesOfPlaylist("abbess", campaigns)).toEqual([
      { level: "campaign", campaignId: "crown" },
      { level: "scene", campaignId: "crown", sessionId: "s14", sceneId: "ruins", role: "music", position: 1 },
    ]);
    expect(usesOfPlaylist("abbeyAmb", campaigns)).toEqual([{ level: "scene", campaignId: "crown", sessionId: "s14", sceneId: "ruins", role: "ambience", position: 0 }]);
    expect(usesOfBoard("combat", campaigns).map((u) => u.level)).toEqual(["campaign", "scene"]);
    expect(usesOfTrack("eerie", campaigns)).toEqual([{ level: "scene", campaignId: "crown", sessionId: "s14", sceneId: "ruins", role: "music", position: 0 }]);
  });
});

describe("rooms: where an action's sound goes", () => {
  const rooms = [{ botId: "b1", name: "Table" }, { botId: "b2", name: "Side room" }];
  it("goes to the chosen room, or every room", () => {
    expect(roomsFor({ room: "b2" }, rooms)).toEqual(["b2"]);
    expect(roomsFor("all", rooms)).toEqual(["b1", "b2"]);
  });
  it("falls back to the first room when the chosen room has gone", () => {
    expect(roomsFor({ room: "b9" }, rooms)).toEqual(["b1"]);
  });
  it("starts scenes in the first room only", () => {
    expect(sceneRoom(rooms)).toBe("b1");
    expect(sceneRoom([])).toBeNull();
  });
});
