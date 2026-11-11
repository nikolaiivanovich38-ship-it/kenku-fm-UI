/**
 * What the Live screen keeps while the page is open (the prototype's `S` in live.js and L.state.live): the scene that
 * is on now and the one on standby, the Undo offers, where each box plays (To:), the boxes' choices (pad boards,
 * Find, open scenes, rows and playlists, Up next unfolded, What played open) and the ambience waiting in each room.
 * Going to another screen and back finds Live as it was (Back puts the same scene back open, UX-18). Sound is not
 * kept here: what plays is the audio host's (getNowPlaying).
 */
import { useSyncExternalStore } from "react";

import type { UsePlace } from "../../../common/domain";
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

/**
 * Round 6 part 2 and the review's Must 1: Undo of the last change that is not a scene change (Add to queue, Play next,
 * a removal from Up next, Clear added, Kick, moving a bot), shown as a strip where it happened, for 8 seconds or until
 * anything else changes what a room plays.
 */
export interface SoftUndo {
  text: string;
  /** Where its strip shows: "onair" (On air's own strip) or "room:<room id>" (in that room's part). */
  where: string;
  /** The control that gets focus afterwards (its data-lv). */
  focus: string;
  until: number;
  restore: () => void;
}

/** An ambience waiting for Next on a room's ambience (round 6 part 6: ambience Play next and Add to queue wait). */
export interface WaitingAmbience {
  trackId: string;
  playlistId: string | null;
  place: UsePlace | null;
  name: string;
}

export interface LiveState {
  /** The session the scene fields below belong to; another session starts on standby. */
  session: LiveSession | null;
  /** The scene on now; -1 before the first scene starts (standby). */
  now: number;
  /** The scene Next scene starts. */
  standby: number;
  undo: UndoOffer | null;
  undo2: SoftUndo | null;
  /** Each box's room (a room id, or "all"); none: the first room. */
  to: Partial<Record<LiveBox, string>>;
  /** The pad board chosen in Current scene, Session pads and Campaign pads; null: the first. */
  boards: { sc: string | null; ss: string | null; cp: string | null };
  search: OffScriptQuery;
  /** Find's results are open under its field. */
  findOpen: boolean;
  /** Find shows every tag group, not only the first moods. */
  moreTags: boolean;
  /** The track row whose details are open ("<list>:<track id>"). */
  open: string | null;
  /** Open playlists and boards in rows, by key. */
  expanded: Record<string, boolean>;
  /** SHW-7: scenes unfolded in Scenes, by scene id. */
  scOpen: Record<string, boolean>;
  /** One column: every scene, not only Now and Next. */
  allScenes: boolean;
  /** The current scene's notes in full. */
  notesOpen: boolean;
  /** Up next unfolded, by room id. */
  upOpen: Record<string, boolean>;
  /** Must 4: a room opened to show everything in a short window, by room id. */
  rmOpen: Record<string, boolean>;
  /** PLY-1: What played open, by room id. */
  playedOpen: Record<string, boolean>;
  /** The ambience waiting in each room, by room id. */
  aq: Record<string, WaitingAmbience[]>;
  /**
   * DAT-14: a single track played on air from a place (a scene that is not running, a session's or campaign's single
   * tracks) is named as that place names it in its room, by room id. The audio host plays it as a single track.
   */
  airNames: Record<string, { trackId: string; place: UsePlace }>;
  /** UX-12: when Next scene was last pressed with its key (the guard ignores a second press within a second). */
  lastNextKey: number | null;
}

const START: LiveState = {
  session: null,
  now: -1,
  standby: 0,
  undo: null,
  undo2: null,
  to: {},
  boards: { sc: null, ss: null, cp: null },
  search: { q: "", tags: [], lane: "all" },
  findOpen: false,
  moreTags: false,
  open: null,
  expanded: {},
  scOpen: {},
  allScenes: false,
  notesOpen: false,
  upOpen: {},
  rmOpen: {},
  playedOpen: {},
  aq: {},
  airNames: {},
  lastNextKey: null,
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

/**
 * Must 1 of the round 6 review: anything that changes what a room plays or who hears it ends the Undo strips showing,
 * so Ctrl+Z never reaches past it to an older change.
 */
export function touched(): void {
  if (state.undo || state.undo2) updateLive({ undo: null, undo2: null });
}

/** A new soft Undo replaces the scene's and any other (one Undo at a time). */
export function offerSoftUndo(offer: Omit<SoftUndo, "until">, ms: number): void {
  updateLive({ undo: null, undo2: { ...offer, until: Date.now() + ms } });
}

/**
 * A session loaded: nothing started yet, Next scene starts its first scene; the boxes' choices start again and the
 * rooms' waiting ambience goes (the audio host clears the rooms' lists, sessionLoaded).
 */
export function standbyFor(session: LiveSession | null): void {
  updateLive({
    session,
    now: -1,
    standby: 0,
    undo: null,
    undo2: null,
    boards: { sc: null, ss: null, cp: null },
    open: null,
    expanded: {},
    scOpen: {},
    allScenes: false,
    notesOpen: false,
    upOpen: {},
    aq: {},
    airNames: {},
  });
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
