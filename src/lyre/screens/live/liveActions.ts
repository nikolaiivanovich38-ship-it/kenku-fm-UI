/**
 * What Live's buttons do with sound (live.js lvplay, addItem, addAmb, lvupx, lvqclear, lvnextt), in one place so every
 * box does it the same way. The audio host does the playing and keeps each room's list (PLY-16); Live keeps only what
 * the host does not: the ambience waiting for Next on a room's ambience, the names of single tracks played from a
 * place (DAT-14), and the Undo strips (Must 1 of the round 6 review: one Undo at a time, ended by any other change).
 */
import type { RoomTarget, UsePlace } from "../../../common/domain";
import type { LibraryTrack, PlaylistInfo } from "../../../common/lyre/api";
import type { ListWhat, TrackFrom } from "../../audio/lyreAudio";
import type { LiveData } from "./liveData";
import { UNDO_MS } from "./liveModel";
import { getLiveState, offerSoftUndo, touched, updateLive, type WaitingAmbience } from "./liveState";

/** Play on air and Next crossfade over this long (the prototype's fade: 3). */
export const LIVE_FADE_MS = 3000;

/** A row's track or playlist, as the row names it (DAT-14: the scene's name for a track) and where it plays from. */
export type PlayWhat =
  | {
      kind: "track";
      track: LibraryTrack;
      /** The scene step or playlist it is picked from: Next follows that order. None: a track on its own. */
      from?: TrackFrom;
      /** Where it is shown, for its name and audio profile there (a scene, a session's or campaign's list). */
      place: UsePlace | null;
      name: string;
    }
  | {
      kind: "playlist";
      playlist: PlaylistInfo;
      /** The place whose play order it plays in (PLY-13). */
      place: UsePlace | null;
      /** A playlist that is a step of the running scene plays from its first track there, in the scene's order. */
      first?: { trackId: string; from: TrackFrom };
      name: string;
    };

export interface Speaker {
  say: (text: string) => void;
}

const roomOf = (t: RoomTarget) => (t === "all" ? "" : t.room);

function isAmbience(what: PlayWhat): boolean {
  return what.kind === "track" ? what.track.kind === "amb" : what.playlist.lane === "amb";
}

function isEffect(what: PlayWhat): boolean {
  return what.kind === "track" ? what.track.kind === "fx" : what.playlist.lane === "fx";
}

/** Remember (or forget) the place a single track played on air from, so its room names it as that place does. */
function nameOnAir(roomId: string, what: PlayWhat): void {
  updateLive((s) => {
    const airNames = { ...s.airNames };
    if (what.kind === "track" && !what.from && what.place && what.track.kind !== "fx") airNames[roomId] = { trackId: what.track.id, place: what.place };
    else if (!isEffect(what)) delete airNames[roomId];
    return { airNames };
  });
}

/**
 * Play on air in the box's rooms. A playlist, or a track picked from the running scene or a playlist, is a new plan for
 * the room; a track on its own plays now and the room's list carries on after it; an effect layers over the music;
 * an ambience becomes the room's ambience (crossfading).
 */
export function playOnAir(d: LiveData, targets: readonly RoomTarget[], what: PlayWhat): void {
  touched();
  for (const target of targets) {
    nameOnAir(roomOf(target), what);
    if (what.kind === "track") {
      if (what.track.kind === "fx") d.audio.playTrack(what.track.id, { target });
      else d.audio.playTrack(what.track.id, { target, ...(what.from ? { from: what.from } : {}), fadeMs: LIVE_FADE_MS });
      continue;
    }
    if (what.first) d.audio.playTrack(what.first.trackId, { target, from: what.first.from, fadeMs: LIVE_FADE_MS });
    else d.audio.playPlaylist(what.playlist.id, { target, fadeMs: LIVE_FADE_MS, ...(what.place ? { place: what.place } : {}) });
  }
}

function listWhat(what: PlayWhat): ListWhat {
  if (what.kind === "track") return { kind: "track", trackId: what.track.id, ...(what.from ? { from: what.from } : {}), name: what.name };
  return { kind: "playlist", playlistId: what.playlist.id, place: what.place, name: what.name };
}

/**
 * Play next (right after the track playing) or Add to queue (the bottom of the room's list), in the box's rooms
 * (PLY-16, Nik 6 Nov 12:14). A room with nothing playing plays it at once. Undo (8 s, or Ctrl+Z) takes the add back.
 * An ambience waits for Next on the room's ambience instead (round 6 part 6), at the top or the bottom of what waits.
 */
export function addToList(d: LiveData, how: "next" | "queue", targets: readonly RoomTarget[], what: PlayWhat, focus: string, speaker: Speaker): void {
  if (isEffect(what)) return;
  if (isAmbience(what)) {
    addAmbience(d, how, targets, what, focus, speaker);
    return;
  }
  const added: RoomTarget[] = [];
  let started = false;
  for (const target of targets) {
    const hadMusic = !!d.now.rooms.find((r) => r.roomId === roomOf(target))?.music;
    const outcome = how === "next" ? d.audio.playNext(listWhat(what), { target }) : d.audio.addToQueue(listWhat(what), { target });
    if (!outcome.ok) continue;
    if (hadMusic) added.push(target);
    else started = true;
  }
  const verb = how === "next" ? "Plays next" : "Added to the queue";
  const where = d.rooms.length > 1 ? ` in ${targets.length > 1 ? "all rooms" : (d.rooms.find((r) => r.roomId === roomOf(targets[0]))?.name ?? "")}` : "";
  if (added.length) {
    offerSoftUndo({ text: `${verb}: ${what.name}`, where: `room:${roomOf(added[0])}`, focus, restore: () => added.forEach((t) => d.audio.undoUpNext(t)) }, UNDO_MS);
    speaker.say(`${verb}${where}: ${what.name}. Undo is available for 8 seconds, or press Ctrl+Z.`);
  } else if (started) {
    touched();
    speaker.say(`Playing now: ${what.name}`);
  }
}

function waitingOf(d: LiveData, what: PlayWhat): WaitingAmbience | null {
  if (what.kind === "track") return { trackId: what.track.id, playlistId: null, place: what.place, name: what.name };
  const first = what.first?.trackId ?? d.index.tracksOf(what.playlist)[0]?.id;
  return first ? { trackId: first, playlistId: what.playlist.id, place: what.place, name: what.name } : null;
}

function playAmbience(d: LiveData, target: RoomTarget, item: WaitingAmbience): void {
  d.audio.playTrack(item.trackId, { target, ...(item.playlistId ? { from: { playlistId: item.playlistId, ...(item.place ? { place: item.place } : {}) } } : {}), fadeMs: LIVE_FADE_MS });
}

function addAmbience(d: LiveData, how: "next" | "queue", targets: readonly RoomTarget[], what: PlayWhat, focus: string, speaker: Speaker): void {
  const item = waitingOf(d, what);
  if (!item) return;
  const before = getLiveState().aq;
  const added: string[] = [];
  let started = false;
  for (const target of targets) {
    const roomId = roomOf(target);
    if (!d.now.rooms.find((r) => r.roomId === roomId)?.ambience) {
      touched();
      playAmbience(d, target, item);
      started = true;
      continue;
    }
    added.push(roomId);
  }
  if (added.length) {
    updateLive((s) => {
      const aq = { ...s.aq };
      for (const roomId of added) aq[roomId] = how === "next" ? [item, ...(aq[roomId] ?? [])] : [...(aq[roomId] ?? []), item];
      return { aq };
    });
    const verb = how === "next" ? "Ambience next" : "Ambience added to the queue";
    offerSoftUndo({ text: `${verb}: ${item.name}`, where: `room:${added[0]}`, focus, restore: () => updateLive({ aq: before }) }, UNDO_MS);
    speaker.say(`${verb}: ${item.name}. It plays when you press Next on the ambience. Undo is available for 8 seconds, or press Ctrl+Z.`);
  } else if (started) speaker.say(`Ambience now: ${item.name}`);
}

/** Next on a room's music or ambience; the ambience plays what waits for it first. */
export function nextInRoom(d: LiveData, lane: "music" | "ambience", roomId: string): void {
  touched();
  const target = { room: roomId };
  const waiting = lane === "ambience" ? (getLiveState().aq[roomId] ?? []) : [];
  if (waiting.length) {
    updateLive((s) => ({ aq: { ...s.aq, [roomId]: waiting.slice(1) } }));
    playAmbience(d, target, waiting[0]);
    return;
  }
  d.audio.next(lane, target);
}

/** × in Up next: a planned track is skipped this evening, an added one goes; Undo brings it back. */
export function takeOut(d: LiveData, roomId: string, remove: () => boolean, label: string, focus: string, speaker: Speaker): void {
  if (!remove()) return;
  offerSoftUndo({ text: `Taken out of Up next: ${label}`, where: `room:${roomId}`, focus, restore: () => d.audio.undoUpNext({ room: roomId }) }, UNDO_MS);
  speaker.say(`Taken out of Up next: ${label}. Undo is available for 8 seconds, or press Ctrl+Z.`);
}

/** Clear added: everything added this evening leaves the room's list (the ambience waiting too); Undo brings it back. */
export function clearAdded(d: LiveData, roomId: string, focus: string, speaker: Speaker): void {
  const before = getLiveState().aq;
  const outcome = d.audio.clearAdded({ room: roomId });
  const hadAmbience = (before[roomId] ?? []).length > 0;
  if (!outcome.ok && !hadAmbience) return;
  const cleared = outcome.ok;
  updateLive((s) => ({ aq: { ...s.aq, [roomId]: [] } }));
  offerSoftUndo(
    {
      text: "Cleared what you added",
      where: `room:${roomId}`,
      focus,
      restore: () => {
        if (cleared) d.audio.undoUpNext({ room: roomId });
        updateLive({ aq: before });
      },
    },
    UNDO_MS,
  );
  speaker.say("Cleared what you added. Undo is available for 8 seconds, or press Ctrl+Z.");
}
