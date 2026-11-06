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
  shownRepeat,
  undoLast,
  upNext as listUpNext,
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
} from "../../../common/domain";
import type { PlaybackEngine } from "../engine";
import { laneProfile } from "../profile/trackProfile";
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
  /** The last add, removal or Clear added can be undone. */
  canUndoList: boolean;
  ambience: PlayingReport | null;
  /** Effects and pads sounding (not fading out). */
  effects: { trackId: string; padKey: string | null }[];
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

  constructor(
    readonly roomId: string,
    private readonly deps: RoomPlayerDeps,
  ) {}

  // ---------- music ----------

  /**
   * Play now, crossfading over `fadeSeconds`. A playlist or a scene's step is a new plan for the room (what was added
   * stays, its Repeat and skips go); a single track while music plays plays now and the list carries on after it.
   */
  playMusic(item: Playing, fadeSeconds: number): void {
    if (item.origin.kind === "single" && this.music.current) {
      const now = listPlayNow(this.list, this.newItem({ trackIds: [item.trackId], playlistId: item.playlistId, place: null, name: this.titleOf(item.trackId) }), this.planView(false));
      if (now.pick) {
        this.list = now.list;
        this.startPick(now.pick, fadeSeconds);
        return;
      }
    }
    this.list = newPlan(this.list);
    this.startPlan(item, fadeSeconds);
  }

  /** Play next (PLY-16): right after the current track. With nothing playing, `asPlan` plays at once. */
  queueMusic(item: Playing, fadeSeconds: number): void {
    this.addToList("next", { trackIds: [item.trackId], playlistId: item.playlistId, place: null, name: this.titleOf(item.trackId) }, item, fadeSeconds);
  }

  /** Play next or Add to queue (PLY-16). With nothing playing, `asPlan` plays at once as the room's plan. */
  addToList(how: "next" | "queue", entry: ListEntry, asPlan: Playing, fadeSeconds: number): "added" | "playing" {
    if (!this.music.current) {
      this.playMusic(asPlan, fadeSeconds);
      return "playing";
    }
    const item = this.newItem(entry);
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
      this.list = list;
      this.startPick(pick, fadeSeconds);
      return true;
    }
    // From something added, Previous goes back to where the plan was.
    if (this.list.now.kind !== "plan" && this.list.ret !== null && this.plan) {
      const at = this.list.ret;
      this.list = { ...this.list, now: { kind: "plan" }, ret: null, backToQueue: null };
      this.startPick({ from: "plan", at }, fadeSeconds);
      return true;
    }
    const { lane, play } = previous(this.music, this.deps.library);
    if (!play) {
      return false;
    }
    this.music = lane;
    this.plan = play;
    this.startMusic(play, fadeSeconds);
    return true;
  }

  startScene(ref: SceneRef, scene: DomainScene): void {
    const lib = this.deps.library;
    const seed = this.deps.newSeed?.();
    const first = sceneItem(ref, 0, lib, seed);
    // A new scene clears what was added to the room's list (Nik, 6 Nov 13:55); its Undo brings it back (snapshot).
    this.list = sceneStarted(this.list);
    this.music = { ...this.music, queued: [], returnTo: null };
    if (first) {
      this.startPlan(first, DEFAULT_FADES.sceneMusic);
    }
    const ambience = scene.ambience;
    // The scene's ambience playlist plays as its play order in this scene says (PLY-13).
    const item = ambience?.kind === "playlist" ? playlistItem(ambience.id, null, lib, { place: { kind: "scene", ...ref }, seed }) : ambience ? single(ambience.id) : null;
    if (item) {
      this.playAmbience(item, DEFAULT_FADES.sceneAmbience);
    } else if (!ambience) {
      this.fadeLane("ambience", DEFAULT_FADES.sceneAmbience);
    }
    this.deps.changed();
  }

  /** A plan item plays now (a new plan, or the plan's next step). */
  private startPlan(item: Playing, fadeSeconds: number): void {
    this.plan = item;
    this.music = { ...this.music, current: item, returnTo: null };
    this.startMusic(item, fadeSeconds);
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
    this.startMusic(item, fadeSeconds);
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
    return { steps, at, inner, loops: origin.kind === "scene" || repeat === "all", keepAdded: repeat === "all" };
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

  private startMusic(item: Playing, fadeSeconds: number, resume?: { at: number; elapsed: number }): void {
    const started = this.startLane("music", item, fadeSeconds, resume);
    this.musicVoice = started;
    if (!started) {
      this.musicFailed(item);
      return;
    }
    const { voice } = started;
    voice.on("state", (state) => {
      if (state === "playing" && this.musicVoice === started) {
        this.failures = 0;
      }
    });
    voice.on("ended", () => {
      if (this.musicVoice === started) {
        this.musicVoice = null;
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
    } else {
      this.music = { ...this.music, current: null };
      this.list = musicStopped(this.list);
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
      canUndoList: this.list.undo !== null,
      ambience: this.ambienceItem ? this.playingReport(this.ambienceItem, this.ambienceVoice) : null,
      effects: this.effects.filter((e) => e.voice.state !== "stopping").map(({ trackId, padKey }) => ({ trackId, padKey })),
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
  private startLane(lane: "music" | "ambience", item: Playing, fadeSeconds: number, resume?: { at: number; elapsed: number }): LaneVoice | null {
    const old = lane === "music" ? this.musicVoice : this.ambienceVoice;
    if (old) {
      void old.voice.stop(Math.max(fadeSeconds, MIN_HANDOVER_SECONDS));
    }
    const found = this.trackAndMedia(item.trackId);
    if (!found) {
      return null;
    }
    const profile = laneProfile(found.track, lane, placesOf(item), this.deps.library.profileOverrides());
    const voice = this.play(lane, found, profile, {
      gainDb: this.gainOf(found.track, item.playlistId),
      crossfadeInSeconds: fadeSeconds,
      startAt: resume ? positionAfter(profile, resume.at, resume.elapsed) : undefined,
    });
    return { voice, item, after: profile.after };
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
    };
  }
}
