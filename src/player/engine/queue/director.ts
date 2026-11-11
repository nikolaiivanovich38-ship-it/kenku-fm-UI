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

import { keyOfPlace, roomsFor, sceneRoom, sceneSequence } from "../../../common/domain";
import type { CueStep, Repeat, RoomRepeat, RoomTarget, UpNextRef, UsePlace } from "../../../common/domain";
import type { PlaybackEngine } from "../engine";
import type { RoomsAudio } from "../rooms.contract";
import { CueAction, CueOutcome, DEFAULT_FADES, TrackFrom } from "./actions";
import type { SceneRef, ShowLibrary } from "./library";
import { Playing, playlistItem, sceneItem, sequenceOf, single } from "./nowPlaying";
import type { Random } from "./queue";
import { RoomPlayer, RoomReport, RoomSnapshot, type ListEntry } from "./roomPlayer";

/** PLY-16: what Play next and Add to queue take: a track (from where it was picked) or a whole playlist. */
export type ListWhat =
  /** `fromMs` (DAT-3): where in the file it starts, from a marker. */
  | { kind: "track"; trackId: string; from?: TrackFrom; name?: string; fromMs?: number }
  | { kind: "playlist"; playlistId: string; place?: UsePlace | null; name?: string };

interface DirectorEvents {
  /** What a room plays changed; read `report()`. */
  change: () => void;
  /** A plain-language message for a toast. */
  error: (message: string) => void;
  /** PLY-8: a step shows a pad board (Live shows it). */
  "show-board": (at: { boardId: string; scene: SceneRef | null }) => void;
  /** PLY-8: a scene started: pressed, by another scene's or pad's step, or moving on by itself. */
  "scene-started": (at: { scene: SceneRef; by: SceneStartedBy }) => void;
}

export type SceneStartedBy = "press" | "step" | "moved-on";

/** PLY-8: a scene's start may start another scene; one starting itself stops after this many rounds. */
const MAX_STEP_DEPTH = 4;
const STARTS_ITSELF = "This scene's start starts scenes over and over; Lyre stopped after a few rounds. Change what it does when it starts.";

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
  /** PLY-8: the scene start whose steps may still run (a new start or Undo stops the old one's), and its timer. */
  private sceneRun = 0;
  private movesOnTimer: unknown = null;
  /** CR-1: pad step runs still allowed to go on; Stop all and Fade all move it on, which ends every one. */
  private padRunGeneration = 0;
  private lastScene: SceneRef | null = null;
  /**
   * PLY-4: where each "Pick up where it stopped" track was stopped (every room shares it); the host may hand in one
   * kept across restarts (resumePositions.ts), else it lasts for the evening.
   */
  private readonly resumeAt: Map<string, number>;
  private readonly unsubscribe: () => void;

  constructor(options: { engine: PlaybackEngine; rooms: RoomsAudio; library: ShowLibrary; random?: Random; resumeAt?: Map<string, number> }) {
    super();
    this.engine = options.engine;
    this.resumeAt = options.resumeAt ?? new Map();
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
      const from = what.kind === "track" && what.fromMs !== undefined ? what.fromMs / 1000 : undefined;
      return this.eachRoom(target, (player) => (player.addToList(how, made.entry, made.asPlan, this.crossfadeSeconds(), from), OK));
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
        return this.playTrack(action.trackId, action.target, action.when ?? "now", action.from, seconds(action.fadeMs, this.crossfadeSeconds()), action.fromMs);
      case "playPlaylist":
        return this.playPlaylist(action.playlistId, action.target, action.when ?? "now", seconds(action.fadeMs, this.crossfadeSeconds()), action.place);
      case "startScene":
        return this.startSceneNow(action.scene, "press", 0);
      case "next":
      case "previous": {
        const direction = action.type === "next" ? 1 : -1;
        const fade = seconds(action.fadeMs, this.crossfadeSeconds());
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
        this.cancelEverythingWaiting();
        return this.eachRoom(action.target ?? "all", (player) => (player.stopAll(seconds(action.fadeMs, DEFAULT_FADES.fadeAll)), OK));
      case "stopAll":
        this.cancelEverythingWaiting();
        return this.eachRoom(action.target ?? "all", (player) => (player.stopAll(0), OK));
      case "firePad":
        return this.firePadNow(action.boardId, action.padId, action.phase ?? "down", action.target, 0);
      case "stopPads":
        return this.eachRoom(action.target ?? "all", (player) => (player.stopPads(seconds(action.fadeMs, DEFAULT_FADES.padStop)), OK));
      case "removeQueued":
        return this.eachRoom(action.target, (player) => (player.removeQueued(action.entryId) ? OK : fail("That track is no longer in the queue.")));
      case "undoSceneStart": {
        const undo = this.undo;
        this.undo = null;
        // PLY-8: the scene's waiting steps and its moving on stop too.
        this.stopSceneRun();
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

  /** The crossfade Next, a playlist moving on and play steps use (Settings › Between tracks), in seconds. */
  private crossfadeSeconds(): number {
    const ms = this.library.crossfade?.().ms;
    return ms === undefined ? DEFAULT_FADES.crossfade : ms / 1000;
  }

  // ---------- PLY-8 steps ----------

  /** Starts a scene in the first room: its usual start, or its own steps; then its moving on by itself. */
  private startSceneNow(ref: SceneRef, by: SceneStartedBy, depth: number): CueOutcome {
    if (depth > MAX_STEP_DEPTH) return fail(STARTS_ITSELF);
    const scene = this.library.scene(ref);
    if (!scene) return fail("That scene is no longer there.");
    const roomId = sceneRoom([...this.rooms.rooms()]);
    if (roomId === null) return fail(NO_ROOM);
    const player = this.player(roomId);
    if (by === "press") this.undo = { roomId, snapshot: player.snapshot() };
    this.stopSceneRun();
    const run = ++this.sceneRun;
    this.lastScene = ref;
    const steps = scene.steps ?? null;
    if (!steps) player.startScene(ref, scene);
    else {
      // The scene's music from the item its music step names (and that step's marker); none: the music stops.
      const music = steps.find((st): st is Extract<CueStep, { do: "music" }> => st.do === "music");
      const index = music ? scene.music.findIndex((m) => m.kind === music.what.kind && m.id === music.what.id) : -1;
      const at = Math.max(0, sceneSequence(scene, this.library).findIndex((st) => st.itemIndex === Math.max(0, index)));
      const fadeSeconds = music?.how === "cut" ? 0 : this.crossfadeSeconds();
      const fromSeconds = music?.fromMs != null ? music.fromMs / 1000 : undefined;
      const waits = music && music.how !== "crossfade" && music.how !== "cut";
      player.startScene(ref, scene, { music: music && !waits ? { at, fadeSeconds, fromSeconds } : null, ambience: steps.some((st) => st.do === "ambience"), keepMusic: !!waits });
      if (music && waits) player.handOverAt(music.how, () => player.startScenePlan(ref, at, fadeSeconds, fromSeconds));
    }
    const movesOn = scene.movesOn;
    if (movesOn?.when === "after") {
      this.movesOnTimer = this.engine.scheduler.setTimeout(() => {
        this.movesOnTimer = null;
        if (this.sceneRun === run) this.moveOn(ref);
      }, movesOn.ms);
    }
    this.emit("scene-started", { scene: ref, by });
    // Its other steps run last: one may start another scene, which stops what is left of this one.
    if (steps) this.runSteps(steps.filter((st) => st.do !== "music" && st.do !== "ambience"), 0, { target: { room: roomId }, alive: () => this.sceneRun === run, depth, scene: ref });
    return OK;
  }

  /** PLY-8: the scene moves on by itself: the next scene of its session starts (the last scene stays). */
  private moveOn(from: SceneRef): void {
    const next = this.library.nextScene?.(from) ?? null;
    if (!next) return;
    const outcome = this.startSceneNow(next, "moved-on", 0);
    if ("message" in outcome) this.emit("error", outcome.message);
    this.emit("change");
  }

  /**
   * CR-1: Stop all and Fade all leave nothing to start by itself later: the scene's moving on, its steps after a wait,
   * every pad's steps, and the scene's Undo (the prototype ends the Undo strips here too). Each room's waiting
   * hand-over ends with its music (RoomPlayer.stopAll).
   */
  private cancelEverythingWaiting(): void {
    this.stopSceneRun();
    this.padRunGeneration++;
    this.lastScene = null;
    this.undo = null;
  }

  private stopSceneRun(): void {
    this.sceneRun++;
    if (this.movesOnTimer !== null) this.engine.scheduler.clearTimeout(this.movesOnTimer);
    this.movesOnTimer = null;
  }

  /** A pad press: its own steps when it has them (its sound is the "sound" step), else its sound. */
  private firePadNow(boardId: string, padId: string, phase: "down" | "up", target: RoomTarget, depth: number): CueOutcome {
    if (depth > MAX_STEP_DEPTH) return fail(STARTS_ITSELF);
    const pad = this.library.pad(boardId, padId);
    const key = `${boardId}/${padId}`;
    const sounding = roomsFor(target, [...this.rooms.rooms()]).some((id) => this.player(id).padSounding(key));
    const steps = pad?.steps ?? null;
    // A let-go, or a press that stops a sounding pad (BUG-20), is only about its sound.
    if (pad && steps && phase === "down" && !sounding) {
      const generation = this.padRunGeneration;
      this.runSteps(steps, 0, { target, alive: () => this.padRunGeneration === generation, depth, sound: () => this.padSound(boardId, padId, "down", target) });
      return OK;
    }
    return this.padSound(boardId, padId, phase, target);
  }

  private padSound(boardId: string, padId: string, phase: "down" | "up", target: RoomTarget): CueOutcome {
    const pad = this.library.pad(boardId, padId);
    if (!pad || pad.trackIds.length === 0) {
      return fail(padWithoutSound(pad));
    }
    const key = `${boardId}/${padId}`;
    // One variant per press, the same in every room it plays in; a press that only stops it (BUG-20) takes none.
    const starts = phase === "down" && roomsFor(target, [...this.rooms.rooms()]).some((id) => !this.player(id).padSounding(key));
    const trackId = starts ? this.pickVariant(key, pad.trackIds, pad.order) : pad.trackIds[0];
    return this.eachRoom(target, (player) => (player.firePad(key, pad, phase, trackId), OK));
  }

  /** Runs steps in order from `i`; a wait goes on later on the engine's clock (unless the run was stopped). */
  private runSteps(steps: readonly CueStep[], i: number, run: { target: RoomTarget; alive: () => boolean; depth: number; scene?: SceneRef; sound?: () => CueOutcome }): void {
    for (; i < steps.length; i++) {
      if (!run.alive()) return;
      const step = steps[i];
      const outcome = this.runStep(step, run);
      if ("message" in outcome) this.emit("error", outcome.message);
      if (step.do === "wait") {
        const next = i + 1;
        this.engine.scheduler.setTimeout(() => {
          this.runSteps(steps, next, run);
          this.emit("change");
        }, step.ms);
        return;
      }
      if (step.do === "scene" && outcome.ok) return;
    }
  }

  private runStep(step: CueStep, run: { target: RoomTarget; depth: number; scene?: SceneRef; sound?: () => CueOutcome }): CueOutcome {
    switch (step.do) {
      case "sound":
        return run.sound ? run.sound() : OK;
      case "play":
        return this.playStep(step, run.target);
      case "stop":
        if (step.what === "all") return this.eachRoom(run.target, (player) => (player.stopAll(DEFAULT_FADES.fadeAll), OK));
        return this.eachRoom(run.target, (player) => (player.fadeLane(step.what === "music" ? "music" : "ambience", DEFAULT_FADES.fadeLane), OK));
      case "fade":
        return this.eachRoom(run.target, (player) => (player.fadeMusicTo(step.level, step.ms / 1000), OK));
      case "pad":
        return this.firePadNow(step.boardId, step.padId, "down", run.target, run.depth + 1);
      case "scene":
        return this.startSceneNow(step.scene, "step", run.depth + 1);
      case "board":
        this.emit("show-board", { boardId: step.boardId, scene: run.scene ?? null });
        return OK;
      default:
        // wait is handled by runSteps; a scene's music and ambience by its start.
        return OK;
    }
  }

  /** A play step: a track or playlist, coming in as it says, replacing what plays or into Up next. */
  private playStep(step: Extract<CueStep, { do: "play" }>, target: RoomTarget): CueOutcome {
    const fade = step.how === "cut" ? 0 : this.crossfadeSeconds();
    const from = step.fromMs != null ? step.fromMs / 1000 : undefined;
    if (step.what.kind === "track") {
      const track = this.library.track(step.what.id);
      if (!track) return fail("That track is no longer in the library.");
      if (track.kind !== "music") return this.playTrack(track.id, target, "now", undefined, fade, step.fromMs ?? undefined);
    } else {
      const playlist = this.library.playlist(step.what.id);
      if (!playlist) return fail("That playlist is no longer there.");
      if (playlist.lane !== "music") return this.playPlaylist(playlist.id, target, "now", fade);
    }
    const made = this.listEntry(step.what.kind === "track" ? { kind: "track", trackId: step.what.id } : { kind: "playlist", playlistId: step.what.id });
    if (!("entry" in made)) return made;
    return this.eachRoom(target, (player) => {
      if (step.upNext !== "replace") player.addToList(step.upNext === "playNext" ? "next" : "queue", made.entry, made.asPlan, fade, from);
      else player.handOverAt(step.how, () => player.playMusic(made.asPlan, fade, from));
      return OK;
    });
  }

  private playTrack(trackId: string, target: RoomTarget, when: "now" | "next", from: TrackFrom | undefined, fade: number, fromMs?: number): CueOutcome {
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
    const at = fromMs === undefined ? undefined : fromMs / 1000;
    return this.eachRoom(target, (player) => (when === "next" ? player.queueMusic(item, fade, at) : player.playMusic(item, fade, at), OK));
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
        timers: this.engine.scheduler,
        resumeAt: this.resumeAt,
        playsOnce: (scene) => this.library.scene(scene)?.movesOn?.when === "musicEnds",
        planEnded: (scene) => {
          // Only the scene that started last moves on (an older scene's list ending is not a cue).
          const last = this.lastScene;
          if (last && last.campaignId === scene.campaignId && last.sessionId === scene.sessionId && last.sceneId === scene.sceneId) this.moveOn(scene);
        },
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
