/**
 * Arrange's layouts (round 10, Nik 18 Nov 03:14, answer 6): one per window size, every box movable and resizable, On
 * air too (top by default).
 */
import { describe, expect, it } from "vitest";

import { arrange, arrangedKeyOrder, layoutFor, movedWords, readingOrder, USUAL_LAYOUT, whereIs, widthsOf, withLayout, type LiveLayout } from "./liveLayout";

const wide = (): LiveLayout => layoutFor(3, {});

describe("Arrange: the layouts of Live (round 10)", () => {
  it("starts from the usual layout for each window size, On air at the top", () => {
    expect(wide().cols).toEqual(USUAL_LAYOUT[3]);
    expect(whereIs(wide(), "onair")).toBeNull();
    expect(readingOrder(wide())).toEqual(["onair", "scenes", "current", "ssp", "ssd", "cpp", "cpd"]);
  });

  it("moves a box up, down and into the next column; an empty column goes", () => {
    let l = arrange(wide(), 3, "cpp", "up");
    expect(l.cols[2]).toEqual(["ssp", "cpp", "ssd", "cpd"]);
    l = arrange(l, 3, "cpp", "down");
    expect(l.cols[2]).toEqual(["ssp", "ssd", "cpp", "cpd"]);
    l = arrange(wide(), 3, "scenes", "right");
    expect(l.cols).toEqual([["current", "scenes"], ["ssp", "ssd", "cpp", "cpd"]]);
  });

  it("On air goes into a column and back to the top; the reading order follows (F6, Alt+1 to 7)", () => {
    const l = arrange(wide(), 3, "onair", { into: 0 });
    expect(l.cols[0]).toEqual(["onair", "scenes"]);
    expect(readingOrder(l)[0]).toBe("onair");
    const down = arrange(l, 3, "onair", "down");
    expect(readingOrder(down).slice(0, 2)).toEqual(["scenes", "onair"]);
    expect(whereIs(arrange(l, 3, "onair", "top"), "onair")).toBeNull();
  });

  it("Taller and Shorter change a box's height in steps, between 120 and 1200 px; Fit takes the height off", () => {
    let l = arrange(wide(), 3, "scenes", "taller", 300);
    expect(l.heights.scenes).toBe(360);
    l = arrange(l, 3, "scenes", "shorter");
    expect(l.heights.scenes).toBe(300);
    expect(arrange(l, 3, "scenes", { height: 50 }).heights.scenes).toBe(120);
    expect(arrange(l, 3, "scenes", "fit").heights.scenes).toBeUndefined();
  });

  it("Wider takes width from the next column; widths never go under 12", () => {
    const l = arrange(wide(), 3, "scenes", "wider");
    expect(widthsOf(l, 3)).toEqual([31, 39, 30]);
    let narrow = wide();
    for (let i = 0; i < 10; i++) narrow = arrange(narrow, 3, "scenes", "narrower");
    expect(widthsOf(narrow, 3)[0]).toBeGreaterThanOrEqual(12);
  });

  it("a drop puts the box at the line; dropping below itself in its column counts without it", () => {
    const l = arrange(wide(), 3, "ssp", { drop: { col: 2, at: 3 } });
    expect(l.cols[2]).toEqual(["ssd", "cpp", "ssp", "cpd"]);
    const across = arrange(wide(), 3, "cpd", { drop: { col: 0, at: 0 } });
    expect(across.cols[0]).toEqual(["cpd", "scenes"]);
  });

  it("a kept layout is made whole: a missing box comes back, an unknown one is dropped", () => {
    const saved = withLayout({}, 3, { cols: [["scenes", "nope" as never], ["current"]], widths: null, heights: { scenes: 5000 } });
    const l = layoutFor(3, saved);
    expect(l.cols.flat().sort()).toEqual(["cpd", "cpp", "current", "scenes", "ssd", "ssp"]);
    expect(l.heights.scenes).toBeUndefined();
    expect(layoutFor(2, saved).cols).toEqual(USUAL_LAYOUT[2]);
    expect(layoutFor(3, withLayout(saved, 3, null)).cols).toEqual(USUAL_LAYOUT[3]);
  });

  it("says what moved", () => {
    expect(movedWords("onair", { into: 1 }, wide())).toBe("On air moved into column 2");
    expect(movedWords("scenes", "taller", arrange(wide(), 3, "scenes", "taller", 300))).toBe("Scenes is now 360 pixels high");
  });
});

/* Review M3 (R60-CODE-REVIEW): Alt+1 to 7 and F6 follow the arranged order only when a box has moved; making a box
   taller or a column wider keeps the usual order (On air, Scenes, Current scene, …). */
describe("the order of Alt+1 to 7 and F6 after Arrange", () => {
  it("is the usual order while no box has moved, and the reading order once one has", () => {
    expect(arrangedKeyOrder(2, {})).toBeNull();
    const taller = { half: { cols: USUAL_LAYOUT[2].map((c) => [...c]), widths: [30, 70], heights: { scenes: 400 } } };
    expect(arrangedKeyOrder(2, taller)).toBeNull();
    const moved = { half: { cols: [["current"], ["scenes", "ssp", "ssd", "cpp", "cpd"]] as LiveLayout["cols"], widths: null as number[] | null, heights: {} } };
    expect(arrangedKeyOrder(2, moved)).toEqual(["onair", "current", "scenes", "ssp", "ssd", "cpp", "cpd"]);
  });
});

/* Review M4: while arranging with fewer columns than the window has room for, an empty column is drawn to drop into,
   and the column bars hand over a width for it too; the real columns still take their new widths. */
describe("dragging a column bar while the empty column shows", () => {
  it("keeps the real columns' widths and leaves out the empty column's", () => {
    const two: LiveLayout = { cols: [["scenes", "ssp", "ssd", "cpp", "cpd"], ["current"]], widths: null, heights: {} };
    expect(arrange(two, 3, "scenes", { widths: [25, 45, 18] }).widths).toEqual([25, 45]);
  });
});
