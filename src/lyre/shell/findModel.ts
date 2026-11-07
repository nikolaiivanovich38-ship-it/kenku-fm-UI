/**
 * UX-12 Find and play (Ctrl+K, design round 7, r7shell.js): what it lists from `library.find` and what its keys do,
 * without the page. Enter plays on air (a pad fires, a scene starts), Alt+Enter previews, Shift+Enter adds to the
 * queue, Ctrl+Enter opens it.
 */
import type { FindResult, PlayPlace } from "../../common/lyre/api";
import type { TrackKind } from "../../common/domain";

export type FindAction = "air" | "preview" | "queue" | "open";

export type FoundKind = "playlist" | "scene" | "track" | "ambience" | "pad" | "effect";

export interface FoundItem {
  kind: FoundKind;
  /** Unique among the results, for the option's id. */
  key: string;
  name: string;
  /** The board of a pad, "Session 14" for a scene. */
  sub?: string;
  /** A track's id; a playlist's id; a pad's board and pad; a scene's address. */
  trackId?: string;
  playlistId?: string;
  pad?: { boardId: string; padId: string };
  scene?: { campaignId: string; sessionId: string; sceneId: string };
  /** A found playlist's tracks in the order they play where it was found (ORG-13), and that place. */
  trackIds?: string[];
  place?: PlayPlace | null;
}

/** At most this many are listed. */
export const MOST_FOUND = 12;

/** Playlists and scenes first (what is played mid-game), then tracks, pads and effects. */
const RANK: Record<FoundKind, number> = { playlist: 0, scene: 1, track: 2, ambience: 2, pad: 3, effect: 4 };

/** The results in the order they are listed. `trackOf` names a found track (null: not in the library any more). */
export function foundItems(result: FindResult, trackOf: (id: string) => { title: string; kind: TrackKind } | null): FoundItem[] {
  const items: FoundItem[] = [];
  for (const p of result.playlists) items.push({ kind: "playlist", key: `p:${p.id}`, name: p.name, playlistId: p.id, trackIds: p.trackIds, place: p.place });
  for (const s of result.scenes)
    items.push({ kind: "scene", key: `s:${s.campaignId}/${s.sessionId}/${s.sceneId}`, name: s.name, sub: `Session ${s.sessionNumber}`, scene: { campaignId: s.campaignId, sessionId: s.sessionId, sceneId: s.sceneId } });
  for (const id of result.tracks.trackIds) {
    const t = trackOf(id);
    if (!t) continue;
    items.push({ kind: t.kind === "fx" ? "effect" : t.kind === "amb" ? "ambience" : "track", key: `t:${id}`, name: t.title, trackId: id });
  }
  for (const p of result.pads) items.push({ kind: "pad", key: `d:${p.boardId}/${p.padId}`, name: p.label, sub: p.boardName, pad: { boardId: p.boardId, padId: p.padId } });
  // A stable sort keeps the library's best matches first within each kind.
  return items.map((item, at) => ({ item, at })).sort((a, b) => RANK[a.item.kind] - RANK[b.item.kind] || a.at - b.at).slice(0, MOST_FOUND).map((x) => x.item);
}

/** An option's name, read out: "The Abbess, playlist"; "The abbey ruins, scene, Session 14". */
export function optionLabel(item: FoundItem): string {
  return `${item.name}, ${item.kind}${item.sub ? `, ${item.sub}` : ""}`;
}

/** Whether an action applies to a found item: Add to queue is for tracks and playlists only; a scene starts or opens. */
export function canDo(item: FoundItem, action: FindAction): boolean {
  if (action === "queue") return item.kind === "track" || item.kind === "playlist";
  if (action === "preview") return item.kind !== "scene";
  return true;
}

/** The action Enter with these modifiers takes, or null for any other key. */
export function actionOfKey(event: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): FindAction | null {
  if (event.key !== "Enter") return null;
  if (event.altKey) return "preview";
  if (event.shiftKey) return "queue";
  if (event.ctrlKey || event.metaKey) return "open";
  return "air";
}

/** The option Down or Up moves to, wrapping around. */
export function moveActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return 0;
  return (active + (key === "ArrowDown" ? 1 : -1) + count) % count;
}
