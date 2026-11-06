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
import { DEFAULT_LIBRARY_NORMALISE, normalisedGainDb, type AfterEnd, type AudioProfile, type DomainScene, type DomainTrack } from "../../../common/domain";
import type { PlaybackEngine } from "../engine";
import { laneProfile } from "../profile/trackProfile";
import { positionAfter } from "../profile/position";
import type { RoomLane, RoomsAudio } from "../rooms.contract";
import type { MediaRequest } from "../sources/sourceLoader";
import type { Voice, VoiceOptions, VoiceState } from "../voice/voice";
import { DEFAULT_FADES } from "./actions";
import type { PadSound, SceneRef, ShowLibrary } from "./library";
import {
  advance,
  afterTrackEnded,
  EMPTY_LANE,
  MusicLane,
  Origin,
  placesOf,
  Playing,
  playlistItem,
  playNow,
  previous,
  queueNext,
  removeQueued,
  sceneItem,
  single,
  stepFrom,
  upNext,
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
  queued: { entryId: string; trackId: string }[];
  ambience: PlayingReport | null;
  /** Effects and pads sounding (not fading out). */
  effects: { trackId: string; padKey: string | null }[];
}

/** What Undo needs to bring a room's music and ambience back. */
export interface RoomSnapshot {
  music: MusicLane;
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

export class RoomPlayer {
  private music: MusicLane = EMPTY_LANE;
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

  /** Play now, crossfading over `fadeSeconds`. */
  playMusic(item: Playing, fadeSeconds: number): void {
    this.music = playNow(this.music, item, this.deps.library);
    this.startMusic(item, fadeSeconds);
  }

  /** Play next: after the current track. With nothing playing, it plays at once. */
  queueMusic(item: Playing, fadeSeconds: number): void {
    if (!this.music.current) {
      this.playMusic(item, fadeSeconds);
      return;
    }
    this.music = queueNext(this.music, { entryId: this.deps.newEntryId(), item });
    this.deps.changed();
  }

  removeQueued(entryId: string): boolean {
    const before = this.music;
    this.music = removeQueued(this.music, entryId);
    this.deps.changed();
    return this.music !== before;
  }

  /** Next (the queue, the way back, then the sequence) or Previous (the sequence). False when there is nowhere to go. */
  stepMusic(direction: 1 | -1, fadeSeconds: number): boolean {
    const lib = this.deps.library;
    const { lane, play } = direction === 1 ? advance(this.music, lib, { sequence: true }) : previous(this.music, lib);
    if (!play) {
      return false;
    }
    this.music = lane;
    this.startMusic(play, fadeSeconds);
    return true;
  }

  startScene(ref: SceneRef, scene: DomainScene): void {
    const lib = this.deps.library;
    const seed = this.deps.newSeed?.();
    const first = sceneItem(ref, 0, lib, seed);
    // A new scene starts with an empty queue (as the prototype's live view).
    this.music = { ...this.music, queued: [], returnTo: null };
    if (first) {
      this.playMusic(first, DEFAULT_FADES.sceneMusic);
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

  /** The music's track ended by itself (`ended`), or could not play: the queue, the way back, then the sequence. */
  private musicEnded(after: AfterEnd, ended = true) {
    const { lane, play } = advance(this.music, this.deps.library, { sequence: after === "next", ended });
    this.music = lane;
    if (play) {
      this.startMusic(play, 0);
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
    if (snapshot.music.current) {
      this.startMusic(snapshot.music.current, fadeSeconds, snapshot.musicAt === null ? undefined : { at: snapshot.musicAt, elapsed });
    } else {
      this.fadeLane("music", fadeSeconds);
      this.music = snapshot.music;
    }
    if (snapshot.ambience) {
      this.playAmbience(snapshot.ambience, fadeSeconds, snapshot.ambienceAt === null ? undefined : { at: snapshot.ambienceAt, elapsed });
    } else {
      this.fadeLane("ambience", fadeSeconds);
    }
    this.deps.changed();
  }

  // ---------- reporting ----------

  report(name: string): RoomReport {
    const lib = this.deps.library;
    return {
      roomId: this.roomId,
      name,
      music: this.music.current ? this.playingReport(this.music.current, this.musicVoice) : null,
      upNext: upNext(this.music, lib)?.trackId ?? null,
      queued: this.music.queued.map((q) => ({ entryId: q.entryId, trackId: q.item.trackId })),
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
