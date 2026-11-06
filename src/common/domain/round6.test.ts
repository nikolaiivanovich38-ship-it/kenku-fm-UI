/** Round 6's shared rules for the data (design/prototype/ROUND6.md, core.js L.placeTracks, L.setPlaceOrder, L.oneRepeats). */
import { describe, expect, it } from "vitest";
import { placeOrderToKeep, repeatsOneIn, tracksInPlaceOrder, type RepeatOnes } from "./round6";

const t = (...ids: string[]) => ids.map((id) => ({ id }));

describe("ORG-13: a playlist's track order in one place", () => {
  it("is the order chosen there; tracks it does not name follow in the playlist's own order; removed tracks drop out", () => {
    expect(tracksInPlaceOrder(t("a", "b", "c", "d"), ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(tracksInPlaceOrder(t("a", "b"), ["gone", "b"]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("is the playlist's own order where none was chosen", () => {
    const own = t("a", "b");
    expect(tracksInPlaceOrder(own, undefined)).toEqual(own);
    expect(tracksInPlaceOrder(own, [])).toEqual(own);
  });

  it("is not kept when it equals the playlist's own order (Back to the playlist's order)", () => {
    expect(placeOrderToKeep(["a", "b", "c"], ["a", "b", "c"])).toBeNull();
    expect(placeOrderToKeep(["a", "b", "c"], ["b", "a", "c"])).toEqual(["b", "a", "c"]);
    // Only the playlist's tracks, each once, in the order given; the rest follow.
    expect(placeOrderToKeep(["a", "b", "c"], ["c", "x", "c"])).toEqual(["c", "a", "b"]);
    expect(placeOrderToKeep(["a", "b", "c"], ["a"])).toBeNull();
  });
});

describe("PLY-17: Repeat one on a scene's track, saved with the scene", () => {
  it("is on for that track in that scene only", () => {
    const ones: RepeatOnes = { "sc:c:s:x": ["t1"] };
    expect(repeatsOneIn(ones, "sc:c:s:x", "t1")).toBe(true);
    expect(repeatsOneIn(ones, "sc:c:s:y", "t1")).toBe(false);
    expect(repeatsOneIn(ones, "sc:c:s:x", "t2")).toBe(false);
    expect(repeatsOneIn(ones, null, "t1")).toBe(false);
  });
});
