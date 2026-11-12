/**
 * PLY-8: one action model for every way of making sound. The interface's
 * buttons, the hotkeys and (later) the remote API all build a CueAction and
 * hand it to `Director.run`, so a press does the same thing wherever it comes
 * from. Actions are plain data, so they can be stored on a hotkey or a cue
 * and sent over IPC; `isCueAction` checks one that came from outside.
 *
 * Every action that makes sound names its room (`RoomTarget`): one room, or
 * "all". A room that has gone falls back to the first room (`roomsFor`).
 * Scenes always start in the first room (`sceneRoom`), so startScene has no
 * target. Fades are in milliseconds; each has the prototype's default.
 */
import type { RoomTarget, UsePlace } from "../../common/domain";
import { RoomLane, ROOM_LANES } from "../rooms.contract";
import type { SceneRef } from "./library";

/** Where a track was picked from, so it plays with that place's audio profile and Next goes on from there. */
/**
 * Where a track was picked from: a scene step, or a playlist (PLY-13: `place` is the session or campaign list the
 * playlist was played from, so its play order and that list's audio settings apply).
 */
export type TrackFrom = { scene: SceneRef; at: number } | { playlistId: string; place?: UsePlace };

export type CueAction =
  /** Music crossfades from what plays (when "now"), or waits in the queue (when "next"); ambience crossfades; an effect plays over everything. */
  | { type: "playTrack"; trackId: string; target: RoomTarget; when?: "now" | "next"; from?: TrackFrom; fadeMs?: number; fromMs?: number }
  /** From its first track, on the lane the playlist is for. */
  | { type: "playPlaylist"; playlistId: string; target: RoomTarget; when?: "now" | "next"; fadeMs?: number; place?: UsePlace }
  | { type: "startScene"; scene: SceneRef }
  | { type: "next"; lane: "music" | "ambience"; target: RoomTarget; fadeMs?: number }
  | { type: "previous"; lane: "music" | "ambience"; target: RoomTarget; fadeMs?: number }
  | { type: "fadeLane"; lane: RoomLane; target: RoomTarget; fadeMs?: number }
  | { type: "fadeAll"; target?: RoomTarget; fadeMs?: number }
  | { type: "stopAll"; target?: RoomTarget }
  /** "down" by default; "up" lets go of a hold pad. A press on a pad that sounds there stops it (BUG-20). */
  | { type: "firePad"; boardId: string; padId: string; target: RoomTarget; phase?: "down" | "up" }
  /** BUG-20: every pad sound fades out quickly (every room by default); music, ambience and other effects go on. */
  | { type: "stopPads"; target?: RoomTarget; fadeMs?: number }
  | { type: "removeQueued"; entryId: string; target: RoomTarget }
  /** Go back to the music and ambience from before the last scene start. */
  | { type: "undoSceneStart" };

export type CueActionType = CueAction["type"];

/** What happened, in words for a toast when it did not work. */
export type CueOutcome = { ok: true } | { ok: false; message: string };

/** Default fades, from the prototype (seconds). */
export const DEFAULT_FADES = {
  /** Play now, Next, Previous. */
  crossfade: 3,
  sceneMusic: 4,
  sceneAmbience: 3,
  fadeLane: 3,
  fadeAll: 3,
  /** Effects stopped by a fade lane. */
  effects: 0.8,
  undo: 1.5,
  /** A hold pad let go. */
  holdRelease: 0.4,
  /** BUG-20: a one-shot or restart pad pressed while it sounds, and Stop pads. */
  padStop: 0.3,
} as const;

const LIMIT = 200;

/** True when `value` is a well-formed CueAction (ids are short strings, fades sensible numbers). */
export function isCueAction(value: unknown): value is CueAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  const v = value;
  const fade = v.fadeMs === undefined || (typeof v.fadeMs === "number" && Number.isFinite(v.fadeMs) && v.fadeMs >= 0 && v.fadeMs <= 60_000);
  const when = v.when === undefined || v.when === "now" || v.when === "next";
  switch (v.type) {
    case "playTrack":
      // DAT-3 (round 7): Play on air from a marker.
      return isId(v.trackId) && isTarget(v.target) && when && fade && (v.from === undefined || isFrom(v.from)) && (v.fromMs === undefined || (typeof v.fromMs === "number" && Number.isFinite(v.fromMs) && v.fromMs >= 0 && v.fromMs <= 1e9));
    case "playPlaylist":
      return isId(v.playlistId) && isTarget(v.target) && when && fade && (v.place === undefined || isPlace(v.place));
    case "startScene":
      return isSceneRef(v.scene);
    case "next":
    case "previous":
      return (v.lane === "music" || v.lane === "ambience") && isTarget(v.target) && fade;
    case "fadeLane":
      return ROOM_LANES.includes(v.lane as RoomLane) && isTarget(v.target) && fade;
    case "fadeAll":
      return (v.target === undefined || isTarget(v.target)) && fade;
    case "stopAll":
      return v.target === undefined || isTarget(v.target);
    case "firePad":
      return isId(v.boardId) && isId(v.padId) && isTarget(v.target) && (v.phase === undefined || v.phase === "down" || v.phase === "up");
    case "stopPads":
      return (v.target === undefined || isTarget(v.target)) && fade;
    case "removeQueued":
      return isId(v.entryId) && isTarget(v.target);
    case "undoSceneStart":
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LIMIT;
}

function isTarget(value: unknown): value is RoomTarget {
  return value === "all" || (isRecord(value) && isId(value.room));
}

function isSceneRef(value: unknown): value is SceneRef {
  return isRecord(value) && isId(value.campaignId) && isId(value.sessionId) && isId(value.sceneId);
}

/** A session or campaign list (or a scene) a playlist plays from. */
function isPlace(value: unknown): value is UsePlace {
  if (!isRecord(value)) return false;
  if (value.kind === "campaign") return isId(value.campaignId);
  if (value.kind === "session") return isId(value.campaignId) && isId(value.sessionId);
  return value.kind === "scene" && isSceneRef(value);
}

function isFrom(value: unknown): value is TrackFrom {
  if (!isRecord(value)) {
    return false;
  }
  if ("playlistId" in value) {
    return isId(value.playlistId) && (value.place === undefined || isPlace(value.place));
  }
  return isSceneRef(value.scene) && Number.isInteger(value.at) && (value.at as number) >= 0;
}
