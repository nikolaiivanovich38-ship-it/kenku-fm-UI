/**
 * PLY-10, PLY-1, BUG-11: what a room's music plays now and next, as pure
 * functions over an immutable lane state. The player side (roomPlayer.ts)
 * starts and stops voices; these functions only decide.
 *
 * Rules, from the prototype's live view (design/prototype/src/views/live.js):
 * - A scene plays its music list in order (`sceneSequence`); a playlist plays
 *   its own tracks in order. Next and Previous step through that sequence and
 *   wrap round; a track never plays twice in a row (`stepSequence`).
 * - Play next puts a track in the queue: queued tracks play, in order, after
 *   the current track ends and before the sequence goes on.
 * - A track played off script (not from the scene or a playlist) remembers
 *   where the sequence would have gone next, and returns there when it ends.
 *   A second off-script track keeps the first return point.
 * - Previous ignores the queue.
 *
 * The current track is never a bare position. Each item keeps the track id
 * with its step number; when the scene or playlist changes under it (a track
 * deleted), `locate` finds the item again, so deleting a track never changes
 * which track is current, and Next and Previous go to its neighbours (BUG-11).
 */
import { playlistTracks, ProfilePlace, sceneSequence, SequenceStep, stepSequence } from "../../../common/domain";
import type { SceneRef, ShowLibrary } from "./library";

/** Where a playing track came from. `at` is its step in that scene's or playlist's sequence. */
export type Origin =
  | { kind: "scene"; scene: SceneRef; at: number }
  | { kind: "playlist"; playlistId: string; at: number }
  /** Off script: played on its own, from search or the library. */
  | { kind: "single" };

export interface Playing {
  trackId: string;
  origin: Origin;
  /** The playlist the track came through (also inside a scene), for its audio profile. */
  playlistId: string | null;
}

export interface QueuedItem {
  /** Unique within the queue, so one track can be queued twice. */
  entryId: string;
  item: Playing;
}

export interface MusicLane {
  current: Playing | null;
  /** Play next, in order. */
  queued: readonly QueuedItem[];
  /** After an off-script track (`from`): where the scene or playlist goes on. */
  returnTo: { from: string; item: Playing } | null;
}

export const EMPTY_LANE: MusicLane = { current: null, queued: [], returnTo: null };

export function single(trackId: string): Playing {
  return { trackId, origin: { kind: "single" }, playlistId: null };
}

/** The item at step `at` of a scene's music, or null when there is no such step. */
export function sceneItem(scene: SceneRef, at: number, lib: ShowLibrary): Playing | null {
  const seq = sequenceOf({ kind: "scene", scene, at }, lib);
  const step = seq[at];
  return step ? { trackId: step.trackId, origin: { kind: "scene", scene, at }, playlistId: step.playlistId } : null;
}

/** A playlist's track `trackId` (its first copy), or its first track when `trackId` is null. */
export function playlistItem(playlistId: string, trackId: string | null, lib: ShowLibrary): Playing | null {
  const seq = sequenceOf({ kind: "playlist", playlistId, at: 0 }, lib);
  const at = trackId === null ? 0 : seq.findIndex((step) => step.trackId === trackId);
  const step = seq[at];
  return step ? { trackId: step.trackId, origin: { kind: "playlist", playlistId, at }, playlistId } : null;
}

/** Where an item's audio profile may come from, most specific first (resolveProfile's order). */
export function placesOf(item: Playing): ProfilePlace[] {
  const places: ProfilePlace[] = [];
  if (item.origin.kind === "scene") {
    places.push({ kind: "scene", ...item.origin.scene });
  }
  if (item.playlistId) {
    places.push({ kind: "playlist", playlistId: item.playlistId });
  }
  return places;
}

/** The steps of the scene or playlist an item came from, as they are now. */
export function sequenceOf(origin: Origin, lib: ShowLibrary): SequenceStep[] {
  if (origin.kind === "scene") {
    const scene = lib.scene(origin.scene);
    return scene ? sceneSequence(scene, lib) : [];
  }
  if (origin.kind === "playlist") {
    const playlist = lib.playlist(origin.playlistId);
    return playlist ? playlistTracks(playlist, lib).map((t) => ({ trackId: t.id, itemIndex: 0, playlistId: playlist.id })) : [];
  }
  return [];
}

/**
 * Find an item in its sequence as it is now: its own step if it still holds
 * the track, else the nearest step with the same track (from the same
 * playlist, in a scene). `found: false` when the track left the sequence:
 * `index` is then where it was, which now holds the step after it.
 */
export function locate(seq: readonly SequenceStep[], item: Playing): { index: number; found: boolean } {
  const at = item.origin.kind === "single" ? 0 : item.origin.at;
  const matches = (step: SequenceStep) => step.trackId === item.trackId && step.playlistId === item.playlistId;
  if (seq[at] && matches(seq[at])) {
    return { index: at, found: true };
  }
  let best = -1;
  seq.forEach((step, index) => {
    if (matches(step) && (best === -1 || Math.abs(index - at) < Math.abs(best - at))) {
      best = index;
    }
  });
  return best === -1 ? { index: at, found: false } : { index: best, found: true };
}

/** The next (1) or previous (-1) item in the item's scene or playlist; null off script or when it is empty. */
export function stepFrom(item: Playing, direction: 1 | -1, lib: ShowLibrary): Playing | null {
  if (item.origin.kind === "single") {
    return null;
  }
  const seq = sequenceOf(item.origin, lib);
  if (seq.length === 0) {
    return null;
  }
  const { index, found } = locate(seq, item);
  const wrap = (i: number) => ((i % seq.length) + seq.length) % seq.length;
  // A deleted current track: the step after it has slid into its place.
  const at = found ? stepSequence(seq, index, direction)! : wrap(direction === 1 ? index : index - 1);
  const step = seq[at];
  const origin: Origin = item.origin.kind === "scene" ? { kind: "scene", scene: item.origin.scene, at } : { kind: "playlist", playlistId: item.origin.playlistId, at };
  return { trackId: step.trackId, origin, playlistId: step.playlistId };
}

/**
 * Play `item` now. Off script, remember where to go back to: the return point
 * already kept by an earlier detour, else the step after the current track.
 */
export function playNow(lane: MusicLane, item: Playing, lib: ShowLibrary): MusicLane {
  if (item.origin.kind !== "single") {
    return { ...lane, current: item, returnTo: null };
  }
  const current = lane.current;
  const kept = current && lane.returnTo && lane.returnTo.from === current.trackId ? lane.returnTo.item : null;
  const back = kept ?? (current ? stepFrom(current, 1, lib) : null);
  return { ...lane, current: item, returnTo: back ? { from: item.trackId, item: back } : null };
}

/** Add to the end of the queue. (With nothing playing, the caller plays the item now instead.) */
export function queueNext(lane: MusicLane, entry: QueuedItem): MusicLane {
  return { ...lane, queued: [...lane.queued, entry] };
}

export function removeQueued(lane: MusicLane, entryId: string): MusicLane {
  return lane.queued.some((q) => q.entryId === entryId) ? { ...lane, queued: lane.queued.filter((q) => q.entryId !== entryId) } : lane;
}

/** What plays after the current track before the sequence moves on: the queue, then the return point. */
function pending(lane: MusicLane, lib: ShowLibrary): { item: Playing; queued: number } | null {
  const index = lane.queued.findIndex((q) => lib.track(q.item.trackId) !== undefined);
  if (index > -1) {
    return { item: lane.queued[index].item, queued: index };
  }
  if (lane.current && lane.returnTo && lane.returnTo.from === lane.current.trackId) {
    return { item: lane.returnTo.item, queued: -1 };
  }
  return null;
}

/**
 * Next, or the current track reached its end. `sequence: false` when the
 * track's profile says "stop": the queue and a return point still play, the
 * sequence does not move on by itself.
 */
export function advance(lane: MusicLane, lib: ShowLibrary, { sequence }: { sequence: boolean }): { lane: MusicLane; play: Playing | null } {
  const next = pending(lane, lib);
  if (next) {
    // Queued tracks that left the library before their turn are dropped with it.
    const queued = next.queued > -1 ? lane.queued.slice(next.queued + 1) : lane.queued;
    return { lane: playNow({ ...lane, queued }, next.item, lib), play: next.item };
  }
  const step = sequence && lane.current ? stepFrom(lane.current, 1, lib) : null;
  if (step) {
    return { lane: playNow(lane, step, lib), play: step };
  }
  return { lane: { ...lane, current: null }, play: null };
}

/** Previous: one step back in the sequence. The queue waits. */
export function previous(lane: MusicLane, lib: ShowLibrary): { lane: MusicLane; play: Playing | null } {
  const step = lane.current ? stepFrom(lane.current, -1, lib) : null;
  return step ? { lane: playNow(lane, step, lib), play: step } : { lane, play: null };
}

/** What Next would play now, for the screen. */
export function upNext(lane: MusicLane, lib: ShowLibrary): Playing | null {
  return pending(lane, lib)?.item ?? (lane.current ? stepFrom(lane.current, 1, lib) : null);
}
