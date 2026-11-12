/**
 * BUG-22 (0.4.0 release checks): a file shorter than the length Lyre has for it (replaced on disk, not read again).
 * "Play the last 10 s before End" started past the file's real end, so the preview went round its loop with no
 * sound. The plan uses the file's real length: End is the file's end, and a start point past it keeps its distance
 * before End.
 */
import { describe, expect, it } from "vitest";
import type { AudioProfile } from "../../common/domain";
import { profilePlan } from "./passPlan";

const LOOPING: AudioProfile = {
  startMs: 0,
  endMs: 180_000,
  after: "loop",
  loopStartMs: 60_000,
  loopCrossfadeMs: 0,
  fadeIn: { ms: 0, shape: 50 },
  fadeOut: { ms: 0, shape: 50 },
  markers: [],
};

describe("profilePlan with the file's real length (BUG-22)", () => {
  it("a file as long as Lyre thinks: the last 10 s start 10 s before End", () => {
    expect(profilePlan(LOOPING, 200, 170)).toMatchObject({ startAt: 170, endAt: 180, loop: true, loopFrom: 60 });
  });

  it("a shorter file: End is its real end, and the last 10 s are its last 10 s, not its end", () => {
    const plan = profilePlan(LOOPING, 20, 170);
    expect(plan).toMatchObject({ endAt: 20, startAt: 10 });
    // Loop start past the real end: there is nothing to loop back to, so it plays to the end once.
    expect(plan.loop).toBe(false);
  });

  it("a shorter file that still holds Loop start loops from there", () => {
    expect(profilePlan({ ...LOOPING, loopStartMs: 5_000 }, 20, 170)).toMatchObject({ startAt: 10, endAt: 20, loop: true, loopFrom: 5 });
  });

  it("a start before the real end is kept as it is", () => {
    expect(profilePlan(LOOPING, 20, 4)).toMatchObject({ startAt: 4, endAt: 20 });
  });
});
