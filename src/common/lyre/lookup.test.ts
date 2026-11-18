/** 0.5.2 (Nik's item 36): a playlist's tracks and dividers as one list, and back (withDividers, layoutOf). */
import { describe, expect, it } from "vitest";

import { layoutOf, withDividers, type PlaylistEntry } from "./lookup";

const T = (trackId: string): PlaylistEntry => ({ kind: "track", trackId });
const D = (id: string): PlaylistEntry => ({ kind: "divider", id, name: id.toUpperCase() });

describe("a playlist's list with its dividers", () => {
  it("goes back to the same tracks and dividers, two dividers together and one at the end included", () => {
    const entries = [D("top"), T("a"), T("b"), D("x"), D("y"), T("c"), D("end")];
    const { trackIds, dividers } = layoutOf(entries);
    expect(trackIds).toEqual(["a", "b", "c"]);
    expect(dividers.map((d) => [d.id, d.at])).toEqual([["top", 0], ["x", 2], ["y", 2], ["end", 3]]);
    expect(withDividers(trackIds, dividers)).toEqual(entries);
  });

  it("a track moved to just below a divider is in the divider's section; just above, in the one before", () => {
    const below = layoutOf([T("b"), D("x"), T("a"), T("c")]);
    expect(below).toEqual({ trackIds: ["b", "a", "c"], dividers: [{ id: "x", name: "X", at: 1 }] });
    const above = layoutOf([T("b"), T("a"), D("x"), T("c")]);
    expect(above).toEqual({ trackIds: ["b", "a", "c"], dividers: [{ id: "x", name: "X", at: 2 }] });
  });
});
