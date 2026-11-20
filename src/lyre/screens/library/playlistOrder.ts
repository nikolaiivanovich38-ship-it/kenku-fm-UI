/**
 * Round 9 (ROUND9.md §8, item 38: "I need the ability to drag and drop and reorder playlists in the playlist list, I
 * also need the ability to sort it"): the Playlists list's Sort (r9lists.js SORTS). Your order is the library's own
 * order of the playlists (playlists.move changes it); the others sort what is shown. The choice is kept on this
 * computer, in the page's storage (key below), as the prototype keeps it.
 */
import { useSyncExternalStore } from "react";
import type { PlaylistInfo } from "../../../common/lyre/api";

export type PlaylistSort = "own" | "az" | "za" | "tracks" | "long" | "used" | "new";
export const PLAYLIST_SORTS: readonly (readonly [PlaylistSort, string])[] = [
  ["own", "Your order"],
  ["az", "Name A to Z"],
  ["za", "Name Z to A"],
  ["tracks", "Most tracks"],
  ["long", "Longest"],
  ["used", "Most used"],
  ["new", "Newest"],
];
export const PLAYLIST_SORT_KEY = "lyre-playlists-sort";

function readSort(): PlaylistSort {
  try {
    const saved = localStorage.getItem(PLAYLIST_SORT_KEY);
    return PLAYLIST_SORTS.some(([k]) => k === saved) ? (saved as PlaylistSort) : "own";
  } catch {
    return "own"; // storage unavailable
  }
}
let sort = readSort();
const listeners = new Set<() => void>();
export function setPlaylistSort(next: PlaylistSort): void {
  sort = next;
  try {
    localStorage.setItem(PLAYLIST_SORT_KEY, next);
  } catch {
    // storage unavailable: kept for this visit
  }
  listeners.forEach((l) => l());
}
export const usePlaylistSort = (): PlaylistSort =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sort,
  );
/** Back to what the page's storage says (tests). */
export const rereadPlaylistSort = (): void => setPlaylistSort(readSort());

export interface SortFacts {
  /** How many tracks it has now, and how long they play together (ms). */
  count(p: PlaylistInfo): number;
  length(p: PlaylistInfo): number;
  /** How many campaigns, sessions and scenes use it. */
  uses(p: PlaylistInfo): number;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * The rows in the chosen sort; ties go by name. Newest: a playlist made later is listed first; the library lists a new
 * playlist at the top, so without a time of its own a playlist higher in Your order counts as newer.
 */
export function sortPlaylists(rows: readonly PlaylistInfo[], how: PlaylistSort, facts: SortFacts, all: readonly PlaylistInfo[] = rows): PlaylistInfo[] {
  if (how === "own") return [...rows];
  const byName = (a: PlaylistInfo, b: PlaylistInfo) => collator.compare(a.name, b.name);
  const place = (p: PlaylistInfo) => all.indexOf(p);
  const by: Record<Exclude<PlaylistSort, "own">, (a: PlaylistInfo, b: PlaylistInfo) => number> = {
    az: byName,
    za: (a, b) => byName(b, a),
    tracks: (a, b) => facts.count(b) - facts.count(a),
    long: (a, b) => facts.length(b) - facts.length(a),
    used: (a, b) => facts.uses(b) - facts.uses(a),
    new: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || place(a) - place(b),
  };
  return [...rows].sort((a, b) => by[how](a, b) || byName(a, b));
}

/**
 * Where a playlist moves in Your order: among the playlists in the same folder (folders keep their own order), as the
 * index playlists.move takes. `to` is "up", "down", "top", or the playlist it is dropped next to.
 */
export function moveIndex(all: readonly PlaylistInfo[], id: string, to: "up" | "down" | "top" | { before: string } | { after: string }): number | null {
  const me = all.find((p) => p.id === id);
  if (!me) return null;
  const siblings = all.filter((p) => p.folderId === me.folderId).map((p) => p.id);
  const from = siblings.indexOf(id);
  let at: number;
  if (to === "up") at = from - 1;
  else if (to === "down") at = from + 1;
  else if (to === "top") at = 0;
  else {
    const target = "before" in to ? to.before : to.after;
    const t = siblings.indexOf(target);
    if (t < 0 || target === id) return null;
    at = t + ("after" in to ? 1 : 0);
    if (at > from) at -= 1;
  }
  at = Math.max(0, Math.min(siblings.length - 1, at));
  return at === from ? null : at;
}
