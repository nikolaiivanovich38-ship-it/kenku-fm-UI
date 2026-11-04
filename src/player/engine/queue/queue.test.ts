import { describe, expect, it } from "vitest";

import { firstChoice, seededRandom } from "../testing/seededRandom";
import {
  createQueue,
  currentEntry,
  insert,
  jumpTo,
  makeEntries,
  move,
  navigate,
  NavigationAction,
  NavigationOutcome,
  QueueState,
  remove,
  removeTrack,
  RepeatMode,
  RESTART_THRESHOLD_SECONDS,
  setRepeat,
  setShuffle,
  shuffleWithoutRepeats,
  upNext,
} from "./queue";

/** Entries whose entry id is "e-<track>" so expectations stay readable. */
const entries = (...trackIds: string[]) => makeEntries(trackIds, (trackId) => `e-${trackId}`);
const trackOf = (state: QueueState) => currentEntry(state)?.trackId ?? null;
const orderTracks = (state: QueueState) =>
  state.order.map((id) => state.entries.find((entry) => entry.entryId === id)!.trackId);

function queue(options: { start?: string; repeat?: RepeatMode; shuffle?: boolean; random?: () => number } = {}) {
  return createQueue({
    entries: entries("a", "b", "c", "d"),
    startEntryId: options.start ? `e-${options.start}` : undefined,
    repeat: options.repeat ?? "all",
    shuffle: options.shuffle ?? false,
    random: options.random ?? firstChoice,
  });
}

/** Follow `steps` "next" actions with repeat all, then switch to `repeat`. */
function advanced(state: QueueState, steps: number, repeat: RepeatMode, random = firstChoice): QueueState {
  let s = setRepeat(state, "all");
  for (let i = 0; i < steps; i++) {
    s = navigate(s, "next", { positionSeconds: 0, random }).state;
  }
  return setRepeat(s, repeat);
}

describe("createQueue", () => {
  it("starts at the requested entry, or the first, with play order equal to the list when not shuffled", () => {
    expect(trackOf(queue({ start: "c" }))).toBe("c");
    expect(trackOf(queue())).toBe("a");
    expect(orderTracks(queue())).toEqual(["a", "b", "c", "d"]);
  });

  it("puts the starting entry first in a shuffled play order", () => {
    const state = queue({ start: "c", shuffle: true, random: seededRandom(1) });
    expect(orderTracks(state)[0]).toBe("c");
    expect([...orderTracks(state)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("an empty queue has no current entry, and a start id that is not in the list falls back to the first", () => {
    expect(createQueue({ entries: [], repeat: "all", shuffle: false }).currentId).toBeNull();
    expect(trackOf(createQueue({ entries: entries("a", "b"), startEntryId: "nope", repeat: "all", shuffle: false }))).toBe("a");
  });

  it("refuses duplicate entry ids", () => {
    expect(() =>
      createQueue({ entries: [...entries("a"), ...entries("a")], repeat: "all", shuffle: false }),
    ).toThrow(/duplicate entry id/i);
  });
});

/**
 * One rule table for next, previous and track end. It mirrors the
 * characterisation table in usePlaylistPlayback.test.tsx (repeat "track" is
 * now "one", "playlist" is "all"). With `firstChoice` the shuffled play order
 * from "b" is b, a, c, d.
 */
type Expected = { plays: string } | "restart" | "stop";
type Row = { action: NavigationAction; shuffle: boolean; repeat: RepeatMode; start: string; steps: number; expected: Expected };

const forwardRows = (action: NavigationAction): Row[] => [
  { action, shuffle: false, repeat: "off", start: "b", steps: 0, expected: { plays: "c" } },
  { action, shuffle: false, repeat: "one", start: "b", steps: 0, expected: "restart" },
  { action, shuffle: false, repeat: "all", start: "b", steps: 0, expected: { plays: "c" } },
  { action, shuffle: false, repeat: "off", start: "d", steps: 0, expected: "stop" },
  { action, shuffle: false, repeat: "one", start: "d", steps: 0, expected: "restart" },
  { action, shuffle: false, repeat: "all", start: "d", steps: 0, expected: { plays: "a" } },
  { action, shuffle: true, repeat: "off", start: "b", steps: 0, expected: { plays: "a" } },
  { action, shuffle: true, repeat: "one", start: "b", steps: 0, expected: "restart" },
  { action, shuffle: true, repeat: "all", start: "b", steps: 0, expected: { plays: "a" } },
  // last in shuffled play order ("d")
  { action, shuffle: true, repeat: "off", start: "b", steps: 3, expected: "stop" },
  { action, shuffle: true, repeat: "one", start: "b", steps: 3, expected: "restart" },
  // A new round is shuffled; its first entry is never the track that just played.
  { action, shuffle: true, repeat: "all", start: "b", steps: 3, expected: { plays: "a" } },
];

const rows: Row[] = [
  ...forwardRows("next"),
  ...forwardRows("ended"),
  { action: "previous", shuffle: false, repeat: "off", start: "b", steps: 0, expected: { plays: "a" } },
  { action: "previous", shuffle: false, repeat: "one", start: "b", steps: 0, expected: "restart" },
  { action: "previous", shuffle: false, repeat: "all", start: "b", steps: 0, expected: { plays: "a" } },
  { action: "previous", shuffle: false, repeat: "off", start: "a", steps: 0, expected: "stop" },
  { action: "previous", shuffle: false, repeat: "one", start: "a", steps: 0, expected: "restart" },
  { action: "previous", shuffle: false, repeat: "all", start: "a", steps: 0, expected: { plays: "d" } },
  { action: "previous", shuffle: true, repeat: "off", start: "b", steps: 0, expected: "stop" },
  { action: "previous", shuffle: true, repeat: "one", start: "b", steps: 0, expected: "restart" },
  { action: "previous", shuffle: true, repeat: "all", start: "b", steps: 0, expected: { plays: "d" } },
  { action: "previous", shuffle: true, repeat: "off", start: "b", steps: 1, expected: { plays: "b" } },
  { action: "previous", shuffle: true, repeat: "all", start: "b", steps: 1, expected: { plays: "b" } },
];

describe("navigate: one rule table for next, previous and track end", () => {
  it.each(rows)("$action shuffle=$shuffle repeat=$repeat from $start+$steps -> $expected", (row) => {
    const start = advanced(queue({ start: row.start, shuffle: row.shuffle }), row.steps, row.repeat);
    const before = start.currentId;

    const { state, outcome } = navigate(start, row.action, { positionSeconds: 2, random: firstChoice });

    if (row.expected === "restart") {
      expect(outcome).toEqual<NavigationOutcome>({ kind: "restart", entryId: before! });
      expect(state.currentId).toBe(before);
    } else if (row.expected === "stop") {
      expect(outcome).toEqual<NavigationOutcome>({ kind: "stop" });
      // The current entry is kept, so Play starts it again from the beginning.
      expect(state.currentId).toBe(before);
    } else {
      expect(outcome).toEqual<NavigationOutcome>({ kind: "play", entryId: `e-${row.expected.plays}` });
      expect(trackOf(state)).toBe(row.expected.plays);
    }
  });

  it.each([
    [RESTART_THRESHOLD_SECONDS - 0.1, "play"],
    [RESTART_THRESHOLD_SECONDS, "restart"],
    [30, "restart"],
  ] as const)("previous at %s s gives %s (restart once a track is 5 s in)", (positionSeconds, kind) => {
    const { outcome } = navigate(queue({ start: "b" }), "previous", { positionSeconds });
    expect(outcome.kind).toBe(kind);
  });

  it("previous more than 5 s into the first track restarts it even with repeat off", () => {
    const { outcome } = navigate(queue({ start: "a", repeat: "off" }), "previous", { positionSeconds: 10 });
    expect(outcome).toEqual({ kind: "restart", entryId: "e-a" });
  });

  it.each(["next", "ended"] as const)("%s on a one-entry queue with repeat all restarts it", (action) => {
    const one = createQueue({ entries: entries("only"), repeat: "all", shuffle: true, random: firstChoice });
    expect(navigate(one, action, { positionSeconds: 1 }).outcome).toEqual({ kind: "restart", entryId: "e-only" });
  });

  it.each(["next", "previous", "ended"] as const)("%s on an empty queue stops", (action) => {
    const empty = createQueue({ entries: [], repeat: "all", shuffle: false });
    expect(navigate(empty, action, { positionSeconds: 0 }).outcome).toEqual({ kind: "stop" });
  });

  it("a shuffled queue with repeat all plays every entry once per round and never the same track twice in a row", () => {
    const random = seededRandom(42);
    let state = createQueue({ entries: entries("a", "b", "c", "d", "e"), repeat: "all", shuffle: true, random });
    const played: string[] = [trackOf(state)!];
    for (let i = 0; i < 5 * 40 - 1; i++) {
      state = navigate(state, "next", { positionSeconds: 0, random }).state;
      played.push(trackOf(state)!);
    }
    for (let round = 0; round < 40; round++) {
      expect([...played.slice(round * 5, round * 5 + 5)].sort()).toEqual(["a", "b", "c", "d", "e"]);
    }
    for (let i = 1; i < played.length; i++) {
      expect(played[i]).not.toBe(played[i - 1]);
    }
    // Rounds are reshuffled, so the order is not the same every time.
    expect(new Set(Array.from({ length: 40 }, (_, r) => played.slice(r * 5, r * 5 + 5).join(""))).size).toBeGreaterThan(1);
  });
});

describe("shuffleWithoutRepeats", () => {
  it("keeps every entry and never puts two entries of the same track side by side when that is possible", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const list = makeEntries(["a", "a", "a", "b", "b", "c", "a"], (_, i) => `e${i}`);
      const shuffled = shuffleWithoutRepeats(list, null, seededRandom(seed));
      expect(shuffled.map((e) => e.entryId).sort()).toEqual(list.map((e) => e.entryId).sort());
      for (let i = 1; i < shuffled.length; i++) {
        expect(shuffled[i].trackId, `seed ${seed}: ${shuffled.map((e) => e.trackId).join("")}`).not.toBe(shuffled[i - 1].trackId);
      }
    }
  });

  it("does not start with the track that was just playing", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const shuffled = shuffleWithoutRepeats(entries("a", "b", "c"), "a", seededRandom(seed));
      expect(shuffled[0].trackId).not.toBe("a");
    }
  });

  it("accepts repeats only when nothing else is left", () => {
    const list = makeEntries(["a", "a", "a"], (_, i) => `e${i}`);
    expect(shuffleWithoutRepeats(list, null, seededRandom(3))).toHaveLength(3);
  });
});

describe("setShuffle", () => {
  it("turning shuffle on keeps the current entry and puts it first in the play order", () => {
    const state = setShuffle(queue({ start: "c" }), true, seededRandom(7));
    expect(trackOf(state)).toBe("c");
    expect(state.order[0]).toBe("e-c");
  });

  it("turning shuffle off keeps the current entry and plays on in list order", () => {
    const shuffled = advanced(queue({ start: "b", shuffle: true }), 2, "all"); // b, a, c -> current c
    const state = setShuffle(shuffled, false);
    expect(trackOf(state)).toBe("c");
    expect(orderTracks(state)).toEqual(["a", "b", "c", "d"]);
    expect(navigate(state, "next", { positionSeconds: 0 }).outcome).toEqual({ kind: "play", entryId: "e-d" });
  });

  it("setting the same value changes nothing", () => {
    const state = queue({ shuffle: true, random: seededRandom(5) });
    expect(setShuffle(state, true, seededRandom(99))).toBe(state);
  });
});

/**
 * BUG-11 (QUEUE-1): the old reducer read "current" as a position in a shuffled
 * order even with shuffle off. The new model remembers the current entry by
 * its id, so removing any other entry can never change it.
 */
describe("remove (BUG-11)", () => {
  it.each([
    ["before", "a"],
    ["after", "d"],
  ])("with shuffle off, removing an entry %s the current one keeps the current track", (_, removed) => {
    // Shuffle was on (order b, a, c, d) and is now off: the order the old bug used.
    const state = setShuffle(queue({ start: "b", shuffle: true }), false);
    const after = remove(state, [`e-${removed}`]);
    expect(trackOf(after)).toBe("b");
    expect(orderTracks(after)).toEqual(["a", "b", "c", "d"].filter((t) => t !== removed));
  });

  it("with shuffle off, removing the current entry makes the next one in the list current", () => {
    const after = remove(queue({ start: "b" }), ["e-b"]);
    expect(trackOf(after)).toBe("c");
  });

  it("with shuffle on, removing the current entry makes the next one in play order current", () => {
    const after = remove(queue({ start: "b", shuffle: true }), ["e-b"]); // order b, a, c, d
    expect(trackOf(after)).toBe("a");
  });

  it("removing the last current entry wraps to the first with repeat all and leaves nothing current otherwise", () => {
    expect(trackOf(remove(queue({ start: "d" }), ["e-d"]))).toBe("a");
    expect(remove(setRepeat(queue({ start: "d" }), "off"), ["e-d"]).currentId).toBeNull();
  });

  it("removing several entries including the current skips all of them", () => {
    expect(trackOf(remove(queue({ start: "b" }), ["e-b", "e-c"]))).toBe("d");
  });

  it("with shuffle on, removing entries keeps the rest of the play order as it was", () => {
    const state = queue({ start: "c", shuffle: true, random: seededRandom(11) });
    const before = orderTracks(state).filter((t) => t !== "a");
    expect(orderTracks(remove(state, ["e-a"]))).toEqual(before);
  });

  it("removeTrack removes every entry of a track deleted from the library", () => {
    const state = createQueue({ entries: makeEntries(["a", "x", "b", "x"], (t, i) => `${t}${i}`), repeat: "all", shuffle: false });
    expect(removeTrack(state, "x").entries.map((e) => e.trackId)).toEqual(["a", "b"]);
  });

  it("ignores ids that are not in the queue", () => {
    const state = queue({ start: "b" });
    expect(remove(state, ["nope"])).toBe(state);
  });
});

describe("move", () => {
  it("with shuffle off, reordering moves the play order with it and keeps the current entry", () => {
    const state = move(queue({ start: "b" }), "e-d", 0);
    expect(orderTracks(state)).toEqual(["d", "a", "b", "c"]);
    expect(trackOf(state)).toBe("b");
    expect(navigate(state, "previous", { positionSeconds: 0 }).outcome).toEqual({ kind: "play", entryId: "e-a" });
  });

  it("moving the current entry keeps it current", () => {
    const state = move(queue({ start: "b" }), "e-b", 3);
    expect(orderTracks(state)).toEqual(["a", "c", "d", "b"]);
    expect(trackOf(state)).toBe("b");
  });

  it("with shuffle on, reordering the list leaves the play order alone (shuffle stays stable)", () => {
    const state = queue({ start: "b", shuffle: true, random: seededRandom(4) });
    const moved = move(state, "e-d", 0);
    expect(moved.entries.map((e) => e.trackId)).toEqual(["d", "a", "b", "c"]);
    expect(moved.order).toEqual(state.order);
  });

  it("clamps the target index and ignores unknown entries", () => {
    expect(orderTracks(move(queue(), "e-a", 99))).toEqual(["b", "c", "d", "a"]);
    const state = queue();
    expect(move(state, "nope", 0)).toBe(state);
  });
});

describe("insert", () => {
  it.each([false, true])("'next' plays the new entries straight after the current one (shuffle=%s)", (shuffle) => {
    const state = insert(queue({ start: "b", shuffle }), entries("x", "y"), "next");
    expect(trackOf(state)).toBe("b");
    expect(upNext(state, 2).map((e) => e.trackId)).toEqual(["x", "y"]);
  });

  it.each([false, true])("'end' adds the new entries after everything else (shuffle=%s)", (shuffle) => {
    const state = insert(queue({ start: "b", shuffle }), entries("x"), "end");
    expect(orderTracks(state)[state.order.length - 1]).toBe("x");
    expect(state.entries[state.entries.length - 1].trackId).toBe("x");
  });

  it("adding to an empty queue makes the first new entry current", () => {
    const empty = createQueue({ entries: [], repeat: "all", shuffle: false });
    expect(trackOf(insert(empty, entries("x", "y"), "end"))).toBe("x");
  });

  it("refuses an entry id that is already queued", () => {
    expect(() => insert(queue(), entries("a"), "end")).toThrow(/duplicate entry id/i);
  });
});

describe("jumpTo and upNext", () => {
  it("jumpTo makes any queued entry current without changing the order", () => {
    const state = jumpTo(queue({ start: "a" }), "e-c");
    expect(trackOf(state)).toBe("c");
    expect(jumpTo(state, "nope")).toBe(state);
  });

  it("upNext lists what plays next, wrapping only with repeat all", () => {
    expect(upNext(queue({ start: "c" }), 3).map((e) => e.trackId)).toEqual(["d", "a", "b"]);
    expect(upNext(setRepeat(queue({ start: "c" }), "off"), 3).map((e) => e.trackId)).toEqual(["d"]);
  });
});
