/**
 * One room's sound (PLY-8): its music lane (a scene or playlist in order, the
 * Now Playing queue, the way back after an off-script track), its ambience
 * lane (one looping track) and its effects (one-shots and pads). It turns the
 * decisions of nowPlaying.ts into voices on the room's buses, each playing
 * its audio profile (PLY-12), and moves on when a voice reaches its End.
 *
 * Fades follow the prototype: a press crossfades (the new track fades in while
 * the old one fades out); a track reaching End hands over with no extra fade,
 * since its own profile already shapes the join.
 */
import {
  addToQueue,
  clearAdded,
  DEFAULT_LIBRARY_NORMALISE,
  emptyRoomList,
  keyOfPlace,
  musicStopped,
  newPlan,
  nextRepeat,
  normalisedGainDb,
  parseKeyOfPlace,
  pickNext,
  playNext as listPlayNext,
  playNow as listPlayNow,
  removeFromUpNext,
  repeatsOneIn,
  sceneStarted,
  setRoomRepeat,
  setRoomShuffle,
  shuffledOrder,
  shownRepeat,
  undoLast,
  addPlayed,
  roleProfile,
  upNext as listUpNext,
  type PlayedEntry,
  type PlayedFrom,
  type StepHow,
  type AfterEnd,
  type AudioProfile,
  type DomainScene,
  type DomainTrack,
  type ListItem,
  type ListPick,
  type PlanView,
  type Repeat,
  type RoomList,
  type RoomRepeat,
  type UpNextEntry,
  type UpNextRef,
  type UsePlace,
} from "../../common/domain";
import type { PlaybackEngine } from "../engine";
import { laneProfile, profileInputFor } from "../profile/trackProfile";
import type { Scheduler } from "../audio/types";
import { positionAfter } from "../profile/position";
import type { RoomLane, RoomsAudio } from "../rooms.contract";
import type { MediaRequest } from "../sources/sourceLoader";
import type { Voice, VoiceOptions, VoiceState } from "../voice/voice";
import { DEFAULT_FADES } from "./actions";
import type { PadSound, SceneRef, ShowLibrary } from "./library";
import {
  afterEnd,
  afterTrackEnded,
  EMPTY_LANE,
  itemAt,
  locate,
  MusicLane,
  Origin,
  placesOf,
  Playing,
  playlistItem,
  playOrderOf,
  previous,
  sceneItem,
  sequenceOf,
  single,
  stepFrom,
} from "./nowPlaying";

export interface RoomPlayerDeps {
  engine: PlaybackEngine;
  rooms: RoomsAudio;
  library: ShowLibrary;
  /** Something the screen shows changed. */
  changed: () => void;
  /** A plain-language message for a toast. */
  error: (message: string) => void;
  newEntryId: () => string;
  /** PLY-13: a seed to deal a shuffled playlist with (a new order each time it starts). */
  newSeed?: () => number;
  /** Round 7: timers on the engine's clock (a hand-over at a mix-out marker or at the end of a loop). */
  timers?: Scheduler;
  /** PLY-4: where each "Pick up where it stopped" track was last stopped this evening, in seconds (shared by rooms). */
  resumeAt?: Map<string, number>;
  /** PLY-1: the time now (ms since 1970), for What played. */
  now?: () => number;
  /** PLY-8: whether a scene's music plays once (it moves on when its music ends) instead of starting again. */
  playsOnce?: (scene: SceneRef) => boolean;
  /** PLY-8: the room's scene played its music to the end with nothing waiting (a scene that moves on). */
  planEnded?: (scene: SceneRef) => void;
}

export interface PlayingReport {
  trackId: string;
  title: string;
  origin: Origin;
  playlistId: string | null;
  /** Seconds into the file; null until it plays. */
  positionSeconds: number | null;
  state: VoiceState | null;
  /** PLY-15: the normalising gain it plays at, in dB (0: as it is). */
  gainDb: number;
  /** PLY-8: the level a Fade step left it at, 0 to 1 (1: as it plays). */
  level: number;
}

export interface RoomReport {
  roomId: string;
  name: string;
  music: PlayingReport | null;
  /** The track Next would play. */
  upNext: string | null;
  /** What was added to the room's list (Play next items, then Add to queue items), as entries of `list`. */
  queued: { entryId: string; trackId: string }[];
  /** PLY-16: Up next, top to bottom (roomList.ts upNext): Play next items, the plan still to come, what was added. */
  list: UpNextEntry[];
  /** PLY-17: the room's Repeat: the one chosen for what plays now (null: none) and the one that applies. */
  repeat: { chosen: RoomRepeat; shown: Repeat };
  /** 0.5.1: the room's Shuffle is on (for what plays now). */
  shuffle: boolean;
  /** The last add, removal or Clear added can be undone. */
  canUndoList: boolean;
  ambience: PlayingReport | null;
  /** Effects and pads sounding (not fading out). */
  effects: { trackId: string; padKey: string | null }[];
  /** PLY-1: the music that played in this room this evening, newest first. */
  played: PlayedEntry[];
}

/** What Undo needs to bring a room's music and ambience back. */
export interface RoomSnapshot {
  music: MusicLane;
  /** Round 6: the room's list and its plan, which a new scene clears and the scene's Undo brings back. */
  list: RoomList;
  plan: Playing | null;
  musicAt: number | null;
  ambience: Playing | null;
  ambienceAt: number | null;
  takenAt: number;
}

/** After this many tracks in a row fail, the music stops instead of trying the next. */
const MAX_FAILURES_IN_A_ROW = 3;

/** A press with no fade still fades the old track this much, so it does not click (as the prototype). */
const MIN_HANDOVER_SECONDS = 0.3;

interface LaneVoice {
  voice: Voice;
  item: Playing;
  after: AfterEnd;
  /** The profile it plays with (where its mix-out marker and End are). */
  profile: AudioProfile;
}

/** What a screen adds to a room's list: one track (with where it came from) or a playlist's tracks in its order there. */
export interface ListEntry {
  trackIds: string[];
  playlistId: string | null;
  place: UsePlace | null;
  name: string;
}

export class RoomPlayer {
  private music: MusicLane = EMPTY_LANE;
  /** PLY-16, PLY-17: the room's running list for the evening and its Repeat (src/common/domain/roomList.ts). */
  private list: RoomList = emptyRoomList();
  /** The item the plan last played: a scene's step, a playlist's step, or a single track played as the plan. */
  private plan: Playing | null = null;
  private musicVoice: LaneVoice | null = null;
  private ambienceItem: Playing | null = null;
  private ambienceVoice: LaneVoice | null = null;
  private readonly effects: { voice: Voice; trackId: string; padKey: string | null }[] = [];
  /** PLY-15: what each lane's track gets where it plays from (normalisedGainDb). */
  private gainOf(track: DomainTrack | undefined, playlistId: string | null): number {
    const lib = this.deps.library;
    return normalisedGainDb(track, playlistId ? lib.playlist(playlistId) : null, lib.normaliseSettings?.() ?? DEFAULT_LIBRARY_NORMALISE);
  }
  private failures = 0;
  private plays = 0;
  /** PLY-1: what played here this evening, newest first. */
  private played: PlayedEntry[] = [];
  /** PLY-8: the music's level after a Fade step (a new track starts at full level). */
  private musicLevel = 1;
  /** PLY-8: a play step waiting for the current track to end, its mix-out marker or the end of its loop. */
  private handOver: { start: () => void; cancel: () => void } | null = null;
  /** DAT-3: where an added item's first track starts (Play next or Add to queue from a marker), in seconds. */
  private readonly startFrom = new Map<string, number>();

  constructor(
    readonly roomId: string,
    private readonly deps: RoomPlayerDeps,
  ) {}

  // ---------- music ----------

  /**
   * Play now, crossfading over `fadeSeconds`. A playlist or a scene's step is a new plan for the room (what was added
   * stays, its Repeat and skips go); a single track while music plays plays now and the list carries on after it.
   */
  playMusic(item: Playing, fadeSeconds: number, fromSeconds?: number): void {
    this.cancelHandOver();
    if (item.origin.kind === "single" && this.music.current) {
      const added = this.newItem({ trackIds: [item.trackId], playlistId: item.playlistId, place: null, name: this.titleOf(item.trackId) });
      const now = listPlayNow(this.list, added, this.planView(false));
      if (now.pick) {
        this.list = now.list;
        if (fromSeconds !== undefined) this.startFrom.set(added.id, fromSeconds);
        this.startPick(now.pick, fadeSeconds);
        return;
      }
    }
    this.list = newPlan(this.list);
    this.startPlan(item, fadeSeconds, fromSeconds);
  }

  /** Play next (PLY-16): right after the current track. With nothing playing, `asPlan` plays at once. */
  queueMusic(item: Playing, fadeSeconds: number, fromSeconds?: number): void {
    this.addToList("next", { trackIds: [item.trackId], playlistId: item.playlistId, place: null, name: this.titleOf(item.trackId) }, item, fadeSeconds, fromSeconds);
  }

  /** Play next or Add to queue (PLY-16). With nothing playing, `asPlan` plays at once as the room's plan. */
  addToList(how: "next" | "queue", entry: ListEntry, asPlan: Playing, fadeSeconds: number, fromSeconds?: number): "added" | "playing" {
    if (!this.music.current) {
      this.playMusic(asPlan, fadeSeconds, fromSeconds);
      return "playing";
    }
    const item = this.newItem(entry);
    if (fromSeconds !== undefined) this.startFrom.set(item.id, fromSeconds);
    this.list = how === "next" ? listPlayNext(this.list, item, this.planView(false)) : addToQueue(this.list, item);
    this.deps.changed();
    return "added";
  }

  /** × in Up next. False when that entry is no longer there. */
  removeFromList(ref: UpNextRef): boolean {
    return this.changeList((list) => removeFromUpNext(list, ref));
  }

  removeQueued(entryId: string): boolean {
    return this.removeFromList({ kind: "added", itemId: entryId });
  }

  /** Clear added: Play next and the queue empty. False when there was nothing added. */
  clearList(): boolean {
    return this.changeList(clearAdded);
  }

  /** Undo of the last add, removal or Clear added. False when there is none. */
  undoList(): boolean {
    return this.list.undo !== null && this.changeList(undoLast);
  }

  /** PLY-17: the room's Repeat for what plays now (null: back to what the music does by itself). */
  setRepeat(repeat: RoomRepeat): void {
    this.list = setRoomRepeat(this.list, repeat);
    this.deps.changed();
  }

  /**
   * 0.5.1: the room's Shuffle pressed: on, the plan's steps are dealt in a random order, the one that plays first (so
   * the rest come after it); off, the plan's own order again. True when it is now on.
   */
  toggleShuffle(): boolean {
    if (this.list.shuffle) {
      this.list = setRoomShuffle(this.list, null);
    } else {
      const view = this.planView(false);
      const keys = view.steps.map((s) => s.key);
      const current = view.at !== null ? view.steps[view.at]?.key : undefined;
      const rest = shuffledOrder(keys.filter((k) => k !== current), this.deps.newSeed?.() ?? Date.now());
      this.list = setRoomShuffle(this.list, current ? [current, ...rest] : rest);
    }
    this.deps.changed();
    return this.list.shuffle !== null;
  }

  /** PLY-17: Repeat pressed: off, all, one in turn from what it shows. */
  cycleRepeat(): Repeat {
    const next = nextRepeat(this.shownRepeat());
    this.setRepeat(next);
    return next;
  }

  /** PLY-17: a saved Repeat one changed on the track this room plays in that scene: the Repeat chosen here gives way. */
  savedRepeatOneChanged(sceneKey: string, trackId: string): void {
    const cur = this.music.current;
    if (cur && cur.trackId === trackId && cur.origin.kind === "scene" && keyOfPlace({ kind: "scene", ...cur.origin.scene }) === sceneKey) this.setRepeat(null);
  }

  /** Another session was loaded: the room's list is cleared; what plays goes on. */
  sessionLoaded(): void {
    this.list = emptyRoomList();
    this.deps.changed();
  }

  /** Next (the list: Play next, the plan, what was added) or Previous (the plan). False when there is nowhere to go. */
  stepMusic(direction: 1 | -1, fadeSeconds: number): boolean {
    if (direction === 1) {
      const { list, pick } = pickNext(this.list, this.planView(false), { ended: false, repeat: this.shownRepeat() });
      if (!pick) return false;
      // CR-4: music that waited for this track's end, mix-out or loop end is called off.
      this.cancelHandOver();
      this.list = list;
      this.startPick(pick, fadeSeconds);
      return true;
    }
    // From something added, Previous goes back to where the plan was.
    if (this.list.now.kind !== "plan" && this.list.ret !== null && this.plan) {
      const at = this.list.ret;
      this.cancelHandOver();
      this.list = { ...this.list, now: { kind: "plan" }, ret: null, backToQueue: null };
      this.startPick({ from: "plan", at }, fadeSeconds);
      return true;
    }
    const { lane, play } = previous(this.music, this.deps.library);
    if (!play) {
      return false;
    }
    this.cancelHandOver();
    this.music = lane;
    this.plan = play;
    this.startMusic(play, fadeSeconds);
    return true;
  }

  startScene(ref: SceneRef, scene: DomainScene, own?: { music: { at: number; fadeSeconds: number; fromSeconds?: number } | null; ambience: boolean; keepMusic?: boolean }): void {
    const lib = this.deps.library;
    const seed = this.deps.newSeed?.();
    this.cancelHandOver();
    // PLY-8: a scene with its own start plays its music from the item its music step names (none: silent).
    const first = own ? (own.music ? sceneItem(ref, own.music.at, lib, seed) : null) : sceneItem(ref, 0, lib, seed);
    // A new scene clears what was added to the room's list (Nik, 6 Nov 13:55); its Undo brings it back (snapshot).
    this.list = sceneStarted(this.list);
    this.music = { ...this.music, queued: [], returnTo: null };
    if (first) {
      this.startPlan(first, own?.music ? own.music.fadeSeconds : DEFAULT_FADES.sceneMusic, own?.music?.fromSeconds);
    } else if (own && !own.keepMusic) {
      this.fadeLane("music", DEFAULT_FADES.sceneAmbience);
    }
    const ambience = own && !own.ambience ? null : scene.ambience;
    // The scene's ambience playlist plays as its play order in this scene says (PLY-13).
    const item = ambience?.kind === "playlist" ? playlistItem(ambience.id, null, lib, { place: { kind: "scene", ...ref }, seed }) : ambience ? single(ambience.id) : null;
    if (item) {
      this.playAmbience(item, DEFAULT_FADES.sceneAmbience);
    } else {
      this.fadeLane("ambience", DEFAULT_FADES.sceneAmbience);
    }
    this.deps.changed();
  }

  // ---------- round 7: steps, hand-overs, fades (PLY-8) ----------

  /**
   * PLY-8: start something when the current track ends, at its mix-out marker, or at the end of its loop (a play
   * step's How it comes in). Nothing playing, a crossfade or a cut: now. Another press cancels a waiting one.
   */
  handOverAt(when: StepHow, start: () => void): void {
    this.cancelHandOver();
    const lane = this.musicVoice;
    if (!lane || when === "crossfade" || when === "cut" || !this.deps.timers) {
      start();
      return;
    }
    const at = lane.voice.position();
    const mix = lane.profile.markers.find((m) => m.mix);
    const end = lane.profile.endMs / 1000;
    let waitSeconds: number | null = null;
    if (when === "mixOut" && mix && mix.atMs / 1000 > at) waitSeconds = mix.atMs / 1000 - at;
    // A track that loops never ends by itself: the end of its loop is where it hands over.
    else if (when === "loopEnds" || lane.after === "loop") waitSeconds = Math.max(0, end - at);
    const timers = this.deps.timers;
    if (waitSeconds === null) {
      // When it ends (musicEnded runs what waits).
      this.handOver = { start, cancel: () => undefined };
      return;
    }
    const handle = timers.setTimeout(() => {
      if (this.handOver?.start !== start) return;
      this.handOver = null;
      start();
    }, waitSeconds * 1000);
    this.handOver = { start, cancel: () => timers.clearTimeout(handle) };
  }

  /** PLY-8: the scene's music from step `at` of its list, as a new plan (a music step that waited for its moment). */
  startScenePlan(ref: SceneRef, at: number, fadeSeconds: number, fromSeconds?: number): void {
    const item = sceneItem(ref, at, this.deps.library, this.deps.newSeed?.());
    if (!item) return;
    this.list = newPlan(this.list);
    this.startPlan(item, fadeSeconds, fromSeconds);
    this.deps.changed();
  }

  /** A waiting hand-over is called off (another track was started, the music stopped, Undo). */
  cancelHandOver(): void {
    this.handOver?.cancel();
    this.handOver = null;
  }

  /** PLY-8 Fade step: the music to `level` (0 to 1) over `seconds`; the next track starts at full level. */
  fadeMusicTo(level: number, seconds: number): void {
    this.musicLevel = Math.max(0, Math.min(1, level));
    this.musicVoice?.voice.setVolume(this.musicLevel, seconds);
    this.deps.changed();
  }

  /** A plan item plays now (a new plan, or the plan's next step). */
  private startPlan(item: Playing, fadeSeconds: number, fromSeconds?: number): void {
    this.plan = item;
    this.music = { ...this.music, current: item, returnTo: null };
    this.startMusic(item, fadeSeconds, undefined, fromSeconds);
  }

  /** Play what the list picked. */
  private startPick(pick: ListPick, fadeSeconds: number): void {
    if (pick.from === "plan") {
      const item = this.planItemAt(pick.at);
      if (item) this.startPlan(item, fadeSeconds);
      return;
    }
    const place = pick.item.placeKey ? parseKeyOfPlace(pick.item.placeKey) : null;
    const item: Playing = { trackId: pick.trackId, origin: place ? { kind: "single", place } : { kind: "single" }, playlistId: pick.item.playlistId };
    this.music = { ...this.music, current: item, returnTo: null };
    // DAT-3: an item added from a marker starts its first track there.
    const from = pick.trackId === pick.item.trackIds[0] ? this.startFrom.get(pick.item.id) : undefined;
    this.startFrom.delete(pick.item.id);
    this.startMusic(item, fadeSeconds, undefined, from);
  }

  /** The plan's step `at` as an item to play. */
  private planItemAt(at: number): Playing | null {
    const plan = this.plan;
    if (!plan) return null;
    if (plan.origin.kind === "single") return plan;
    const seq = sequenceOf(plan.origin, this.deps.library);
    return seq[at] ? itemAt(plan, seq, at) : null;
  }

  /** The room's plan as the list sees it now (roomList.ts PlanView). */
  private planView(ended: boolean): PlanView {
    const plan = this.plan;
    const lib = this.deps.library;
    if (!plan) return { steps: [], at: null, inner: null, loops: false, keepAdded: false };
    const origin = plan.origin;
    const seq = origin.kind === "single" ? [{ trackId: plan.trackId, playlistId: plan.playlistId, itemIndex: 0 }] : sequenceOf(origin, lib);
    // A skip is kept by the step's place: its position in a scene, its track in a playlist (a new deal moves positions).
    const steps = seq.map((step, i) => ({ trackId: step.trackId, playlistId: step.playlistId, key: origin.kind === "scene" ? `s:${i}` : `t:${step.trackId}` }));
    const plays = this.list.now.kind === "plan" && this.music.current !== null;
    const at = plays ? (origin.kind === "single" ? 0 : locate(seq, plan).index) : null;
    const repeat = this.list.repeat ?? (origin.kind === "playlist" ? playOrderOf(origin.playlistId, origin, lib).repeat : "off");
    // In a scene a playlist's own play order may keep the scene on it (Repeat all goes back to its first track).
    let inner: number | null = null;
    if (ended && at !== null && this.list.repeat === null && origin.kind === "scene") {
      const choice = afterEnd(plan, lib);
      if (choice && choice.origin.kind === "scene") inner = choice.origin.at;
    }
    // PLY-8: a scene that moves on when its music ends plays its list once.
    const loops = origin.kind === "scene" ? !this.deps.playsOnce?.(origin.scene) : repeat === "all";
    return { steps, at, inner, loops, keepAdded: repeat === "all" };
  }

  /** PLY-17: the Repeat that applies to what plays now: the room's, else the scene track's saved one, else its playlist's. */
  private shownRepeat(): Repeat {
    const cur = this.music.current;
    const lib = this.deps.library;
    if (!cur) return this.list.repeat ?? "off";
    const sceneKey = cur.origin.kind === "scene" ? keyOfPlace({ kind: "scene", ...cur.origin.scene }) : null;
    const fromPlan = this.list.now.kind === "plan";
    return shownRepeat(this.list.repeat, {
      savedOne: fromPlan && repeatsOneIn(lib.repeatOnes?.() ?? {}, sceneKey, cur.trackId),
      playlistRepeat: fromPlan && cur.playlistId ? playOrderOf(cur.playlistId, cur.origin, lib).repeat : null,
    });
  }

  private newItem(entry: ListEntry): ListItem {
    return { id: this.deps.newEntryId(), trackIds: entry.trackIds, playlistId: entry.playlistId, placeKey: entry.place ? keyOfPlace(entry.place) : null, name: entry.name };
  }

  private changeList(change: (list: RoomList) => RoomList): boolean {
    const before = this.list;
    this.list = change(before);
    this.deps.changed();
    return this.list !== before;
  }

  private startMusic(item: Playing, fadeSeconds: number, resume?: { at: number; elapsed: number }, fromSeconds?: number): void {
    const started = this.startLane("music", item, fadeSeconds, resume, fromSeconds);
    this.musicVoice = started;
    if (!started) {
      this.musicFailed(item);
      return;
    }
    // PLY-1: What played (an Undo puts back what played before; it does not play again).
    if (!resume) this.played = addPlayed(this.played, { trackId: item.trackId, at: (this.deps.now ?? Date.now)(), from: playedFrom(item) });
    const { voice } = started;
    voice.on("state", (state) => {
      if (state === "playing" && this.musicVoice === started) {
        this.failures = 0;
      }
    });
    voice.on("ended", () => {
      if (this.musicVoice === started) {
        this.musicVoice = null;
        this.forgetWhere(started);
        // PLY-8: a play step waiting for this track to end comes in now.
        const waiting = this.handOver;
        if (waiting) {
          this.handOver = null;
          waiting.start();
          return;
        }
        this.musicEnded(started.after);
      }
    });
    voice.on("error", () => {
      if (this.musicVoice === started) {
        this.musicVoice = null;
        this.musicFailed(item);
      }
    });
  }

  /**
   * The music's track ended by itself (`ended`), or could not play: the room's list decides (Repeat, Play next, the
   * plan, what was added). A track whose profile says "stop" ends there unless something was added after it.
   */
  private musicEnded(after: AfterEnd, ended = true) {
    const repeat = this.shownRepeat();
    const { list, pick } = pickNext(this.list, this.planView(ended), { ended, repeat });
    const stopsHere = ended && after !== "next" && pick?.from === "plan" && repeat !== "one";
    if (pick && !stopsHere) {
      this.list = list;
      this.startPick(pick, 0);
      this.deps.changed();
      return;
    }
    const cur = this.music.current;
    const lib = this.deps.library;
    this.music = { ...this.music, current: null };
    this.list = musicStopped(this.list);
    // PLY-8: a scene that moves on when its music ends starts the next one (its own next item came first, above).
    if (ended && cur?.origin.kind === "scene" && this.deps.playsOnce?.(cur.origin.scene)) {
      this.deps.changed();
      this.deps.planEnded?.(cur.origin.scene);
      return;
    }
    // SHW-3: Follow with plays when nothing was waiting (Play next, the queue and the plan came first, above).
    const follow = ended && cur ? lib.track(cur.trackId)?.follow : null;
    const item = follow ? (follow.kind === "playlist" ? playlistItem(follow.id, null, lib, { seed: this.deps.newSeed?.() }) : lib.track(follow.id) ? single(follow.id) : null) : null;
    if (item) {
      this.list = newPlan(this.list);
      this.startPlan(item, 0);
    }
    this.deps.changed();
  }

  /** Say so, and go on to the next track unless several in a row failed. */
  private musicFailed(item: Playing) {
    this.deps.error(`Unable to play track: ${this.titleOf(item.trackId)}`);
    this.failures++;
    if (this.failures >= MAX_FAILURES_IN_A_ROW) {
      this.failures = 0;
      this.music = { ...this.music, current: null };
      this.list = musicStopped(this.list);
      this.deps.changed();
      return;
    }
    // A track that cannot play is passed over, whatever the play order says (Repeat one would try it again).
    this.musicEnded("next", false);
  }

  // ---------- ambience ----------

  playAmbience(item: Playing, fadeSeconds: number, resume?: { at: number; elapsed: number }): void {
    this.ambienceItem = item;
    this.ambienceVoice = this.startLane("ambience", item, fadeSeconds, resume);
    if (!this.ambienceVoice) {
      this.ambienceItem = null;
      this.deps.error(`Unable to play ambience: ${this.titleOf(item.trackId)}`);
    } else {
      const started = this.ambienceVoice;
      // PLY-13: an ambience playlist's track that ends by itself goes on as the playlist's play order says.
      started.voice.on("ended", () => {
        if (this.ambienceVoice !== started || started.after !== "next") return;
        const next = afterTrackEnded(item, this.deps.library);
        if (next) this.playAmbience(next, 0);
        else {
          this.ambienceVoice = null;
          this.ambienceItem = null;
          this.deps.changed();
        }
      });
      started.voice.on("error", () => {
        if (this.ambienceVoice === started) {
          this.ambienceVoice = null;
          this.ambienceItem = null;
          this.deps.error(`Unable to play ambience: ${this.titleOf(item.trackId)}`);
          this.deps.changed();
        }
      });
    }
    this.deps.changed();
  }

  stepAmbience(direction: 1 | -1, fadeSeconds: number): boolean {
    const step = this.ambienceItem ? stepFrom(this.ambienceItem, direction, this.deps.library) : null;
    if (!step) {
      return false;
    }
    this.playAmbience(step, fadeSeconds);
    return true;
  }

  // ---------- effects and pads ----------

  playEffect(trackId: string, { padKey = null, loop = false, volume = 1 }: { padKey?: string | null; loop?: boolean; volume?: number } = {}): boolean {
    const found = this.trackAndMedia(trackId);
    if (!found) {
      this.deps.error(`Unable to play sound: ${this.titleOf(trackId)}`);
      return false;
    }
    const profile = laneProfile(found.track, "effects", [], this.deps.library.profileOverrides());
    // A pad's sound or an effect plays on its own: the track's choice, then the library's (no playlist).
    const voice = this.play("effects", found, loop ? { ...profile, after: "loop" } : profile, { volume, gainDb: this.gainOf(found.track, null) });
    const entry = { voice, trackId, padKey };
    this.effects.push(entry);
    voice.on("state", () => {
      if (voice.isFinal()) {
        this.effects.splice(this.effects.indexOf(entry), 1);
        this.deps.changed();
      }
    });
    voice.on("error", () => this.deps.error(`Unable to play sound: ${this.titleOf(trackId)}`));
    this.deps.changed();
    return true;
  }

  /** Whether that pad sounds here (not fading out). */
  padSounding(padKey: string): boolean {
    return this.effects.some((e) => e.padKey === padKey && e.voice.state !== "stopping");
  }

  /**
   * A pad press ("down") or let-go ("up"), with the sound the director picked for this press. BUG-20: a press on a
   * pad that sounds stops it, whatever its play mode: a toggle or hold pad with its own fade, others quickly.
   */
  firePad(padKey: string, pad: PadSound, phase: "down" | "up", trackId: string): void {
    const on = this.effects.filter((e) => e.padKey === padKey && e.voice.state !== "stopping");
    if (phase === "up") {
      if (pad.mode === "hold") {
        on.forEach((e) => void e.voice.stop(DEFAULT_FADES.holdRelease));
      }
      return;
    }
    if (on.length > 0) {
      const fade = pad.mode === "toggle" || pad.mode === "hold" ? pad.fadeMs / 1000 : DEFAULT_FADES.padStop;
      on.forEach((e) => void e.voice.stop(fade));
      this.deps.changed();
      return;
    }
    this.playEffect(trackId, { padKey, loop: pad.mode === "toggle" || pad.mode === "hold", volume: pad.volume });
  }

  /** BUG-20: Stop pads: every pad sound here fades out; effects played on their own go on. */
  stopPads(fadeSeconds: number): void {
    this.effects.filter((e) => e.padKey !== null).forEach((e) => void e.voice.stop(fadeSeconds));
    this.deps.changed();
  }

  // ---------- fades ----------

  fadeLane(lane: RoomLane, fadeSeconds: number): void {
    if (lane === "music") {
      this.cancelHandOver();
      if (this.musicVoice) this.rememberWhere(this.musicVoice);
      void this.musicVoice?.voice.stop(fadeSeconds);
      this.musicVoice = null;
      this.music = { ...this.music, current: null };
      // PLY-17: the room's Repeat ends with its music (Nik, 6 Nov 12:24).
      this.list = musicStopped(this.list);
    } else if (lane === "ambience") {
      void this.ambienceVoice?.voice.stop(fadeSeconds);
      this.ambienceVoice = null;
      this.ambienceItem = null;
    } else {
      [...this.effects].forEach((e) => void e.voice.stop(fadeSeconds));
    }
    this.deps.changed();
  }

  /** Every lane; at once when `fadeSeconds` is 0. The queue stays; the way back after a detour is forgotten. */
  stopAll(fadeSeconds: number): void {
    for (const lane of ["music", "ambience", "effects"] as const) {
      this.fadeLane(lane, fadeSeconds);
    }
    this.music = { ...this.music, returnTo: null };
  }

  // ---------- undo ----------

  snapshot(): RoomSnapshot {
    return {
      music: this.music,
      list: this.list,
      plan: this.plan,
      musicAt: this.musicVoice ? this.musicVoice.voice.position() : null,
      ambience: this.ambienceItem,
      ambienceAt: this.ambienceVoice ? this.ambienceVoice.voice.position() : null,
      takenAt: this.deps.engine.currentTime,
    };
  }

  /** Bring a snapshot back, each track where it would be had it kept playing. */
  restore(snapshot: RoomSnapshot, fadeSeconds: number): void {
    this.cancelHandOver();
    const elapsed = this.deps.engine.currentTime - snapshot.takenAt;
    this.music = snapshot.music;
    this.plan = snapshot.plan;
    if (snapshot.music.current) {
      this.startMusic(snapshot.music.current, fadeSeconds, snapshot.musicAt === null ? undefined : { at: snapshot.musicAt, elapsed });
    } else {
      this.fadeLane("music", fadeSeconds);
      this.music = snapshot.music;
    }
    this.list = snapshot.list;
    if (snapshot.ambience) {
      this.playAmbience(snapshot.ambience, fadeSeconds, snapshot.ambienceAt === null ? undefined : { at: snapshot.ambienceAt, elapsed });
    } else {
      this.fadeLane("ambience", fadeSeconds);
    }
    this.deps.changed();
  }

  // ---------- reporting ----------

  report(name: string): RoomReport {
    const list = this.music.current ? listUpNext(this.list, this.planView(false)) : [];
    const first = list[0];
    return {
      roomId: this.roomId,
      name,
      music: this.music.current ? this.playingReport(this.music.current, this.musicVoice) : null,
      upNext: first ? (first.kind === "plan" ? first.trackId : first.trackIds[0]) : null,
      queued: [...this.list.pn, ...this.list.q].map((item) => ({ entryId: item.id, trackId: item.trackIds[0] })),
      list,
      repeat: { chosen: this.list.repeat, shown: this.shownRepeat() },
      shuffle: this.list.shuffle !== null,
      canUndoList: this.list.undo !== null,
      ambience: this.ambienceItem ? this.playingReport(this.ambienceItem, this.ambienceVoice) : null,
      effects: this.effects.filter((e) => e.voice.state !== "stopping").map(({ trackId, padKey }) => ({ trackId, padKey })),
      played: this.played.map((p) => ({ ...p })),
    };
  }

  /** PLY-15: the library or a choice changed: what plays moves to its new gain, smoothly. */
  refreshGains(): void {
    const lib = this.deps.library;
    for (const lane of [this.musicVoice, this.ambienceVoice]) {
      if (lane && !lane.voice.isFinal()) lane.voice.setGainDb(this.gainOf(lib.track(lane.item.trackId), lane.item.playlistId));
    }
    for (const effect of this.effects) effect.voice.setGainDb(this.gainOf(lib.track(effect.trackId), null));
  }

  /** The room has gone: silence at once and forget everything. */
  dispose(): void {
    this.stopAll(0);
    this.music = EMPTY_LANE;
    this.list = emptyRoomList();
    this.plan = null;
  }

  // ---------- shared ----------

  /** Start `item` on a lane, crossfading from that lane's voice; null when it cannot play. */
  private startLane(lane: "music" | "ambience", item: Playing, fadeSeconds: number, resume?: { at: number; elapsed: number }, fromSeconds?: number): LaneVoice | null {
    const old = lane === "music" ? this.musicVoice : this.ambienceVoice;
    if (old) {
      this.rememberWhere(old);
      void old.voice.stop(Math.max(fadeSeconds, MIN_HANDOVER_SECONDS));
    }
    const found = this.trackAndMedia(item.trackId);
    if (!found) {
      return null;
    }
    const places = placesOf(item);
    const overrides = this.deps.library.profileOverrides();
    // PLY-4: a sting never loops; Ending "Fades out" fades unless a profile has a fade out of its own.
    const profile = roleProfile(found.track, laneProfile(found.track, lane, places, overrides), { fadeOutChosen: profileInputFor(found.track, places, overrides).fadeOut !== undefined });
    // Where it starts: as it was (Undo), from a marker (DAT-3), else where it stopped this evening (PLY-4 Pick up),
    // else the profile's Start at (0.5.1), else its Start.
    const picked = !resume && fromSeconds === undefined && found.track.resume ? this.deps.resumeAt?.get(found.track.id) : undefined;
    const byDefault = profile.startAtMs != null ? profile.startAtMs / 1000 : undefined;
    const startAt = resume ? positionAfter(profile, resume.at, resume.elapsed) : (fromSeconds ?? picked ?? byDefault);
    if (lane === "music") this.musicLevel = 1;
    const voice = this.play(lane, found, profile, {
      gainDb: this.gainOf(found.track, item.playlistId),
      crossfadeInSeconds: fadeSeconds,
      startAt,
    });
    return { voice, item, after: profile.after, profile };
  }

  /** PLY-4: where a "Pick up where it stopped" track was stopped (near its end: from the top next time). */
  private rememberWhere(lane: LaneVoice): void {
    const track = this.deps.library.track(lane.item.trackId);
    const resumeAt = this.deps.resumeAt;
    if (!track?.resume || !resumeAt || lane.voice.isFinal()) return;
    const at = lane.voice.position();
    if (at > 0 && at < lane.profile.endMs / 1000 - 2) resumeAt.set(track.id, at);
    else resumeAt.delete(track.id);
  }

  /** CR-5: a "Pick up where it stopped" track that played to its end starts from the top next time. */
  private forgetWhere(lane: LaneVoice): void {
    this.deps.resumeAt?.delete(lane.item.trackId);
  }

  private play(lane: RoomLane, found: { track: DomainTrack; media: MediaRequest }, profile: AudioProfile, options: VoiceOptions): Voice {
    return this.deps.engine.play({
      ...options,
      bus: lane,
      media: found.media,
      profile,
      id: `${this.roomId}/${lane}/${found.track.id}#${++this.plays}`,
      room: { id: this.roomId, input: this.deps.rooms.getRoomBus(this.roomId, lane) },
    });
  }

  private trackAndMedia(trackId: string): { track: DomainTrack; media: MediaRequest } | null {
    const track = this.deps.library.track(trackId);
    const media = track ? this.deps.library.media(track) : null;
    return track && media ? { track, media } : null;
  }

  private titleOf(trackId: string): string {
    const track = this.deps.library.track(trackId);
    return track ? track.title || track.metaTitle || track.fileName : "a track that is no longer in the library";
  }

  private playingReport(item: Playing, lane: LaneVoice | null): PlayingReport {
    const voice = lane && lane.item === item ? lane.voice : null;
    return {
      trackId: item.trackId,
      title: this.titleOf(item.trackId),
      origin: item.origin,
      playlistId: item.playlistId,
      positionSeconds: voice && voice.state !== "loading" ? voice.position() : null,
      state: voice ? voice.state : null,
      gainDb: voice ? voice.gainDb : this.gainOf(this.deps.library.track(item.trackId), item.playlistId),
      level: lane === this.musicVoice ? this.musicLevel : 1,
    };
  }
}

/** PLY-1: where a played track came from, so Play again plays it the same way (null: on its own). */
function playedFrom(item: Playing): PlayedFrom | null {
  if (item.origin.kind === "scene") return { scene: item.origin.scene, at: item.origin.at };
  if (item.origin.kind === "playlist") return item.origin.place ? { playlistId: item.origin.playlistId, place: item.origin.place } : { playlistId: item.origin.playlistId };
  return null;
}
