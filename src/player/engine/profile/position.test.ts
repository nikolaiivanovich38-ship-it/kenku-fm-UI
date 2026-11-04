import { describe, expect, it } from "vitest";

import type { AudioProfile } from "../../../common/domain";
import { positionAfter } from "./position";

const profile = (over: Partial<AudioProfile>): AudioProfile => ({
  startMs: 1000,
  endMs: 10_000,
  after: "next",
  loopStartMs: 4000,
  loopCrossfadeMs: 0,
  fadeIn: { ms: 0, shape: 50 },
  fadeOut: { ms: 0, shape: 50 },
  markers: [],
  ...over,
});

describe("positionAfter (Undo brings music back where it would be)", () => {
  it("moves on by the time that passed", () => {
    expect(positionAfter(profile({}), 3, 2)).toBe(5);
  });

  it("a loop wraps back to Loop start", () => {
    expect(positionAfter(profile({ after: "loop" }), 8, 5)).toBe(7); // 13 s is 3 s past End: 4 + 3
  });

  it("anything else waits a second before End", () => {
    expect(positionAfter(profile({}), 8, 5)).toBe(9);
  });
});
