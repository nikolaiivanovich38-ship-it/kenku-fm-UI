/**
 * PLY-16, PLY-17: each room's running list for the evening, as pure functions over an immutable state (design
 * /prototype/ROUND6.md part 3, "Play next, Add to queue and Repeat (the data for the contracts)"; the prototype's
 * views/live.js pickNext, nextAdded, upcoming, addItem, lvupx and lvclearq). Nothing here is saved.
 *
 * Nik, 6 Nov 12:14: "you have a tracklist, which has a top and a bottom - the first added and last added. Add to queue
 * should play after last added. We need a separate play next button." So a room plays its plan (a scene's music in
 * order, a playlist in its place's order, or one track) and keeps:
 * - Play next items (`pn`): they play right after the current track, the newest first;
 * - Add to queue items (`q`): after the bottom of the plan, in the order added. With Repeat all they come round
 *   again with the rest; otherwise each plays once and leaves the list;
 * - skips: planned tracks taken out of Up next for this evening, by their key in the plan.
 * After the bottom a scene starts again from its top, as it always has; a playlist does with Repeat all, else it stops.
 * The last add, removal or Clear added can be undone once.
 *
 * Nik, 6 Nov 12:24: the room's Repeat (`repeat`) is for what plays now only: null until pressed (the music then does
 * what it does by itself: shownRepeat), never saved, back to null when the music stops or a new plan starts.
 * Nik, 11 Nov (0.5.1): the room's Shuffle (`shuffle`) works like its Repeat: for what plays now, never saved, off again
 * when the music stops or a new plan starts. On, it is a deal of the plan's steps (their keys in a random order, the
 * host deals it): the plan plays, and Up next lists, in that order instead of its own.
 * Nik, 6 Nov 13:55: a new scene clears what was added (sceneStarted); the scene's Undo brings it back (the host keeps
 * the list in the scene's undo snapshot).
 *
 * The host (the audio engine's RoomPlayer) owns the plan itself: it gives each call a PlanView of the plan's steps and
 * where it is, and plays what `pickNext` picks.
 */
import type { Repeat } from "./types";

/** The room's own Repeat: null until the game master presses it (then off, all, one in turn). */
export type RoomRepeat = Repeat | null;

/** Something added to a room's list: one track, or a playlist's tracks in its place's order (one item). */
export interface ListItem {
  /** Unique within the room. */
  id: string;
  trackIds: readonly string[];
  /** The playlist it came from (its audio settings and volume choice apply), or null for a single track. */
  playlistId: string | null;
  /** Where it came from ("ss:<campaign>:<session>", "sc:…", "cp:…"), for its audio settings there; null for none. */
  placeKey: string | null;
  /** What Up next calls it (a playlist's name, or the track's name where it was added from). */
  name: string;
}

/** One step of the room's plan, in playing order. `key` names it for a skip (its place in the scene or playlist). */
export interface PlanStep {
  trackId: string;
  playlistId: string | null;
  key: string;
}

/** The plan as the host sees it now. */
export interface PlanView {
  steps: readonly PlanStep[];
  /** The step playing now, when the plan plays; null when nothing from the plan plays. */
  at: number | null;
  /**
   * When the track at `at` ended by itself, the step its play order picks inside the plan instead of moving on (a
   * scene's playlist with Repeat all goes back to its first track); null to move on.
   */
  inner: number | null;
  /** After the bottom the plan starts again (a scene always; a playlist with Repeat all). */
  loops: boolean;
  /** Added items stay to come round again (Repeat all: the room's, or the playlist's own). */
  keepAdded: boolean;
}

/** What plays now: the plan, a Play next item (taken off `pn`), or an added item (it stays in `q` while it plays). */
export type ListNow = { kind: "plan" } | { kind: "pn"; item: ListItem; at: number } | { kind: "q"; id: string; at: number };

/** What Undo takes back: the last add, removal or Clear added. */
export type ListUndo =
  | { kind: "add"; id: string; skip: string | null }
  | { kind: "remove"; source: "pn" | "q"; item: ListItem; index: number }
  | { kind: "skip"; key: string }
  | { kind: "rest"; itemId: string; trackIds: readonly string[] }
  | { kind: "clear"; pn: readonly ListItem[]; q: readonly ListItem[] };

export interface RoomList {
  pn: readonly ListItem[];
  q: readonly ListItem[];
  now: ListNow;
  /** The plan step to carry on after, while something added plays (where the list left the plan). */
  ret: number | null;
  /** A Play next item interrupted an added item: after it, the queue goes on from here. */
  backToQueue: { id: string; at: number } | null;
  skips: readonly string[];
  repeat: RoomRepeat;
  /** 0.5.1: the room's Shuffle: the plan's step keys in the dealt order; null while it is off. */
  shuffle: readonly string[] | null;
  undo: ListUndo | null;
}

/** What to play next: a plan step, or one track of an added item. */
export type ListPick = { from: "plan"; at: number } | { from: "added"; item: ListItem; at: number; trackId: string };

/** Names one Up next entry for ×: an added item, the rest of the added playlist that plays, or a planned step. */
export type UpNextRef = { kind: "added"; itemId: string } | { kind: "rest"; itemId: string } | { kind: "plan"; key: string };

export type UpNextEntry =
  | { kind: "plan"; ref: UpNextRef; at: number; trackId: string; playlistId: string | null }
  | {
      kind: "added";
      ref: UpNextRef;
      /** Play next ("Play next: …") or Add to queue ("Added: …"). */
      source: "pn" | "q";
      itemId: string;
      /** The tracks still to play of it. */
      trackIds: readonly string[];
      name: string;
      playlistId: string | null;
      placeKey: string | null;
      /** The rest of an item that plays now. */
      rest: boolean;
    };

const PLAN: ListNow = { kind: "plan" };

export function emptyRoomList(): RoomList {
  return { pn: [], q: [], now: PLAN, ret: null, backToQueue: null, skips: [], repeat: null, shuffle: null, undo: null };
}

/* ---------- the plan ---------- */

/** The plan's steps in the order they play: their own, or the room's Shuffle deal (steps it does not name last). */
function playOrder(list: RoomList, plan: PlanView): number[] {
  const own = plan.steps.map((_, i) => i);
  if (!list.shuffle) return own;
  const byKey = new Map<string, number>();
  plan.steps.forEach((s, i) => byKey.has(s.key) || byKey.set(s.key, i));
  const dealt = list.shuffle.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  return [...new Set([...dealt, ...own])];
}

/** The first step after `from` that is not skipped and is not the same track again; null at the bottom. */
function after(list: RoomList, plan: PlanView, from: number | null): number | null {
  const last = from === null ? undefined : plan.steps[from]?.trackId;
  const order = playOrder(list, plan);
  for (let o = from === null ? 0 : order.indexOf(from) + 1; o < order.length; o++) {
    const i = order[o];
    if (list.skips.includes(plan.steps[i].key) || plan.steps[i].trackId === last) continue;
    return i;
  }
  return null;
}

function top(list: RoomList, plan: PlanView): number | null {
  const i = playOrder(list, plan).find((at) => !list.skips.includes(plan.steps[at].key));
  return i === undefined ? null : i;
}

/** Where the plan is: the step playing, or the one the list left it at. */
function planPos(list: RoomList, plan: PlanView): number | null {
  return list.now.kind === "plan" ? plan.at : list.ret;
}

/* ---------- what plays next ---------- */

const pickAdded = (item: ListItem, at: number): ListPick => ({ from: "added", item, at, trackId: item.trackIds[at] });

/** Starting an added item leaves nothing for the Undo of its add to take back. */
function started(list: RoomList, item: ListItem): RoomList {
  return list.undo?.kind === "add" && list.undo.id === item.id ? { ...list, undo: null } : list;
}

/** The current added item's track again (Repeat one), or the plan's. */
function again(list: RoomList, plan: PlanView): ListPick | null {
  const now = list.now;
  if (now.kind === "pn") return pickAdded(now.item, now.at);
  if (now.kind === "q") {
    const item = list.q.find((i) => i.id === now.id);
    return item ? pickAdded(item, now.at) : null;
  }
  return plan.at === null ? null : { from: "plan", at: plan.at };
}

/**
 * What the room plays when its track ends by itself (`ended`) or on Next. `repeat` is what applies to the track now
 * (shownRepeat): "one" plays it again when it ends; Next always moves on.
 */
export function pickNext(list: RoomList, plan: PlanView, how: { ended: boolean; repeat: Repeat }): { list: RoomList; pick: ListPick | null } {
  if (how.ended && how.repeat === "one") {
    const same = again(list, plan);
    if (same) return { list, pick: same };
  }
  const now = list.now;
  // 1. The rest of a Play next playlist that plays.
  if (now.kind === "pn" && now.at < now.item.trackIds.length - 1) {
    return { list: { ...list, now: { ...now, at: now.at + 1 } }, pick: pickAdded(now.item, now.at + 1) };
  }
  // 2. Play next, right after the current track.
  if (list.pn.length > 0) {
    const [item, ...pn] = list.pn;
    let next: RoomList = { ...list, pn, now: { kind: "pn", item, at: 0 } };
    if (now.kind === "plan") next = { ...next, ret: plan.at, backToQueue: null };
    else if (now.kind === "q") next = { ...next, backToQueue: { id: now.id, at: now.at } };
    return { list: started(next, item), pick: pickAdded(item, 0) };
  }
  // 3. After Play next, back to where the list was: the queue it interrupted, or the plan.
  if (now.kind === "pn") {
    if (list.backToQueue && list.q.some((i) => i.id === list.backToQueue!.id)) {
      return nextAdded({ ...list, now: { kind: "q", ...list.backToQueue }, backToQueue: null }, plan);
    }
    return fromPlan({ ...list, now: PLAN, backToQueue: null }, plan, list.ret, false);
  }
  if (now.kind === "q") return nextAdded(list, plan);
  return fromPlan(list, plan, plan.at, how.ended);
}

/** The plan's next step from `pos`; at its bottom, what was added, then round again or stop. */
function fromPlan(list: RoomList, plan: PlanView, pos: number | null, ended: boolean): { list: RoomList; pick: ListPick | null } {
  if (ended && pos !== null && plan.inner !== null) return { list: { ...list, now: PLAN, ret: null }, pick: { from: "plan", at: plan.inner } };
  const next = after(list, plan, pos);
  if (next !== null) return { list: { ...list, now: PLAN, ret: null }, pick: { from: "plan", at: next } };
  if (list.q.length > 0) {
    const item = list.q[0];
    return { list: started({ ...list, now: { kind: "q", id: item.id, at: 0 }, ret: pos }, item), pick: pickAdded(item, 0) };
  }
  return planEnd(list, plan, plan.loops);
}

function planEnd(list: RoomList, plan: PlanView, loops: boolean): { list: RoomList; pick: ListPick | null } {
  const first = loops ? top(list, plan) : null;
  return { list: { ...list, now: PLAN, ret: null }, pick: first === null ? null : { from: "plan", at: first } };
}

/** The queue goes on: the rest of the added item, the next one, then back to the plan's top (or stop). */
function nextAdded(list: RoomList, plan: PlanView): { list: RoomList; pick: ListPick | null } {
  const now = list.now as Extract<ListNow, { kind: "q" }>;
  const index = list.q.findIndex((i) => i.id === now.id);
  const item = list.q[index];
  if (item && now.at < item.trackIds.length - 1) {
    return { list: { ...list, now: { ...now, at: now.at + 1 } }, pick: pickAdded(item, now.at + 1) };
  }
  const q = item && !plan.keepAdded ? list.q.filter((i) => i.id !== item.id) : list.q;
  const nextIndex = item && plan.keepAdded ? index + 1 : Math.max(0, index);
  const following = q[nextIndex];
  if (following) {
    return { list: started({ ...list, q, now: { kind: "q", id: following.id, at: 0 } }, following), pick: pickAdded(following, 0) };
  }
  return planEnd({ ...list, q }, plan, plan.keepAdded || plan.loops);
}

/**
 * Play on air of a single track while the plan plays: it plays now, and the list carries on after it, as a Play next
 * item would. With nothing playing there is nothing to carry on: `pick` is null and the host plays it as a new plan.
 */
export function playNow(list: RoomList, item: ListItem, plan: PlanView): { list: RoomList; pick: ListPick | null } {
  if (list.now.kind === "plan" && plan.at === null) return { list: newPlan(list), pick: null };
  let next: RoomList = { ...list, now: { kind: "pn", item, at: 0 } };
  if (list.now.kind === "plan") next = { ...next, ret: plan.at, backToQueue: null };
  else if (list.now.kind === "q") next = { ...next, backToQueue: { id: list.now.id, at: list.now.at } };
  return { list: next, pick: pickAdded(item, 0) };
}

/* ---------- adding, removing, clearing, undo ---------- */

/**
 * Play next: right after the current track, before earlier Play next items and before the rest of a Play next
 * playlist that plays. Play next of the track the plan plays next anyway plays it once (the planned one is skipped).
 */
export function playNext(list: RoomList, item: ListItem, plan: PlanView): RoomList {
  let pn = list.pn;
  let now = list.now;
  if (now.kind === "pn" && now.at < now.item.trackIds.length - 1) {
    const rest: ListItem = { ...now.item, id: `${now.item.id}~${now.at + 1}`, trackIds: now.item.trackIds.slice(now.at + 1) };
    pn = [rest, ...pn];
    now = { ...now, item: { ...now.item, trackIds: now.item.trackIds.slice(0, now.at + 1) } };
  }
  let skip: string | null = null;
  if (item.trackIds.length === 1 && list.pn.length === 0) {
    const first = upNext({ ...list, now }, plan)[0];
    if (first?.kind === "plan" && first.trackId === item.trackIds[0] && first.ref.kind === "plan") skip = first.ref.key;
  }
  return { ...list, now, pn: [item, ...pn], skips: skip ? [...list.skips, skip] : list.skips, undo: { kind: "add", id: item.id, skip } };
}

/** Add to queue: at the bottom of the room's list, after the last item added. */
export function addToQueue(list: RoomList, item: ListItem): RoomList {
  return { ...list, q: [...list.q, item], undo: { kind: "add", id: item.id, skip: null } };
}

/** × in Up next: a planned track is skipped this evening, an added item goes, or the rest of the one that plays. */
export function removeFromUpNext(list: RoomList, ref: UpNextRef): RoomList {
  if (ref.kind === "plan") {
    return list.skips.includes(ref.key) ? list : { ...list, skips: [...list.skips, ref.key], undo: { kind: "skip", key: ref.key } };
  }
  if (ref.kind === "rest") {
    const now = list.now;
    if (now.kind === "pn" && now.item.id === ref.itemId) {
      const item = { ...now.item, trackIds: now.item.trackIds.slice(0, now.at + 1) };
      return { ...list, now: { ...now, item }, undo: { kind: "rest", itemId: ref.itemId, trackIds: now.item.trackIds } };
    }
    if (now.kind === "q" && now.id === ref.itemId) {
      const old = list.q.find((i) => i.id === ref.itemId);
      if (!old) return list;
      const q = list.q.map((i) => (i.id === ref.itemId ? { ...i, trackIds: i.trackIds.slice(0, now.at + 1) } : i));
      return { ...list, q, undo: { kind: "rest", itemId: ref.itemId, trackIds: old.trackIds } };
    }
    return list;
  }
  const inPn = list.pn.findIndex((i) => i.id === ref.itemId);
  if (inPn > -1) return { ...list, pn: list.pn.filter((_, i) => i !== inPn), undo: { kind: "remove", source: "pn", item: list.pn[inPn], index: inPn } };
  const inQ = list.q.findIndex((i) => i.id === ref.itemId);
  // The added item that plays now is not in Up next; only the rest of it is.
  if (inQ > -1 && !(list.now.kind === "q" && list.now.id === ref.itemId)) {
    return { ...list, q: list.q.filter((_, i) => i !== inQ), undo: { kind: "remove", source: "q", item: list.q[inQ], index: inQ } };
  }
  return list;
}

/** Clear added: Play next and the queue empty; what plays now plays on, then the plan carries on. */
export function clearAdded(list: RoomList): RoomList {
  if (list.pn.length === 0 && list.q.length === 0) return list;
  const playing = list.now.kind === "q" ? list.now.id : null;
  return { ...list, pn: [], q: list.q.filter((i) => i.id === playing).map((i) => ({ ...i, trackIds: i.trackIds.slice(0, (list.now as { at: number }).at + 1) })), undo: { kind: "clear", pn: list.pn, q: list.q } };
}

/** Undo (Ctrl+Z, the 8-second strip) of the last add, removal or Clear added; once. */
export function undoLast(list: RoomList): RoomList {
  const u = list.undo;
  if (!u) return list;
  const base: RoomList = { ...list, undo: null };
  switch (u.kind) {
    case "add":
      return { ...base, pn: list.pn.filter((i) => i.id !== u.id), q: list.q.filter((i) => i.id !== u.id), skips: u.skip ? list.skips.filter((k) => k !== u.skip) : list.skips };
    case "skip":
      return { ...base, skips: list.skips.filter((k) => k !== u.key) };
    case "remove": {
      const into = u.source === "pn" ? list.pn : list.q;
      const back = [...into.slice(0, u.index), u.item, ...into.slice(u.index)];
      return u.source === "pn" ? { ...base, pn: back } : { ...base, q: back };
    }
    case "rest": {
      const now = list.now;
      if (now.kind === "pn" && now.item.id === u.itemId) return { ...base, now: { ...now, item: { ...now.item, trackIds: u.trackIds } } };
      return { ...base, q: list.q.map((i) => (i.id === u.itemId ? { ...i, trackIds: u.trackIds } : i)) };
    }
    case "clear": {
      const playingPn = list.now.kind === "pn" ? list.now.item.id : null;
      return { ...base, pn: u.pn.filter((i) => i.id !== playingPn), q: u.q };
    }
  }
}

/* ---------- plans, scenes, stopping, Repeat ---------- */

/** A new plan starts (Play on air of a playlist or a scene's track): what was added stays; skips and Repeat go. */
export function newPlan(list: RoomList): RoomList {
  return { ...list, now: PLAN, ret: null, backToQueue: null, skips: [], repeat: null, shuffle: null, undo: null };
}

/** A new scene starts (Nik, 6 Nov 13:55): a new plan, and what was added to the room's list is cleared. */
export function sceneStarted(list: RoomList): RoomList {
  return { ...newPlan(list), pn: [], q: [] };
}

/** The room's music stopped: its Repeat and Shuffle go back to not chosen; the lists stay for the evening. */
export function musicStopped(list: RoomList): RoomList {
  return { ...list, now: PLAN, ret: null, backToQueue: null, repeat: null, shuffle: null };
}

/** 0.5.1: the room's Shuffle on (a deal of the plan's step keys) or off (null). */
export function setRoomShuffle(list: RoomList, deal: readonly string[] | null): RoomList {
  return { ...list, shuffle: deal };
}

export function setRoomRepeat(list: RoomList, repeat: RoomRepeat): RoomList {
  return { ...list, repeat };
}

/**
 * The Repeat a room shows for what plays now: the one pressed, else what the music does by itself (a scene track's
 * saved Repeat one, else its playlist's play order where it plays from, else off).
 */
export function shownRepeat(room: RoomRepeat, own: { savedOne: boolean; playlistRepeat: Repeat | null }): Repeat {
  if (room) return room;
  if (own.savedOne) return "one";
  return own.playlistRepeat ?? "off";
}

/** Pressing Repeat: off, all, one in turn, from what it shows. */
export function nextRepeat(shown: Repeat): Repeat {
  return shown === "off" ? "all" : shown === "all" ? "one" : "off";
}

/* ---------- Up next ---------- */

/** Up next, top to bottom: Play next items, the planned tracks still to come, then what was added. */
export function upNext(list: RoomList, plan: PlanView): UpNextEntry[] {
  const out: UpNextEntry[] = [];
  const added = (item: ListItem, source: "pn" | "q", from: number, rest: boolean): UpNextEntry => ({
    kind: "added",
    ref: rest ? { kind: "rest", itemId: item.id } : { kind: "added", itemId: item.id },
    source,
    itemId: item.id,
    trackIds: item.trackIds.slice(from),
    name: item.name,
    playlistId: item.playlistId,
    placeKey: item.placeKey,
    rest,
  });
  const now = list.now;
  if (now.kind === "pn" && now.at < now.item.trackIds.length - 1) out.push(added(now.item, "pn", now.at + 1, true));
  for (const item of list.pn) out.push(added(item, "pn", 0, false));
  const inQueue = now.kind === "q" || (now.kind === "pn" && list.backToQueue !== null);
  if (!inQueue) {
    for (let at = after(list, plan, planPos(list, plan)); at !== null; at = after(list, plan, at)) {
      const step = plan.steps[at];
      out.push({ kind: "plan", ref: { kind: "plan", key: step.key }, at, trackId: step.trackId, playlistId: step.playlistId });
    }
  }
  const queuePos = now.kind === "q" ? now : now.kind === "pn" ? list.backToQueue : null;
  const from = queuePos ? list.q.findIndex((i) => i.id === queuePos.id) : -1;
  list.q.forEach((item, i) => {
    if (queuePos && i < from) return;
    if (queuePos && i === from) {
      if (queuePos.at < item.trackIds.length - 1) out.push(added(item, "q", queuePos.at + 1, true));
      return;
    }
    out.push(added(item, "q", 0, false));
  });
  return out;
}
