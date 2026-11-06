/**
 * PLY-8: runs cue actions (actions.ts) against the rooms. Every trigger, from
 * a button, a hotkey or (later) the remote API, goes through `run`, which
 * finds the rooms the action names (`roomsFor`; scenes always use `sceneRoom`)
 * and hands the action to each room's player (roomPlayer.ts).
 *
 * It also keeps the one level of Undo for a scene start (PLY-1): the scene's
 * room as it was just before, music and ambience with their places, the queue
 * and the way back. The interface decides how long Undo is offered (the
 * prototype: 8 seconds, or Ctrl+Z).
 *
 * Rooms come from the Rooms stream through `RoomsAudio` (rooms.contract.ts).
 * A room that goes away is silenced and forgotten.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import { keyOfPlace, roomsFor, sceneRoom } from "../../../common/domain";
import type { Repeat, RoomRepeat, RoomTarget, UpNextRef, UsePlace } from "../../../common/domain";
import type { PlaybackEngine } from "../engine";
import type { RoomsAudio } from "../rooms.contract";
import { CueAction, CueOutcome, DEFAULT_FADES, TrackFrom } from "./actions";
import type { ShowLibrary } from "./library";
import { Playing, playlistItem, sceneItem, sequenceOf, single } from "./nowPlaying";
import type { Random } from "./queue";
import { RoomPlayer, RoomReport, RoomSnapshot, type ListEntry } from "./roomPlayer";

/** PLY-16: what Play next and Add to queue take: a track (from where it was picked) or a whole playlist. */
export type ListWhat =
  | { kind: "track"; trackId: string; from?: TrackFrom; name?: string }
  | { kind: "playlist"; playlistId: string; place?: UsePlace | null; name?: string };

interface DirectorEvents {
  /** What a room plays changed; read `report()`. */
  change: () => void;
  /** A plain-language message for a toast. */
  error: (message: string) => void;
}

const OK: CueOutcome = { ok: true };
const NO_ROOM = "No room is open, so nobody would hear it. Join a voice channel first.";

export class Director extends TypedEmitter<DirectorEvents> {
  private readonly engine: PlaybackEngine;
  private readonly rooms: RoomsAudio;
  private readonly library: ShowLibrary;
  private readonly random: Random;
  private readonly players = new Map<string, RoomPlayer>();
  private readonly turns = new Map<string, number>();
  private undo: { roomId: string; snapshot: RoomSnapshot } | null = null;
  private entries = 0;
  private readonly unsubscribe: () => void;

  constructor(options: { engine: PlaybackEngine; rooms: RoomsAudio; library: ShowLibrary; random?: Random }) {
    super();
    this.engine = options.engine;
    this.rooms = options.rooms;
    this.library = options.library;
    this.random = options.random ?? Math.random;
    this.unsubscribe = this.rooms.onRoomsChanged(() => this.dropGoneRooms());
  }

  run(action: CueAction): CueOutcome {
    try {
      return this.perform(action);
    } finally {
      this.emit("change");
    }
  }

  /** What every room plays, in the rooms' order. */
  report(): RoomReport[] {
    return this.rooms.rooms().map((room) => this.player(room.botId).report(room.name));
  }

  /** PLY-15: the library changed (its Normalise volume setting, a choice, or a track measured): gains follow. */
  libraryChanged(): void {
    for (const player of this.players.values()) player.refreshGains();
    this.emit("change");
  }

  // ---------- round 6: each room's running list and its Repeat (PLY-16, PLY-17) ----------

  /** Play next (right after the current track) or Add to queue (after the bottom of the plan), in the target's rooms. */
  addToList(how: "next" | "queue", what: ListWhat, target: RoomTarget): CueOutcome {
    try {
      const made = this.listEntry(what);
      if (!("entry" in made)) return made;
      return this.eachRoom(target, (player) => (player.addToList(how, made.entry, made.asPlan, DEFAULT_FADES.crossfade), OK));
    } finally {
      this.emit("change");
    }
  }

  /** × in Up next, in one room. */
  removeFromList(ref: UpNextRef, target: RoomTarget): CueOutcome {
    return this.listChange(target, (player) => player.removeFromList(ref), "That is no longer in Up next.");
  }

  clearList(target: RoomTarget): CueOutcome {
    return this.listChange(target, (player) => player.clearList(), "Nothing was added to clear.");
  }

  undoList(target: RoomTarget): CueOutcome {
    return this.listChange(target, (player) => player.undoList(), "There is nothing in Up next to undo.");
  }

  /** PLY-17: the room's Repeat (null: what the music does by itself). */
  setRepeat(repeat: RoomRepeat, target: RoomTarget): CueOutcome {
    return this.listChange(target, (player) => (player.setRepeat(repeat), true), "");
  }

  cycleRepeat(target: RoomTarget): CueOutcome {
    return this.listChange(target, (player) => (player.cycleRepeat(), true), "");
  }

  savedRepeatOneChanged(scene: { campaignId: string; sessionId: string; sceneId: string }, trackId: string): void {
    const key = keyOfPlace({ kind: "scene", ...scene });
    for (const player of this.players.values()) player.savedRepeatOneChanged(key, trackId);
    this.emit("change");
  }

  /** Another session was loaded: every room's list is cleared. */
  sessionLoaded(): void {
    for (const player of this.players.values()) player.sessionLoaded();
    this.emit("change");
  }

  /** What one Repeat shows now in a room (for an announcement). */
  shownRepeat(roomId: string): Repeat {
    return this.player(roomId).report("").repeat.shown;
  }

  private listChange(target: RoomTarget, act: (player: RoomPlayer) => boolean, failed: string): CueOutcome {
    try {
      return this.eachRoom(target, (player) => (act(player) ? OK : fail(failed)));
    } finally {
      this.emit("change");
    }
  }

  /** A list entry for what was asked, and what plays as the plan in a room where nothing plays. */
  private listEntry(what: ListWhat): { entry: ListEntry; asPlan: Playing } | CueOutcome {
    if (what.kind === "track") {
      const track = this.library.track(what.trackId);
      if (!track) return fail("That track is no longer in the library.");
      if (track.kind !== "music") return fail("Only music goes in Up next: play ambience and effects on their own.");
      const asPlan = this.itemFor(what.trackId, what.from);
      const place = what.from && "playlistId" in what.from ? (what.from.place ?? null) : null;
      const name = what.name ?? (track.title || track.metaTitle || track.fileName);
      return { entry: { trackIds: [what.trackId], playlistId: asPlan.playlistId, place, name }, asPlan };
    }
    const playlist = this.library.playlist(what.playlistId);
    if (!playlist) return fail("That playlist is no longer there.");
    if (playlist.lane !== "music") return fail("Only music goes in Up next: play ambience and effects on their own.");
    const asPlan = playlistItem(what.playlistId, null, this.library, { place: what.place ?? undefined, seed: this.newSeed() });
    if (!asPlan) return fail("This playlist has no tracks yet.");
    // A queued playlist is one item with its tracks in its place's order (ORG-13), dealt as it would play there.
    const trackIds = sequenceOf(asPlan.origin, this.library).map((step) => step.trackId);
    return { entry: { trackIds, playlistId: what.playlistId, place: what.place ?? null, name: what.name ?? playlist.name }, asPlan };
  }

  /** Whether Undo of the last scene start is still possible. */
  canUndo(): boolean {
    return this.undo !== null;
  }

  dispose(): void {
    this.unsubscribe();
    for (const player of this.players.values()) {
      player.dispose();
    }
    this.players.clear();
    this.removeAllListeners();
  }

  private perform(action: CueAction): CueOutcome {
    const seconds = (ms: number | undefined, fallback: number) => (ms === undefined ? fallback : ms / 1000);
    switch (action.type) {
      case "playTrack":
        return this.playTrack(action.trackId, action.target, action.when ?? "now", action.from, seconds(action.fadeMs, DEFAULT_FADES.crossfade));
      case "playPlaylist":
        return this.playPlaylist(action.playlistId, action.target, action.when ?? "now", seconds(action.fadeMs, DEFAULT_FADES.crossfade), action.place);
      case "startScene": {
        const scene = this.library.scene(action.scene);
        if (!scene) {
          return fail("That scene is no longer there.");
        }
        const roomId = sceneRoom([...this.rooms.rooms()]);
        if (roomId === null) {
          return fail(NO_ROOM);
        }
        const player = this.player(roomId);
        this.undo = { roomId, snapshot: player.snapshot() };
        player.startScene(action.scene, scene);
        return OK;
      }
      case "next":
      case "previous": {
        const direction = action.type === "next" ? 1 : -1;
        const fade = seconds(action.fadeMs, DEFAULT_FADES.crossfade);
        return this.eachRoom(action.target, (player) =>
          (action.lane === "music" ? player.stepMusic(direction, fade) : player.stepAmbience(direction, fade))
            ? OK
            : fail(action.lane === "music" ? "There is nothing to move on to." : "This ambience has nothing to move on to."),
        );
      }
      case "fadeLane": {
        const fade = seconds(action.fadeMs, action.lane === "effects" ? DEFAULT_FADES.effects : DEFAULT_FADES.fadeLane);
        return this.eachRoom(action.target, (player) => (player.fadeLane(action.lane, fade), OK));
      }
      case "fadeAll":
        return this.eachRoom(action.target ?? "all", (player) => (player.stopAll(seconds(action.fadeMs, DEFAULT_FADES.fadeAll)), OK));
      case "stopAll":
        return this.eachRoom(action.target ?? "all", (player) => (player.stopAll(0), OK));
      case "firePad": {
        const pad = this.library.pad(action.boardId, action.padId);
        if (!pad || pad.trackIds.length === 0) {
          return fail(padWithoutSound(pad));
        }
        const key = `${action.boardId}/${action.padId}`;
        const phase = action.phase ?? "down";
        // One variant per press, the same in every room it plays in; a press that only stops it (BUG-20) takes none.
        const starts = phase === "down" && roomsFor(action.target, [...this.rooms.rooms()]).some((id) => !this.player(id).padSounding(key));
        const trackId = starts ? this.pickVariant(key, pad.trackIds, pad.order) : pad.trackIds[0];
        return this.eachRoom(action.target, (player) => (player.firePad(key, pad, phase, trackId), OK));
      }
      case "stopPads":
        return this.eachRoom(action.target ?? "all", (player) => (player.stopPads(seconds(action.fadeMs, DEFAULT_FADES.padStop)), OK));
      case "removeQueued":
        return this.eachRoom(action.target, (player) => (player.removeQueued(action.entryId) ? OK : fail("That track is no longer in the queue.")));
      case "undoSceneStart": {
        const undo = this.undo;
        this.undo = null;
        if (!undo || !this.rooms.rooms().some((room) => room.botId === undo.roomId)) {
          return fail("There is no scene change to undo.");
        }
        this.player(undo.roomId).restore(undo.snapshot, DEFAULT_FADES.undo);
        return OK;
      }
      default:
        return fail("Lyre does not know that action.");
    }
  }

  private playTrack(trackId: string, target: RoomTarget, when: "now" | "next", from: TrackFrom | undefined, fade: number): CueOutcome {
    const track = this.library.track(trackId);
    if (!track) {
      return fail("That track is no longer in the library.");
    }
    if (track.kind === "fx") {
      // An effect plays over the music, like a pad.
      return this.eachRoom(target, (player) => (player.playEffect(trackId) ? OK : fail(`Unable to play sound: ${track.title}`)));
    }
    const item = this.itemFor(trackId, from);
    if (track.kind === "amb") {
      return this.eachRoom(target, (player) => (player.playAmbience(item, fade), OK));
    }
    return this.eachRoom(target, (player) => (when === "next" ? player.queueMusic(item, fade) : player.playMusic(item, fade), OK));
  }

  private playPlaylist(playlistId: string, target: RoomTarget, when: "now" | "next", fade: number, place?: UsePlace): CueOutcome {
    const playlist = this.library.playlist(playlistId);
    if (!playlist) {
      return fail("That playlist is no longer there.");
    }
    const item = playlistItem(playlistId, null, this.library, { place, seed: this.newSeed() });
    if (!item) {
      return fail("This playlist has no tracks yet.");
    }
    if (playlist.lane === "fx") {
      return this.eachRoom(target, (player) => (player.playEffect(item.trackId), OK));
    }
    if (playlist.lane === "amb") {
      return this.eachRoom(target, (player) => (player.playAmbience(item, fade), OK));
    }
    if (when === "next") {
      const trackIds = sequenceOf(item.origin, this.library).map((step) => step.trackId);
      const entry = { trackIds, playlistId, place: place ?? null, name: playlist.name };
      return this.eachRoom(target, (player) => (player.addToList("next", entry, item, fade), OK));
    }
    return this.eachRoom(target, (player) => (player.playMusic(item, fade), OK));
  }

  /** The item for a track picked from a scene or a playlist; off script when it is not (or no longer) there. */
  private itemFor(trackId: string, from: TrackFrom | undefined): Playing {
    let item: Playing | null = null;
    if (from && "scene" in from) {
      const seed = this.newSeed();
      item = sceneItem(from.scene, from.at, this.library, seed);
      // A shuffled playlist is dealt afresh, so the step the screen named may hold another track now: play the same
      // track from its place in the new deal, within the same scene item, so Next goes on from the scene.
      if (item && item.trackId !== trackId && item.origin.kind === "scene") {
        const seq = sequenceOf(item.origin, this.library);
        const itemIndex = seq[from.at]?.itemIndex;
        const at = seq.findIndex((step) => step.itemIndex === itemIndex && step.trackId === trackId);
        if (at > -1) item = sceneItem(from.scene, at, this.library, seed);
      }
    } else if (from && "playlistId" in from) {
      item = playlistItem(from.playlistId, trackId, this.library, { place: from.place, seed: this.newSeed() });
    }
    return item && item.trackId === trackId ? item : single(trackId);
  }

  /** Run `act` in every room the target names. Works when it worked in at least one room. */
  private eachRoom(target: RoomTarget, act: (player: RoomPlayer) => CueOutcome): CueOutcome {
    const ids = roomsFor(target, [...this.rooms.rooms()]);
    if (ids.length === 0) {
      return fail(NO_ROOM);
    }
    const outcomes = ids.map((id) => act(this.player(id)));
    return outcomes.find((outcome) => outcome.ok) ?? outcomes[0];
  }

  /** PLY-13: a seed to deal a shuffled playlist with, from the host's random numbers. */
  private newSeed(): number {
    return Math.floor(this.random() * 2 ** 31);
  }

  private pickVariant(key: string, trackIds: string[], order: "random" | "roundrobin"): string {
    if (order === "roundrobin") {
      const turn = this.turns.get(key) ?? 0;
      this.turns.set(key, turn + 1);
      return trackIds[turn % trackIds.length];
    }
    return trackIds[Math.min(trackIds.length - 1, Math.floor(this.random() * trackIds.length))];
  }

  private player(roomId: string): RoomPlayer {
    let player = this.players.get(roomId);
    if (!player) {
      player = new RoomPlayer(roomId, {
        engine: this.engine,
        rooms: this.rooms,
        library: this.library,
        changed: () => this.emit("change"),
        error: (message) => this.emit("error", message),
        newEntryId: () => `q${++this.entries}`,
        newSeed: () => this.newSeed(),
      });
      this.players.set(roomId, player);
    }
    return player;
  }

  private dropGoneRooms() {
    const present = new Set(this.rooms.rooms().map((room) => room.botId));
    for (const [roomId, player] of this.players) {
      if (!present.has(roomId)) {
        player.dispose();
        this.players.delete(roomId);
        if (this.undo?.roomId === roomId) {
          this.undo = null;
        }
      }
    }
    this.emit("change");
  }
}

function fail(message: string): CueOutcome {
  return { ok: false, message };
}

/**
 * Security review w4: what a press of a pad with no sound says, naming the pad, so the game master knows mid-game which
 * one to fix ("Horse whinny has no sound: give it one on its board.").
 */
export function padWithoutSound(pad: { label?: string } | undefined): string {
  if (!pad) return "That pad is no longer on its board.";
  return `${pad.label?.trim() || "That pad"} has no sound: give it one on its board.`;
}
