/**
 * PLY-16, PLY-17: each room's running list for the evening (design/prototype/ROUND6.md part 3, "Play next, Add to queue
 * and Repeat (the data for the contracts)"; R6-NIK-DECISIONS.md 12:14, 12:24 and 13:55). The prototype's rules
 * (views/live.js pickNext, nextAdded, upcoming, addItem, lvupx, lvclearq, changeScene) as a pure model.
 */
import { describe, expect, it } from "vitest";
import {
  addToQueue,
  clearAdded,
  emptyRoomList,
  musicStopped,
  newPlan,
  nextRepeat,
  pickNext,
  playNext,
  playNow,
  removeFromUpNext,
  sceneStarted,
  setRoomRepeat,
  shownRepeat,
  undoLast,
  upNext,
  type ListItem,
  type ListPick,
  type PlanView,
  type RoomList,
} from "./roomList";

/** A scene's plan: four tracks, a to d. */
const steps = ["a", "b", "c", "d"].map((t, i) => ({ trackId: t, playlistId: null, key: `s:${i}` }));
const scene = (at: number | null, extra: Partial<PlanView> = {}): PlanView => ({ steps, at, inner: null, loops: true, keepAdded: false, ...extra });
/** A playlist played on its own: Repeat all (its own, or the room's) starts it again and keeps what was added. */
const playlistAlone = (at: number | null, repeatAll = false): PlanView => ({ steps, at, inner: null, loops: repeatAll, keepAdded: repeatAll });

const track = (id: string, t = id): ListItem => ({ id, trackIds: [t], playlistId: null, placeKey: null, name: `Track ${t}` });
const playlist = (id: string, ...tracks: string[]): ListItem => ({ id, trackIds: tracks, playlistId: "pl", placeKey: "ss:c:s", name: `Playlist ${id}` });

/** Play `count` tracks to their end, starting with the plan at `at`; the tracks in the order they played. */
function playThrough(list: RoomList, plan: (at: number | null) => PlanView, at: number, count: number, repeat: "off" | "all" | "one" = "off") {
  const played: string[] = [];
  let planAt: number | null = at;
  for (let i = 0; i < count; i++) {
    const r = pickNext(list, plan(planAt), { ended: true, repeat });
    list = r.list;
    if (!r.pick) {
      played.push("(stop)");
      break;
    }
    played.push(trackOf(r.pick));
    planAt = r.pick.from === "plan" ? r.pick.at : planAt;
  }
  return { list, played };
}
const trackOf = (pick: ListPick) => (pick.from === "plan" ? steps[pick.at].trackId : pick.trackId);
const upNextTracks = (list: RoomList, plan: PlanView) => upNext(list, plan).flatMap((e) => (e.kind === "plan" ? [e.trackId] : e.trackIds));

describe("a room's plan on its own", () => {
  it("a scene plays in order and starts again from its top", () => {
    expect(playThrough(emptyRoomList(), scene, 0, 5).played).toEqual(["b", "c", "d", "a", "b"]);
  });

  it("a playlist on its own stops after its last track, or starts again with Repeat all", () => {
    expect(playThrough(emptyRoomList(), (at) => playlistAlone(at), 2, 3).played).toEqual(["d", "(stop)"]);
    expect(playThrough(emptyRoomList(), (at) => playlistAlone(at, true), 2, 3).played).toEqual(["d", "a", "b"]);
  });

  it("the play order's own choice where the track ended (a scene's playlist with Repeat all) comes before moving on", () => {
    const r = pickNext(emptyRoomList(), scene(3, { inner: 1 }), { ended: true, repeat: "off" });
    expect(r.pick).toEqual({ from: "plan", at: 1 });
    // Next always moves on.
    expect(pickNext(emptyRoomList(), scene(3, { inner: 1 }), { ended: false, repeat: "off" }).pick).toEqual({ from: "plan", at: 0 });
  });

  it("Repeat one plays the track again when it ends; Next still moves on", () => {
    expect(pickNext(emptyRoomList(), scene(1), { ended: true, repeat: "one" }).pick).toEqual({ from: "plan", at: 1 });
    expect(pickNext(emptyRoomList(), scene(1), { ended: false, repeat: "one" }).pick).toEqual({ from: "plan", at: 2 });
  });

  it("a track never plays twice in a row", () => {
    const twice = [...steps.slice(0, 2), { trackId: "b", playlistId: "pl", key: "s:x" }, steps[3]];
    const r = pickNext(emptyRoomList(), { steps: twice, at: 1, inner: null, loops: true, keepAdded: false }, { ended: true, repeat: "off" });
    expect(r.pick).toEqual({ from: "plan", at: 3 });
  });
});

describe("Play next and Add to queue (Nik, 6 Nov 12:14)", () => {
  it("Play next plays right after the current track, the newest first, then the plan carries on where it was", () => {
    let list = playNext(emptyRoomList(), track("n1", "x"), scene(0));
    list = playNext(list, track("n2", "y"), scene(0));
    expect(upNextTracks(list, scene(0))).toEqual(["y", "x", "b", "c", "d"]);
    expect(playThrough(list, scene, 0, 4).played).toEqual(["y", "x", "b", "c"]);
  });

  it("Add to queue plays after the bottom of the plan, in the order added, once each; then the plan starts again", () => {
    let list = addToQueue(emptyRoomList(), track("q1", "x"));
    list = addToQueue(list, playlist("q2", "y", "z"));
    expect(upNextTracks(list, scene(1))).toEqual(["c", "d", "x", "y", "z"]);
    const run = playThrough(list, scene, 1, 7);
    expect(run.played).toEqual(["c", "d", "x", "y", "z", "a", "b"]);
    expect(run.list.q).toEqual([]);
  });

  it("with Repeat all, added items come round again with the rest", () => {
    const list = addToQueue(emptyRoomList(), track("q1", "x"));
    const run = playThrough(list, (at) => playlistAlone(at, true), 2, 6, "all");
    expect(run.played).toEqual(["d", "x", "a", "b", "c", "d"]);
    expect(run.list.q.map((i) => i.id)).toEqual(["q1"]);
  });

  it("a playlist on its own with no repeat stops after what was added", () => {
    const list = addToQueue(emptyRoomList(), track("q1", "x"));
    expect(playThrough(list, (at) => playlistAlone(at), 2, 4).played).toEqual(["d", "x", "(stop)"]);
  });

  it("Play next while an added playlist plays goes before the rest of it; the queue then carries on", () => {
    let list = addToQueue(emptyRoomList(), playlist("q1", "x", "y", "z"));
    let r = pickNext(list, scene(3), { ended: true, repeat: "off" });
    expect(r.pick).toMatchObject({ from: "added", trackId: "x" });
    list = playNext(r.list, track("n1", "n"), scene(null));
    expect(upNextTracks(list, scene(null))).toEqual(["n", "y", "z"]);
    const run = playThrough(list, scene, 3, 5);
    expect(run.played).toEqual(["n", "y", "z", "a", "b"]);
  });

  it("Play next of a Play next playlist that plays: the new item before the rest of it", () => {
    let list = playNext(emptyRoomList(), playlist("n1", "x", "y", "z"), scene(0));
    list = pickNext(list, scene(0), { ended: true, repeat: "off" }).list;
    list = playNext(list, track("n2", "n"), scene(null));
    expect(upNextTracks(list, scene(null))).toEqual(["n", "y", "z", "b", "c", "d"]);
  });

  it("Play next of the track the plan plays next anyway plays it once, and Undo brings the planned one back", () => {
    const list = playNext(emptyRoomList(), track("n1", "b"), scene(0));
    expect(upNextTracks(list, scene(0))).toEqual(["b", "c", "d"]);
    expect(upNextTracks(undoLast(list), scene(0))).toEqual(["b", "c", "d"]);
    expect(undoLast(list).pn).toEqual([]);
    expect(undoLast(list).skips).toEqual([]);
  });

  it("Previous-free: Next from an added item goes on as the list says", () => {
    const list = playNext(emptyRoomList(), track("n1", "x"), scene(1));
    const r = pickNext(list, scene(1), { ended: false, repeat: "off" });
    expect(trackOf(r.pick!)).toBe("x");
    expect(trackOf(pickNext(r.list, scene(null), { ended: false, repeat: "off" }).pick!)).toBe("c");
  });

  it("Play now of a single track while the plan plays: it plays at once and the plan carries on after it", () => {
    const { list, pick } = playNow(emptyRoomList(), track("p1", "x"), scene(1));
    expect(pick).toMatchObject({ from: "added", trackId: "x" });
    expect(playThrough(list, scene, 1, 2).played).toEqual(["c", "d"]);
  });
});

describe("Up next: × takes an entry out for this evening, Clear added, and Undo of the last of these", () => {
  it("lists Play next items, then the plan still to come, then what was added, each removable", () => {
    let list = addToQueue(emptyRoomList(), track("q1", "x"));
    list = playNext(list, track("n1", "y"), scene(1));
    const entries = upNext(list, scene(1));
    expect(entries.map((e) => e.kind + ":" + (e.kind === "plan" ? e.trackId : e.source))).toEqual(["added:pn", "plan:c", "plan:d", "added:q"]);
    expect(entries.every((e) => e.ref)).toBe(true);
  });

  it("a planned track taken out is skipped this evening (its place in the plan); Undo puts it back", () => {
    const list = removeFromUpNext(emptyRoomList(), { kind: "plan", key: "s:2" });
    expect(upNextTracks(list, scene(0))).toEqual(["b", "d"]);
    expect(playThrough(list, scene, 0, 4).played).toEqual(["b", "d", "a", "b"]);
    expect(upNextTracks(undoLast(list), scene(0))).toEqual(["b", "c", "d"]);
  });

  it("an added item taken out goes; Undo puts it back where it was", () => {
    let list = addToQueue(emptyRoomList(), track("q1", "x"));
    list = addToQueue(list, track("q2", "y"));
    list = addToQueue(list, track("q3", "z"));
    list = removeFromUpNext(list, { kind: "added", itemId: "q2" });
    expect(list.q.map((i) => i.id)).toEqual(["q1", "q3"]);
    expect(undoLast(list).q.map((i) => i.id)).toEqual(["q1", "q2", "q3"]);
  });

  it("the rest of an added playlist that plays can be taken out", () => {
    let list = addToQueue(emptyRoomList(), playlist("q1", "x", "y", "z"));
    list = pickNext(list, scene(3), { ended: true, repeat: "off" }).list;
    list = removeFromUpNext(list, { kind: "rest", itemId: "q1" });
    expect(upNextTracks(list, scene(null))).toEqual([]);
    expect(playThrough(list, scene, 3, 1).played).toEqual(["a"]);
  });

  it("Clear added empties Play next and the queue; Undo brings them back; Undo of an add takes it out again", () => {
    let list = addToQueue(emptyRoomList(), track("q1", "x"));
    list = playNext(list, track("n1", "y"), scene(0));
    const cleared = clearAdded(list);
    expect([cleared.pn, cleared.q]).toEqual([[], []]);
    expect(undoLast(cleared).pn.map((i) => i.id)).toEqual(["n1"]);
    expect(undoLast(cleared).q.map((i) => i.id)).toEqual(["q1"]);
    expect(undoLast(list).pn).toEqual([]);
    expect(undoLast(list).q.map((i) => i.id)).toEqual(["q1"]);
  });

  it("only the last add, removal or clear is undone, once; an added item that started has nothing to take back", () => {
    let list = playNext(emptyRoomList(), track("n1", "x"), scene(0));
    expect(undoLast(undoLast(list))).toEqual(undoLast(list));
    list = pickNext(list, scene(0), { ended: true, repeat: "off" }).list;
    expect(list.undo).toBeNull();
  });
});

describe("a new plan, a new scene, the music stopping", () => {
  it("a new plan (Play on air of a playlist or a scene's track) keeps what was added, forgets skips and the room's Repeat", () => {
    let list = addToQueue(emptyRoomList(), track("q1", "x"));
    list = removeFromUpNext(list, { kind: "plan", key: "s:1" });
    list = setRoomRepeat(list, "all");
    list = newPlan(list);
    expect(list.q.map((i) => i.id)).toEqual(["q1"]);
    expect([list.skips, list.repeat, list.undo]).toEqual([[], null, null]);
  });

  it("a new scene clears what was added to the room's list (Nik, 6 Nov 13:55)", () => {
    let list = addToQueue(emptyRoomList(), track("q1", "x"));
    list = playNext(list, track("n1", "y"), scene(0));
    list = sceneStarted(list);
    expect([list.pn, list.q, list.repeat]).toEqual([[], [], null]);
  });

  it("the room's Repeat goes back to not chosen when its music stops; the lists stay", () => {
    const list = musicStopped(setRoomRepeat(addToQueue(emptyRoomList(), track("q1", "x")), "one"));
    expect(list.repeat).toBeNull();
    expect(list.q).toHaveLength(1);
  });
});

describe("Repeat per room (Nik, 6 Nov 12:24: not saved, ends when the music stops)", () => {
  it("until it is pressed it shows what the music does by itself", () => {
    expect(shownRepeat(null, { savedOne: true, playlistRepeat: "all" })).toBe("one");
    expect(shownRepeat(null, { savedOne: false, playlistRepeat: "all" })).toBe("all");
    expect(shownRepeat(null, { savedOne: false, playlistRepeat: null })).toBe("off");
    expect(shownRepeat("off", { savedOne: true, playlistRepeat: "all" })).toBe("off");
  });

  it("pressing goes off, all, one in turn", () => {
    expect(["off", "all", "one"].map((r) => nextRepeat(r as "off"))).toEqual(["all", "one", "off"]);
  });
});
