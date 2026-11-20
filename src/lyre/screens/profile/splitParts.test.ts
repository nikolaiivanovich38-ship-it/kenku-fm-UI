import { describe, expect, it } from "vitest";
import { partsOf, splitPoints } from "./splitParts";

const markers = [
  { atMs: 318_000, label: "Loop back" },
  { atMs: 64_000, label: "Choir enters" },
  { atMs: 0, label: "Start" },
  { atMs: 190_000, label: "Low swell" },
  { atMs: 441_000, label: "At the end" },
];

describe("Split into parts", () => {
  it("takes the markers inside the track, in time order, each ticked", () => {
    expect(splitPoints(markers, 441_000).map((p) => [p.atMs, p.label, p.on])).toEqual([
      [64_000, "Choir enters", true],
      [190_000, "Low swell", true],
      [318_000, "Loop back", true],
    ]);
  });

  it("makes a part from each ticked point to the next, named after the marker that starts it", () => {
    const points = splitPoints(markers, 441_000);
    expect(partsOf(points, 441_000, "Bridge")).toEqual([
      { name: "Bridge – opening", startMs: 0, endMs: 64_000 },
      { name: "Bridge – choir enters", startMs: 64_000, endMs: 190_000 },
      { name: "Bridge – low swell", startMs: 190_000, endMs: 318_000 },
      { name: "Bridge – loop back", startMs: 318_000, endMs: 441_000 },
    ]);
    points[1].on = false;
    expect(partsOf(points, 441_000, "Bridge", { 1: "Choir section" })).toEqual([
      { name: "Bridge – opening", startMs: 0, endMs: 64_000 },
      { name: "Choir section", startMs: 64_000, endMs: 318_000 },
      { name: "Bridge – loop back", startMs: 318_000, endMs: 441_000 },
    ]);
  });

  /* Review M5: two markers at the same time make one split point (no part of no length, no two rows with one key). */
  it("takes two markers at the same time as one split point", () => {
    const points = splitPoints([...markers, { atMs: 64_000, label: "Bells" }], 441_000);
    expect(points.map((p) => p.atMs)).toEqual([64_000, 190_000, 318_000]);
    expect(partsOf(points, 441_000, "Bridge").every((p) => p.endMs > p.startMs)).toBe(true);
  });
});
