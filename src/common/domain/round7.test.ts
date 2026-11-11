/** Round 7's shared rules (design/prototype/ROUND7.md; views/r7tags.js, r7org.js, r7play.js, r7shell.js). */
import { describe, expect, it } from "vitest";
import { matchesRule, playlistTracks } from "./rules";
import {
  addPlayed,
  checkSteps,
  DEFAULT_CROSSFADE,
  DEFAULT_DISPLAY,
  DEFAULT_ENDING_FADE_MS,
  dropPlaceKey,
  folderPath,
  guardAllows,
  keyName,
  normaliseKey,
  offerTags,
  parseDropPlace,
  PLAYED_KEEP,
  roleChoices,
  roleProfile,
  SHORTCUT_ACTIONS,
  shortcutKey,
  shortcutUsing,
  stepsOf,
  stepsToKeep,
  tagsInside,
  inScreenOrder,
  trackHasTag,
  usualPadSteps,
  usualSceneSteps,
  checkDisplay,
  checkDevices,
  checkStreamingMode,
  DEFAULT_STREAMING_MODE,
  type CueStep,
  type TagTree,
} from "./round7";
import type { AudioProfile, DomainLookup, DomainScene, DomainTrack, PlaylistRule } from "./types";

const track = (id: string, mood: string[], extra: Partial<DomainTrack> = {}): DomainTrack => ({
  id,
  kind: "music",
  title: id,
  metaTitle: "",
  fileName: `${id}.flac`,
  durationMs: 60_000,
  role: null,
  loop: null,
  energy: 2,
  tags: { mood },
  ...extra,
});

// Mood › Melancholy › Grief › Mourning, as the prototype's sample nests Grief inside Melancholy.
const tree: TagTree = { mood: { Grief: "Melancholy", Mourning: "Grief" } };

describe("DAT-10: a tag that holds others", () => {
  it("holds the tags inside it at every depth", () => {
    expect(tagsInside(tree, "mood", "Melancholy")).toEqual(["Grief", "Mourning"]);
    expect(tagsInside(tree, "mood", "Grief")).toEqual(["Mourning"]);
    expect(tagsInside(tree, "mood", "Heroic")).toEqual([]);
    expect(tagsInside({ mood: { A: "B", B: "A" } }, "mood", "A")).toEqual(["B"]);
  });

  it("lists tags in the Tags screen's order: each followed depth first by the tags inside it; a loop is cut", () => {
    const saved = ["Mourning", "Heroic", "Melancholy", "Tense", "Grief"];
    const parent = (name: string) => tree.mood[name] ?? null;
    expect(inScreenOrder(saved, (n) => n, parent)).toEqual(["Heroic", "Melancholy", "Grief", "Mourning", "Tense"]);
    const loop: Record<string, string> = { A: "B", B: "A" };
    expect(inScreenOrder(["A", "C", "B"], (n) => n, (n) => loop[n] ?? null)).toEqual(["C", "A", "B"]);
  });

  it("finds a track that has the tag or a tag inside it", () => {
    expect(trackHasTag(track("a", ["Mourning"]), "mood", "Melancholy", tree)).toBe(true);
    expect(trackHasTag(track("a", ["Melancholy"]), "mood", "Grief", tree)).toBe(false);
    expect(trackHasTag(track("a", ["Grief"]), "mood", "Grief")).toBe(true);
  });

  it("widens dynamic playlist rules the same way (any, all, none)", () => {
    const grieving = track("g", ["Grief"]);
    const any: PlaylistRule = { conds: [{ group: "mood", match: "any", values: ["Melancholy"] }] };
    expect(matchesRule(grieving, any)).toBe(false);
    expect(matchesRule(grieving, any, tree)).toBe(true);
    expect(matchesRule(grieving, { conds: [{ group: "mood", match: "none", values: ["Melancholy"] }] }, tree)).toBe(false);
    expect(matchesRule(grieving, { conds: [{ group: "mood", match: "all", values: ["Melancholy", "Grief"] }] }, tree)).toBe(true);
    const lookup: DomainLookup & { tagTree(): TagTree } = {
      track: () => undefined,
      playlist: () => undefined,
      tracks: () => [grieving, track("h", ["Heroic"])],
      tagTree: () => tree,
    };
    expect(playlistTracks({ id: "p", name: "Sad", lane: "music", kind: "dynamic", rule: any }, lookup).map((t) => t.id)).toEqual(["g"]);
  });

  it("offers the tag for another word of it while tagging, never a new one", () => {
    const tags = [
      { name: "Melancholy", also: ["sad", "sorrowful"] },
      { name: "Sacred", also: [] },
      { name: "Dread", also: ["fear"] },
    ];
    expect(offerTags(tags, "sad")).toEqual([{ tag: "Melancholy", word: "sad" }]);
    expect(offerTags(tags, "SA")).toEqual([
      { tag: "Sacred", word: null },
      { tag: "Melancholy", word: "sad" },
    ]);
    expect(offerTags(tags, "fe")).toEqual([{ tag: "Dread", word: "fear" }]);
    expect(offerTags(tags, " ")).toEqual([]);
  });
});

describe("ORG-4: folders", () => {
  it("names a nested folder by its path", () => {
    const folders = [
      { id: "a", name: "Sunken Crown", parentId: null },
      { id: "b", name: "Villains", parentId: "a" },
    ];
    expect(folderPath(folders, "b")).toBe("Sunken Crown › Villains");
    expect(folderPath(folders, "a")).toBe("Sunken Crown");
    expect(folderPath(folders, "gone")).toBe("");
  });
});

describe("ORG-5: where a drag can go", () => {
  it("writes and reads the places as the prototype's keys", () => {
    const places = [
      { kind: "playlist", playlistId: "pl1" },
      { kind: "board", boardId: "b1" },
      { kind: "queue", roomId: "table" },
      { kind: "scene", campaignId: "c", sessionId: "s", sceneId: "sc" },
    ] as const;
    expect(places.map(dropPlaceKey)).toEqual(["pl:pl1", "pb:b1", "q:table", "sc:c:s:sc"]);
    for (const p of places) expect(parseDropPlace(dropPlaceKey(p))).toEqual(p);
    expect(parseDropPlace("sc:c:s")).toBeNull();
    expect(parseDropPlace("zz:1")).toBeNull();
  });
});

describe("PLY-8: one model for every trigger", () => {
  const scene: DomainScene = {
    id: "sc",
    name: "The abbey ruins",
    music: [{ kind: "playlist", id: "pl1" }, { kind: "track", id: "t2" }],
    ambience: { kind: "track", id: "a1" },
    boardIds: ["b1", "b2"],
  };

  it("a scene's usual start plays its music, its ambience and shows its first board", () => {
    expect(usualSceneSteps(scene)).toEqual([
      { do: "music", what: { kind: "playlist", id: "pl1" }, how: "crossfade", upNext: "replace", fromMs: null },
      { do: "ambience", what: { kind: "track", id: "a1" } },
      { do: "board", boardId: "b1" },
    ]);
    expect(usualSceneSteps({ ...scene, music: [], ambience: null, boardIds: [] })).toEqual([]);
    expect(usualPadSteps()).toEqual([{ do: "sound" }]);
  });

  it("keeps steps only when they differ from the usual (absent is the usual)", () => {
    const usual = usualSceneSteps(scene);
    expect(stepsToKeep(usual, usual)).toBeNull();
    const own: CueStep[] = [...usual, { do: "pad", boardId: "b1", padId: "bell" }];
    expect(stepsToKeep(own, usual)).toEqual(own);
    expect(stepsToKeep([], usual)).toEqual([]);
    expect(stepsOf(null, usual)).toEqual(usual);
    expect(stepsOf([], usual)).toEqual([]);
  });

  it("refuses steps that make no sense where they are, in plain words", () => {
    expect(checkSteps([{ do: "sound" }], "scene")).toMatch(/pad/);
    expect(checkSteps([{ do: "board", boardId: "b" }], "pad")).toMatch(/scene/);
    expect(checkSteps([{ do: "fade", level: 1.5, ms: 2000 }], "scene")).toMatch(/level/i);
    expect(checkSteps([{ do: "wait", ms: 11 * 60_000 }], "pad")).toMatch(/10 minutes/);
    expect(checkSteps(Array.from({ length: 51 }, () => ({ do: "wait", ms: 1000 }) as CueStep), "pad")).toMatch(/50/);
    expect(checkSteps([{ do: "play", what: { kind: "track", id: "t" }, how: "mixOut", upNext: "playNext", fromMs: 1200 }], "pad")).toBeNull();
    expect(checkSteps([{ do: "play", what: { kind: "track", id: "t" }, how: "mixOut", upNext: "playNext", fromMs: -1 }], "pad")).toMatch(/start/);
  });
});

describe("PLY-4, SHW-3: tracks behave as tagged", () => {
  const profile = (p: Partial<AudioProfile> = {}): AudioProfile => ({
    startMs: 0,
    endMs: 60_000,
    after: "loop",
    loopStartMs: 0,
    loopCrossfadeMs: 0,
    fadeIn: { ms: 0, shape: 50 },
    fadeOut: { ms: 0, shape: 50 },
    markers: [],
    ...p,
  });

  it("shows only the choices that fit the role", () => {
    expect(roleChoices(track("u", [], { role: "underscore" }))).toEqual(["ending", "resume", "follow"]);
    expect(roleChoices(track("l", [], { role: "loop_bed" }))).toEqual(["resume"]);
    expect(roleChoices(track("s", [], { role: "sting" }))).toEqual(["follow"]);
    expect(roleChoices(track("x", [], { role: "transition" }))).toEqual(["ending", "follow"]);
    expect(roleChoices(track("n", []))).toEqual([]);
    expect(roleChoices(track("e", [], { kind: "fx", role: "effect" }))).toEqual([]);
  });

  it("a sting never loops, whatever its profile says", () => {
    expect(roleProfile(track("s", [], { role: "sting" }), profile(), { fadeOutChosen: false }).after).toBe("next");
    expect(roleProfile(track("u", [], { role: "underscore" }), profile(), { fadeOutChosen: false }).after).toBe("loop");
  });

  it("an ending that fades out fades over 4 s unless the profile says otherwise", () => {
    const fades = track("u", [], { role: "underscore", fadesOut: true });
    expect(roleProfile(fades, profile(), { fadeOutChosen: false }).fadeOut).toEqual({ ms: DEFAULT_ENDING_FADE_MS, shape: 50 });
    expect(roleProfile(fades, profile({ fadeOut: { ms: 1500, shape: 70 } }), { fadeOutChosen: true }).fadeOut).toEqual({ ms: 1500, shape: 70 });
    expect(roleProfile(track("u", []), profile(), { fadeOutChosen: false }).fadeOut.ms).toBe(0);
  });
});

describe("PLY-1: what played", () => {
  it("is newest first and keeps the evening's last 100", () => {
    let list = addPlayed([], { trackId: "a", at: 1, from: null });
    list = addPlayed(list, { trackId: "b", at: 2, from: null });
    expect(list.map((x) => x.trackId)).toEqual(["b", "a"]);
    for (let i = 0; i < 150; i++) list = addPlayed(list, { trackId: `t${i}`, at: i, from: null });
    expect(list).toHaveLength(PLAYED_KEEP);
    expect(list[0].trackId).toBe("t149");
  });
});

describe("UX-12: keyboard shortcuts", () => {
  it("lists Lyre's keys, each once", () => {
    const keys = SHORTCUT_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(shortcutKey({}, "palette")).toBe("Ctrl+K");
    expect(shortcutKey({ palette: "Ctrl+J" }, "palette")).toBe("Ctrl+J");
  });

  it("names a pressed key as the screens show it", () => {
    expect(keyName({ key: "k", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe("Ctrl+K");
    expect(keyName({ key: "Escape", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toBe("Shift+Esc");
    expect(keyName({ key: " ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe("Space");
    expect(keyName({ key: "Shift", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toBe("");
    expect(normaliseKey("ctrl+shift+k")).toBe("Ctrl+Shift+K");
    expect(normaliseKey("alt+left")).toBe("Alt+Left");
    expect(normaliseKey("Ctrl+")).toBeNull();
    expect(normaliseKey("Hyper+K")).toBeNull();
  });

  it("says which action already has a key", () => {
    expect(shortcutUsing({}, "Space")).toBe("nextScene");
    expect(shortcutUsing({}, "Space", "nextScene")).toBeNull();
    expect(shortcutUsing({ nextScene: "N" }, "Space")).toBeNull();
    expect(shortcutUsing({ nextScene: "N" }, "N")).toBe("nextScene");
  });

  it("ignores a second Next scene within a second while the guard is on", () => {
    expect(guardAllows(null, 5000, true)).toBe(true);
    expect(guardAllows(5000, 5600, true)).toBe(false);
    expect(guardAllows(5000, 6000, true)).toBe(true);
    expect(guardAllows(5000, 5100, false)).toBe(true);
  });
});

describe("UX-11, PRV-2, PLY-8: settings", () => {
  it("checks display options and devices", () => {
    expect(DEFAULT_DISPLAY).toEqual({ density: "compact", textSize: 100, highContrast: false });
    expect(checkDisplay({ textSize: 150 })).toBeNull();
    expect(checkDisplay({ textSize: 140 })).toMatch(/100/);
    expect(checkDisplay({ density: "huge" as never })).toMatch(/Compact/);
    expect(checkDevices({ previewEar: "right", split: true })).toBeNull();
    expect(checkDevices({ previewEar: "middle" as never })).toMatch(/ear/);
    expect(checkDevices({ airDevice: "x".repeat(600) })).toMatch(/device/);
    // FND-16: Sound to Discord (the stored names are Kenku FM's: lowLatency is Best sound quality).
    expect(DEFAULT_STREAMING_MODE).toBe("performance");
    expect(checkStreamingMode("lowLatency")).toBeNull();
    expect(checkStreamingMode("performance")).toBeNull();
    expect(checkStreamingMode("fast")).toMatch(/Best sound quality or Lighter on the computer/);
    expect(DEFAULT_CROSSFADE).toEqual({ ms: 3000, curve: "even" });
  });
});
