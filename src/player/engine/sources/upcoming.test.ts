import { describe, expect, it } from "vitest";

import type { SequenceStep } from "../../../common/domain";
import { createQueue, makeEntries } from "../queue/queue";
import { upcomingInQueue, upcomingInSequence } from "./upcoming";

const step = (trackId: string, itemIndex = 0): SequenceStep => ({ trackId, itemIndex, playlistId: null });

describe("upcoming: the tracks to keep buffered (PLY-11)", () => {
  it("in a scene: the playing step and the next, wrapping round", () => {
    const seq = [step("a"), step("b"), step("c")];
    expect(upcomingInSequence(seq, 0)).toEqual(["a", "b"]);
    expect(upcomingInSequence(seq, 2)).toEqual(["c", "a"]);
  });

  it("in a scene: skips a track that would play twice in a row, as Next does", () => {
    expect(upcomingInSequence([step("a"), step("a", 1), step("b", 1)], 0)).toEqual(["a", "b"]);
  });

  it("in a scene: one track, or none", () => {
    expect(upcomingInSequence([step("a")], 0)).toEqual(["a"]);
    expect(upcomingInSequence([], 0)).toEqual([]);
  });

  it("in a queue: the current entry and the next in play order", () => {
    const state = createQueue({ entries: makeEntries(["a", "b", "c"], (t) => `e-${t}`), repeat: "off", shuffle: false });
    expect(upcomingInQueue(state)).toEqual(["a", "b"]);
  });

  it("in a queue: wraps round only with repeat all, and repeat one keeps the current track", () => {
    const base = createQueue({ entries: makeEntries(["a", "b"], (t) => `e-${t}`), startEntryId: "e-b", repeat: "off", shuffle: false });
    expect(upcomingInQueue(base)).toEqual(["b"]);
    expect(upcomingInQueue({ ...base, repeat: "all" })).toEqual(["b", "a"]);
    expect(upcomingInQueue({ ...base, repeat: "one" })).toEqual(["b"]);
  });

  it("in a queue: nothing when empty", () => {
    expect(upcomingInQueue(createQueue({ entries: [], repeat: "off", shuffle: false }))).toEqual([]);
  });
});
