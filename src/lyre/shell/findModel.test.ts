import { describe, expect, it } from "vitest";

import type { FindResult } from "../../common/lyre/api";
import { actionOfKey, canDo, foundItems, moveActive, optionLabel } from "./findModel";

const RESULT: FindResult = {
  tracks: { trackIds: ["t1", "f1", "a1", "gone"], total: 4 },
  playlists: [{ id: "p-abbess", name: "The Abbess", lane: "music", kind: "manual", trackIds: [], place: null }],
  pads: [{ boardId: "weather", padId: "thunder", label: "Thunder crack", boardName: "Weather" }],
  scenes: [{ campaignId: "crown", sessionId: "s14", sceneId: "sc3", name: "The abbey ruins", sessionNumber: 14 }],
};

const TRACKS: Record<string, { title: string; kind: "music" | "amb" | "fx" }> = {
  t1: { title: "Lullaby of the abbess", kind: "music" },
  f1: { title: "Thunder crack", kind: "fx" },
  a1: { title: "Abbey rain", kind: "amb" },
};
const trackOf = (id: string) => TRACKS[id] ?? null;

describe("Find and play's keys (UX-12, r7shell.js)", () => {
  it.each([
    [{ key: "Enter" }, "air"],
    [{ key: "Enter", altKey: true }, "preview"],
    [{ key: "Enter", shiftKey: true }, "queue"],
    [{ key: "Enter", ctrlKey: true }, "open"],
    [{ key: "Enter", metaKey: true }, "open"],
    [{ key: "a" }, null],
    [{ key: "Escape" }, null],
  ])("%o is %s", (event, action) => {
    expect(actionOfKey({ altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...event })).toBe(action);
  });

  it("Down and Up move through the results and wrap around", () => {
    expect(moveActive(0, 3, "ArrowDown")).toBe(1);
    expect(moveActive(2, 3, "ArrowDown")).toBe(0);
    expect(moveActive(0, 3, "ArrowUp")).toBe(2);
    expect(moveActive(0, 0, "ArrowDown")).toBe(0);
  });
});

describe("what Find and play lists", () => {
  it("lists playlists and scenes first, then tracks and ambiences, pads, then effects, each named with its kind", () => {
    const items = foundItems(RESULT, trackOf);
    expect(items.map(optionLabel)).toEqual([
      "The Abbess, playlist",
      "The abbey ruins, scene, Session 14",
      "Lullaby of the abbess, track",
      "Abbey rain, ambience",
      "Thunder crack, pad, Weather",
      "Thunder crack, effect",
    ]);
  });

  it("offers Add to queue only for tracks and playlists", () => {
    const items = foundItems(RESULT, trackOf);
    const byKind = (kind: string) => items.find((i) => i.kind === kind)!;
    expect(canDo(byKind("track"), "queue")).toBe(true);
    expect(canDo(byKind("playlist"), "queue")).toBe(true);
    expect(canDo(byKind("pad"), "queue")).toBe(false);
    expect(canDo(byKind("scene"), "queue")).toBe(false);
    expect(canDo(byKind("effect"), "queue")).toBe(false);
    expect(canDo(byKind("scene"), "air")).toBe(true);
    expect(canDo(byKind("pad"), "open")).toBe(true);
  });
});
