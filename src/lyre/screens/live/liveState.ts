/**
 * What the Live screen keeps while the page is open (the prototype's `S` in live.js and L.state.live): the scene that
 * is on now and the one on standby, the Undo offer, where each box plays (To:), and the boxes' choices (the list Scene
 * music shows, the pad board, the Off script search, open rows). Going to another screen and back finds Live as it
 * was. Sound is not kept here: what plays is the audio host's (getNowPlaying).
 */
import { useSyncExternalStore } from "react";

import type { LiveSession } from "../../kit/liveSession";
import type { LiveBox, OffScriptQuery } from "./liveModel";

export interface UndoOffer {
  /** The scene state to go back to. */
  before: { now: number; standby: number };
  /** The scene left, for "Back to …". */
  label: string;
  /** The scene started, for "Started …". */
  started: string;
  /** When the offer ends (ms since 1970). */
  until: number;
}

export interface LiveState {
  /** The session the scene fields below belong to; another session starts on standby. */
  session: LiveSession | null;
  /** The scene on now; -1 before the first scene starts (standby). */
  now: number;
  /** The scene Next scene starts. */
  standby: number;
  undo: UndoOffer | null;
  /** Each box's room (a room id, or "all"); none: the first room. */
  to: Partial<Record<LiveBox, string>>;
  /** What Scene music shows: "scene" or a session or campaign playlist; null: the scene. */
  list: string | null;
  /** The pad board chosen; null: the scene's first. */
  board: string | null;
  search: OffScriptQuery;
  /** Off script shows every tag group, not only the first moods. */
  moreTags: boolean;
  /** The track row whose details are open ("<list>:<track id>"). */
  open: string | null;
  /** Open playlists in Scene music, by key. */
  expanded: Record<string, boolean>;
  /** One column: every scene, not only Now and Next. */
  allScenes: boolean;
  /** The current scene's notes in full. */
  notesOpen: boolean;
}

const START: LiveState = {
  session: null,
  now: -1,
  standby: 0,
  undo: null,
  to: {},
  list: null,
  board: null,
  search: { q: "", tags: [], lane: "all" },
  moreTags: false,
  open: null,
  expanded: {},
  allScenes: false,
  notesOpen: false,
};

let state: LiveState = START;
const listeners = new Set<() => void>();

export function getLiveState(): LiveState {
  return state;
}

/** Change part of the state; listeners hear of it. */
export function updateLive(change: Partial<LiveState> | ((s: LiveState) => Partial<LiveState>)): void {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  listeners.forEach((listener) => listener());
}

/** A session loaded: nothing started yet, Next scene starts its first scene; the boxes' choices start again. */
export function standbyFor(session: LiveSession | null): void {
  updateLive({ session, now: -1, standby: 0, undo: null, list: null, board: null, open: null, expanded: {}, allScenes: false, notesOpen: false });
}

/** Back to how the page starts (tests). */
export function resetLiveState(): void {
  state = START;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLiveState(): LiveState {
  return useSyncExternalStore(subscribe, getLiveState);
}
