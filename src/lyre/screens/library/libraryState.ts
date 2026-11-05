/**
 * What the Library screen is showing (filters, search, sort, ticked rows, the row with the keyboard, the message
 * line), kept for the page visit as the prototype keeps its `st`: the shell draws the screen afresh on every address
 * change, and opening a track must not clear the filters or the selection.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_FILTER, type LibraryFilter, type SortKey } from "./model";

/** The line under the search box after an action (the prototype's st.guide). */
export type Guide =
  | { kind: "added"; count: number; how: string; alreadyIn: number; problems: string[] }
  | { kind: "tagged"; text: string; stillNew: number }
  | { kind: "playlist-made"; playlistId: string; name: string; count: number }
  | { kind: "added-to"; count: number; playlists: { id: string; name: string }[] }
  | { kind: "watching"; folder: string }
  | { kind: "arrived"; folder: string; titles: string[] }
  | { kind: "progress"; text: string };

export interface LibraryViewState {
  filter: LibraryFilter;
  q: string;
  sort: SortKey;
  /** Ticked track ids, in the order they were ticked. */
  sel: string[];
  /** The row that has the keyboard (the list is one Tab stop). */
  cursor: string | null;
  /** Where a Shift range starts. */
  anchor: string | null;
  guide: Guide | null;
  /** The element to focus after the next route change (a row, or Back), by its data-focus key. */
  pendingFocus: string | null;
}

export const INITIAL_LIBRARY_STATE: LibraryViewState = {
  filter: DEFAULT_FILTER,
  q: "",
  sort: "title",
  sel: [],
  cursor: null,
  anchor: null,
  guide: null,
  pendingFocus: null,
};

let state = INITIAL_LIBRARY_STATE;
const listeners = new Set<() => void>();

export function getLibraryState(): LibraryViewState {
  return state;
}
export function setLibraryState(change: Partial<LibraryViewState> | ((s: LibraryViewState) => Partial<LibraryViewState>)): void {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  listeners.forEach((l) => l());
}
/** Back to a fresh Library (tests). */
export function resetLibraryState(): void {
  state = INITIAL_LIBRARY_STATE;
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLibraryState(): LibraryViewState {
  return useSyncExternalStore(subscribe, getLibraryState);
}

/** Clear every filter (not the search or the sort). */
export const clearedFilter = (): LibraryFilter => DEFAULT_FILTER;
