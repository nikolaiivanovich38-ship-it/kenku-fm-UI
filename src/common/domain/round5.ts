/**
 * Design round 5 (design/prototype/ROUND5.md): the rules behind Nik's requests after testing 0.3.0.
 * Ported from the design prototype (design/prototype/src/core.js), where each rule is shown on screen.
 * Pure functions only: no storage, no audio.
 */
import type { DomainTrack, PlayOrder, ProfilePlace, TrackShape } from "./types";
import { SHAPE_WORDS } from "./types";

/* ---------- DAT-13 track shape ---------- */

/** A change of at least this much (on the 0-1 level scale) counts as the track moving. */
const SHAPE_STEP = 0.15;
/** A turn (up then down, or down then up) must be at least this deep, so ripples and single blips do not count. */
const TURN_DEPTH = 0.12;

/** The levels averaged into at most `bins` equal parts, so the shape reads the track's sections, not its beats. */
function smooth(levels: number[], bins: number): number[] {
  if (levels.length <= bins) return levels.slice();
  const out: number[] = [];
  for (let b = 0; b < bins; b++) {
    const from = Math.floor((b * levels.length) / bins), to = Math.floor(((b + 1) * levels.length) / bins);
    let sum = 0;
    for (let i = from; i < to; i++) sum += levels[i];
    out.push(sum / (to - from));
  }
  return out;
}

/** How many times the level turns round (rising, then falling, or the other way), ignoring turns shallower than TURN_DEPTH. */
function turns(levels: number[]): number {
  // dir: 0 until the level first moves by TURN_DEPTH, then 1 while rising and -1 while falling; ext is the highest
  // (rising) or lowest (falling) level since the last turn.
  let dir = 0, lo = levels[0], hi = levels[0], ext = levels[0], n = 0;
  for (const v of levels.slice(1)) {
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= TURN_DEPTH) dir = 1;
      else if (hi - v >= TURN_DEPTH) dir = -1;
      else continue;
      ext = v;
    } else if (dir === 1 ? v > ext : v < ext) {
      ext = v;
    } else if (Math.abs(v - ext) >= TURN_DEPTH) {
      n++;
      dir = -dir;
      ext = v;
    }
  }
  return n;
}

/**
 * DAT-13: the shape Lyre suggests from a track's loudness peaks, read from start to end.
 * `levels` are peak levels on a 0-1 dB scale (0 silence, 1 full scale), evenly spaced through the track; at least 4.
 * Steady: the level stays within a small range. Rises and falls: it turns round twice or more. Peaks then falls: its
 * high point is well above both its start and its end. Builds: it ends well above where it starts. Falls away: it ends
 * well below. Any other single turn (a dip in the middle) counts as rising and falling.
 */
export function shapeFromPeaks(levels: number[]): TrackShape | null {
  if (levels.length < 4) return null;
  const b = smooth(levels.map((v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))), 8);
  const max = Math.max(...b), min = Math.min(...b);
  if (max - min < SHAPE_STEP) return "steady";
  const n = turns(b);
  if (n >= 2) return "risesAndFalls";
  const start = b[0], end = b[b.length - 1];
  if (max - start >= SHAPE_STEP && max - end >= SHAPE_STEP) return "peaksThenFalls";
  if (end - start >= SHAPE_STEP) return "builds";
  if (start - end >= SHAPE_STEP) return "fallsAway";
  return n >= 1 ? "risesAndFalls" : "steady";
}

/** The shape that applies: the game master's choice, else Lyre's suggestion from the levels, else none. */
export function effectiveShape(chosen: TrackShape | null | undefined, levels: number[] | undefined): { shape: TrackShape | null; source: "chosen" | "suggested" | null } {
  if (chosen) return { shape: chosen, source: "chosen" };
  const s = levels ? shapeFromPeaks(levels) : null;
  return s ? { shape: s, source: "suggested" } : { shape: null, source: null };
}

/**
 * DAT-13: the shape that applies to a stored track: the game master's choice, else the suggestion the library keeps
 * with the track's loudness peaks (worked out by shapeFromPeaks when the peaks were saved), else none.
 */
export function shapeOf(t: Pick<DomainTrack, "shape" | "suggestedShape">): { shape: TrackShape | null; source: "chosen" | "suggested" | null } {
  if (t.shape) return { shape: t.shape, source: "chosen" };
  if (t.suggestedShape) return { shape: t.suggestedShape, source: "suggested" };
  return { shape: null, source: null };
}

/** The shape's word, as shown beside its glyph. */
export function trackShapeName(shape: TrackShape): string {
  return SHAPE_WORDS[shape];
}

/* ---------- places a playlist or track is used: scene, session, campaign ---------- */

/** A place where something is used. Choices made there (play order, a scene's name for a track) apply only there. */
export type UsePlace =
  | { kind: "scene"; campaignId: string; sessionId: string; sceneId: string }
  | { kind: "session"; campaignId: string; sessionId: string }
  | { kind: "campaign"; campaignId: string };

/** A place as a key: "sc:<campaign>:<session>:<scene>" (the same as an audio profile's scene key), "ss:<campaign>:<session>", "cp:<campaign>". */
export function keyOfPlace(p: UsePlace): string {
  if (p.kind === "scene") return `sc:${p.campaignId}:${p.sessionId}:${p.sceneId}`;
  if (p.kind === "session") return `ss:${p.campaignId}:${p.sessionId}`;
  return `cp:${p.campaignId}`;
}

export function parseKeyOfPlace(key: string): UsePlace | null {
  const a = key.split(":");
  if (!a.every(Boolean)) return null;
  if (a[0] === "sc" && a.length === 4) return { kind: "scene", campaignId: a[1], sessionId: a[2], sceneId: a[3] };
  if (a[0] === "ss" && a.length === 3) return { kind: "session", campaignId: a[1], sessionId: a[2] };
  if (a[0] === "cp" && a.length === 2) return { kind: "campaign", campaignId: a[1] };
  return null;
}

/* ---------- PLY-13 play order ---------- */

/** Play order chosen for a playlist in one place: by place key (keyOfPlace), then playlist id. */
export type PlayOrderOverrides = Record<string, Record<string, PlayOrder>>;

/** A playlist with no choice of its own, played on its own: in order, starting again after its last track. */
export const DEFAULT_ORDER_ALONE: PlayOrder = Object.freeze({ shuffle: false, repeat: "all" }) as PlayOrder;
/** The same playlist in a scene: in order, and after its last track the scene moves on to its next item. */
export const DEFAULT_ORDER_IN_SCENE: PlayOrder = Object.freeze({ shuffle: false, repeat: "off" }) as PlayOrder;

/**
 * PLY-13: the play order of a playlist where it is used. The place's own choice wins; otherwise the playlist's own;
 * otherwise the default for that kind of place. A session's choice does not reach its scenes: each place is its own.
 */
export function resolvePlayOrder(
  playlistId: string,
  own: PlayOrder | null | undefined,
  place: UsePlace | null,
  overrides: PlayOrderOverrides,
): { order: PlayOrder; source: "place" | "playlist" | "default" } {
  const here = place ? overrides[keyOfPlace(place)]?.[playlistId] : undefined;
  if (here) return { order: { shuffle: here.shuffle, repeat: here.repeat }, source: "place" };
  if (own) return { order: { shuffle: own.shuffle, repeat: own.repeat }, source: "playlist" };
  const d = place?.kind === "scene" ? DEFAULT_ORDER_IN_SCENE : DEFAULT_ORDER_ALONE;
  return { order: { shuffle: d.shuffle, repeat: d.repeat }, source: "default" };
}

/**
 * What happens when a track from a playlist ends by itself (Next and Previous always move on):
 * "again" the same track; "next" the playlist's next track; "first" the playlist from its first track;
 * "moveOn" the scene's next item; "stop" silence.
 */
export function whenTrackEnds(order: PlayOrder, at: { atLast: boolean; inScene: boolean }): "again" | "next" | "first" | "moveOn" | "stop" {
  if (order.repeat === "one") return "again";
  if (!at.atLast) return "next";
  if (order.repeat === "all") return "first";
  return at.inScene ? "moveOn" : "stop";
}

/** The order in plain words, for buttons and tooltips. */
export function orderWords(o: PlayOrder): string {
  return (o.shuffle ? "Shuffle" : "In order") + ", " + (o.repeat === "all" ? "repeat all" : o.repeat === "one" ? "repeat one" : "no repeat");
}

/**
 * PLY-13: a playlist's tracks in a shuffled order that depends only on the seed, so the engine, Live's lists and
 * Up next agree on it. Each time a shuffled playlist starts playing it gets a new seed (a new order). The input is
 * not changed.
 */
export function shuffledOrder<T>(items: readonly T[], seed: number): T[] {
  // mulberry32: small, fast and good enough to deal tracks; the same seed always gives the same order.
  let state = (Math.floor(seed) | 0) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** PLY-13: a playlist's tracks in the order they play: its own order, or shuffled by `seed` when the order shuffles. */
export function tracksInOrder<T>(items: readonly T[], order: PlayOrder, seed: number): T[] {
  return order.shuffle ? shuffledOrder(items, seed) : items.slice();
}

/* ---------- DAT-14 a track's name in a scene ---------- */

/** Names given to tracks in scenes: by scene key ("sc:<campaign>:<session>:<scene>"), then track id. */
export type TrackNames = Record<string, Record<string, string>>;

/**
 * DAT-14: the name a track shows in a place. In a scene that gives it a name, that name; elsewhere the track's own name:
 * the game master's title, else the title in the file's tags, else the file name. `own` is shown on hover.
 */
export function trackNameIn(
  t: Pick<DomainTrack, "id" | "title" | "metaTitle" | "fileName">,
  scene: Extract<UsePlace, { kind: "scene" }> | null,
  names: TrackNames,
): { name: string; own: string; source: "scene" | "title" | "file tags" | "file name" } {
  const own = t.title.trim() ? t.title : t.metaTitle.trim() ? t.metaTitle : t.fileName;
  const source = t.title.trim() ? "title" : t.metaTitle.trim() ? "file tags" : "file name";
  const inScene = scene ? names[keyOfPlace(scene)]?.[t.id] : undefined;
  if (inScene && inScene.trim()) return { name: inScene.trim(), own, source: "scene" };
  return { name: own, own, source };
}

/* ---------- PLY-14 audio settings from where a track is used ---------- */

/**
 * The audio profile places to try, most specific first, for a track played from a place (and from a playlist, if it
 * came through one): the scene's or session's own settings, then the playlist's, then (not listed) the track's own.
 * A campaign has no audio settings of its own.
 */
export function profileKeysFor(place: UsePlace | null, playlistId: string | null): string[] {
  const keys: string[] = [];
  if (place && place.kind !== "campaign") keys.push(keyOfPlace(place));
  if (playlistId) keys.push(`pl:${playlistId}`);
  return keys;
}

/**
 * PLY-14: the same places as profileKeysFor, as ProfilePlace values for resolveProfile (the engine and the Audio
 * profile screen use these; profileKeysFor gives their keys).
 */
export function profilePlacesFor(place: UsePlace | null, playlistId: string | null): ProfilePlace[] {
  const places: ProfilePlace[] = [];
  if (place?.kind === "scene") places.push({ kind: "scene", campaignId: place.campaignId, sessionId: place.sessionId, sceneId: place.sceneId });
  if (place?.kind === "session") places.push({ kind: "session", campaignId: place.campaignId, sessionId: place.sessionId });
  if (playlistId) places.push({ kind: "playlist", playlistId });
  return places;
}

/* ---------- SFX-11 resizing a pad board ---------- */

/**
 * SFX-11: a board's pads after a resize. Pads fill the new grid left to right, top to bottom, in their reading order
 * on the old grid, followed by the spare pads in their order; only what does not fit goes to (or stays in) Spare pads.
 * A spare pad the game master put there by hand (`isAside`) stays there however large the grid gets: only pads a
 * resize moved come back (Nik, 5 Nov 2026). `spilled` names the grid pads that had to move to Spare pads; the new
 * spare list is those first, then the old spare pads still left, in their order. The inputs are not changed, so the
 * caller can keep them for Undo.
 */
export function reflowBoard<P>(
  slots: (P | null)[],
  spare: P[],
  cols: number,
  rows: number,
  isAside: (pad: P) => boolean = () => false,
): { slots: (P | null)[]; spare: P[]; spilled: P[] } {
  const size = Math.max(1, Math.floor(cols)) * Math.max(1, Math.floor(rows));
  const onGrid = slots.filter((p): p is P => p !== null && p !== undefined);
  const next: (P | null)[] = onGrid.concat(spare.filter((p) => !isAside(p))).slice(0, size);
  while (next.length < size) next.push(null);
  const spilled = onGrid.filter((p) => !next.includes(p));
  return { slots: next, spare: spilled.concat(spare.filter((p) => !next.includes(p))), spilled };
}
