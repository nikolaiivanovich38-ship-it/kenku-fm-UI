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
import {
  DEFAULT_ORDER_ALONE,
  playlistTracks,
  profilePlacesFor,
  resolvePlayOrder,
  keyOfPlace,
  stepSequence,
  tracksInOrder,
  tracksInPlaceOrder,
  whenTrackEnds,
  type PlayOrder,
  type ProfilePlace,
  type SequenceStep,
  type UsePlace,
} from "../../../common/domain";
import type { SceneRef, ShowLibrary } from "./library";

/**
 * Where a playing track came from. `at` is its step in that scene's or playlist's sequence. PLY-13: `place` is the
 * session or campaign list a playlist was played from (its play order there); `seed` deals a shuffled playlist (the
 * same seed, the same order, so Up next and Live's lists agree with what plays).
 */
export type Origin =
  | { kind: "scene"; scene: SceneRef; at: number; seed?: number }
  | { kind: "playlist"; playlistId: string; at: number; place?: UsePlace | null; seed?: number }
  /**
   * Off script: played on its own, from search or the library, or (round 6) added to a room's list. `place`: the
   * session or campaign list it was added from, for its audio settings there.
   */
  | { kind: "single"; place?: UsePlace | null };

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

/** The item at step `at` of a scene's music, or null when there is no such step. `seed` deals its shuffled playlists. */
export function sceneItem(scene: SceneRef, at: number, lib: ShowLibrary, seed?: number): Playing | null {
  const origin: Origin = seed === undefined ? { kind: "scene", scene, at } : { kind: "scene", scene, at, seed };
  const seq = sequenceOf(origin, lib);
  const step = seq[at];
  return step ? { trackId: step.trackId, origin, playlistId: step.playlistId } : null;
}

/**
 * A playlist's track `trackId` (its first copy), or its first track when `trackId` is null (the first of the dealt
 * order when it shuffles). `place`: the session or campaign list it is played from; `seed` deals a shuffled order.
 */
export function playlistItem(playlistId: string, trackId: string | null, lib: ShowLibrary, from: { place?: UsePlace | null; seed?: number } = {}): Playing | null {
  const base: Origin = { kind: "playlist", playlistId, at: 0 };
  if (from.place) base.place = from.place;
  if (from.seed !== undefined) base.seed = from.seed;
  const seq = sequenceOf(base, lib);
  const at = trackId === null ? 0 : seq.findIndex((step) => step.trackId === trackId);
  const step = seq[at];
  return step ? { trackId: step.trackId, origin: { ...base, at }, playlistId } : null;
}

/** The place an item plays from, for its play order and audio settings: its scene, or the list it was played from. */
function placeOf(origin: Origin): UsePlace | null {
  if (origin.kind === "scene") return { kind: "scene", ...origin.scene };
  return origin.place ?? null;
}

/** Where an item's audio profile may come from, most specific first (resolveProfile's order; PLY-14 profilePlacesFor). */
export function placesOf(item: Playing): ProfilePlace[] {
  return profilePlacesFor(placeOf(item.origin), item.playlistId);
}

/** PLY-13: how a playlist plays where the item came from (resolvePlayOrder). */
export function playOrderOf(playlistId: string, origin: Origin, lib: ShowLibrary): PlayOrder {
  const { order, source } = resolvePlayOrder(playlistId, lib.playlist(playlistId)?.order ?? null, placeOf(origin), lib.playOrders?.() ?? {});
  // A playlist played on its own in its lane (a scene's ambience playlist too) has no next item to move on to.
  return source === "default" && origin.kind === "playlist" ? { ...DEFAULT_ORDER_ALONE } : order;
}

/**
 * The steps of the scene or playlist an item came from, as they are now: sceneSequence and playlistTracks, with each
 * playlist dealt in the play order that applies there (PLY-13). A scene's playlist item at index i is dealt with the
 * scene's seed plus i, so two shuffled playlists in one scene differ. In a scene, a shuffled playlist deals the track
 * played just before it last, so the shuffle never brings it straight back.
 */
export function sequenceOf(origin: Origin, lib: ShowLibrary): SequenceStep[] {
  const seed = origin.kind === "single" ? 0 : (origin.seed ?? 0);
  // ORG-13: the track order chosen where it plays from comes first; a shuffle deals from it.
  const place = placeOf(origin);
  const chosen = place ? lib.trackOrders?.()[keyOfPlace(place)] : undefined;
  const dealt = (playlistId: string, itemSeed: number) => {
    const playlist = lib.playlist(playlistId);
    return playlist ? tracksInOrder(tracksInPlaceOrder(playlistTracks(playlist, lib), chosen?.[playlistId]), playOrderOf(playlistId, origin, lib), itemSeed) : [];
  };
  if (origin.kind === "scene") {
    const scene = lib.scene(origin.scene);
    if (!scene) return [];
    const out: SequenceStep[] = [];
    scene.music.forEach((ref, itemIndex) => {
      if (ref.kind === "track") {
        if (lib.track(ref.id)) out.push({ trackId: ref.id, itemIndex, playlistId: null });
        return;
      }
      let tracks = dealt(ref.id, seed + itemIndex);
      // A shuffle never brings back at once the track the scene played just before the playlist: that track goes to
      // the end of the deal, after the playlist's other tracks (the wave 4 release run heard t13, t14, then t13).
      const before = out[out.length - 1]?.trackId;
      if (before && playOrderOf(ref.id, origin, lib).shuffle) tracks = [...tracks.filter((t) => t.id !== before), ...tracks.filter((t) => t.id === before)];
      for (const t of tracks) out.push({ trackId: t.id, itemIndex, playlistId: ref.id });
    });
    return out;
  }
  if (origin.kind === "playlist") {
    return dealt(origin.playlistId, seed).map((t) => ({ trackId: t.id, itemIndex: 0, playlistId: origin.playlistId }));
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
  return itemAt(item, seq, at);
}

/** The item at step `at` of the same scene or playlist as `item` (same place and seed). */
export function itemAt(item: Playing, seq: readonly SequenceStep[], at: number): Playing {
  const step = seq[at];
  const origin = { ...(item.origin as Exclude<Origin, { kind: "single" }>), at };
  return { trackId: step.trackId, origin, playlistId: step.playlistId };
}

/**
 * PLY-13: what plays when the item's track ended by itself, as its playlist's play order there says (whenTrackEnds):
 * the same track again, the playlist's next track, its first track, the scene's next item, or nothing. A track that
 * is not from a playlist steps on as before. `undefined`: not a playlist's track, step on as Next would.
 */
export function afterEnd(item: Playing, lib: ShowLibrary): Playing | null | undefined {
  if (item.origin.kind === "single" || !item.playlistId) return undefined;
  const seq = sequenceOf(item.origin, lib);
  const { index, found } = locate(seq, item);
  if (!found) return undefined;
  const inScene = item.origin.kind === "scene";
  const itemIndex = seq[index].itemIndex;
  const first = inScene ? seq.findIndex((s) => s.itemIndex === itemIndex) : 0;
  const atLast = inScene ? seq[index + 1]?.itemIndex !== itemIndex : index === seq.length - 1;
  switch (whenTrackEnds(playOrderOf(item.playlistId, item.origin, lib), { atLast, inScene })) {
    case "again":
      return itemAt(item, seq, index);
    case "first":
      return itemAt(item, seq, first);
    case "stop":
      return null;
    default:
      return undefined;
  }
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

/** PLY-13: what plays after `item`'s track ended by itself: its play order's choice, else its sequence's next step. */
export function afterTrackEnded(item: Playing, lib: ShowLibrary): Playing | null {
  const byOrder = afterEnd(item, lib);
  return byOrder === undefined ? stepFrom(item, 1, lib) : byOrder;
}

/**
 * Next, or the current track reached its end (`ended`). `sequence: false` when the
 * track's profile says "stop": the queue and a return point still play, the
 * sequence does not move on by itself. A track that ended by itself goes on as
 * its playlist's play order says (PLY-13); Next always moves on.
 */
export function advance(lane: MusicLane, lib: ShowLibrary, { sequence, ended = false }: { sequence: boolean; ended?: boolean }): { lane: MusicLane; play: Playing | null } {
  const next = pending(lane, lib);
  if (next) {
    // Queued tracks that left the library before their turn are dropped with it.
    const queued = next.queued > -1 ? lane.queued.slice(next.queued + 1) : lane.queued;
    return { lane: playNow({ ...lane, queued }, next.item, lib), play: next.item };
  }
  const byOrder = sequence && ended && lane.current ? afterEnd(lane.current, lib) : undefined;
  if (byOrder !== undefined) {
    return byOrder ? { lane: playNow(lane, byOrder, lib), play: byOrder } : { lane: { ...lane, current: null }, play: null };
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
