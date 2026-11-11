/**
 * LyreAudio: everything the new interface's screens can do with sound, behind
 * one interface, so no screen touches Web Audio. Matches the prototype's
 * playback calls (design/prototype/src/core.js: L.play, L.next/L.prev,
 * L.pauseLane, L.stopLane, L.fadeAll, L.stopAll, L.firePad, L.preview*,
 * L.startScene, L.upNext and the playback state the screens read).
 *
 * `EngineLyreAudio` runs it on the wave 2 parts: the show engine's Director
 * (scenes, profiles, queue, pads, rooms), the room mixer, RoomStreams (room
 * sound to Discord over the private player channel) and the PreviewPlayer
 * (the game master's headphones only). It is built with real browser parts by
 * `startLyreAudio` (browserLyreAudio.ts) and on the fake audio graph in tests
 * (testing/onFakes.ts).
 *
 * Where sound goes (docs/ARCHITECTURE.md, "Host wiring for wave 3"):
 * - On air: each room's mix goes to its bot only through RoomStreams. The new
 *   page is never tab-captured (permissions.ts, AudioCaptureManagerMain).
 * - BUG-19: what goes to the players is heard only through Discord. No room
 *   ever plays on this page's speakers (rooms reach them only through a gain
 *   of 0, which keeps the graph running), and
 *   the capture window keeps engine rooms off "This Computer". With no bot in
 *   a voice channel the table plays to nobody; the screens say so.
 * - Preview plays in an audio context of its own whose only way out is the
 *   capture window's preview player; it can never reach a room.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import {
  DEFAULT_LIBRARY_NORMALISE,
  normalisedGainDb,
  playlistTracks,
  profilePlacesFor,
  roleProfile,
  roomsFor,
  type AudioDevices,
  type AudioProfile,
  type Crossfade,
  type DomainLookup,
  type PlayedFrom,
  type DomainScene,
  type DomainTrack,
  type LibraryNormalise,
  type PlayOrder,
  type PlayOrderOverrides,
  type ProfileOverrides,
  type Repeat,
  type RepeatOnes,
  type RoomRepeat,
  type RoomTarget,
  type TrackOrders,
  type UpNextRef,
  type UsePlace,
} from "../../common/domain";
import type { GainLike, NodeLike } from "../../player/engine/audio/types";
import type { PlaybackEngine } from "../../player/engine/engine";
import {
  padPreview,
  playlistPreview,
  trackPreview,
  type PreviewKind,
  type PreviewPlayer,
  type PreviewState,
} from "../../player/engine/preview/previewPlayer";
import type { DeviceStatus, OutputDeviceChooser, OutputDeviceInfo } from "../../player/engine/preview/outputDevices";
import { DEFAULT_FADES, type CueAction, type CueOutcome, type TrackFrom } from "../../player/engine/queue/actions";
import { Director, padWithoutSound, type ListWhat } from "../../player/engine/queue/director";
import type { PadSound, SceneRef, ShowLibrary } from "../../player/engine/queue/library";
import { playOrderOf, type Origin } from "../../player/engine/queue/nowPlaying";
import type { Random } from "../../player/engine/queue/queue";
import type { PlayingReport, RoomReport } from "../../player/engine/queue/roomPlayer";
import type { RoomLane } from "../../player/engine/rooms.contract";
import { TABLE_ROOM, type RoomMixer } from "../../player/engine/rooms";
import { laneProfile, profileInputFor } from "../../player/engine/profile/trackProfile";
import type { MediaRequest } from "../../player/engine/sources/sourceLoader";
import type { Voice } from "../../player/engine/voice/voice";
import { StableRooms } from "./stableRooms";

export type { CueAction, CueOutcome, TrackFrom, SceneRef, Origin, RoomLane, OutputDeviceInfo, DeviceStatus, PreviewKind, ListWhat, UpNextRef };

// ---------- what the screens give LyreAudio ----------

/** A pad as LyreAudio plays it: its sounds and mode, and its name for the preview line. */
export interface LyrePad extends PadSound {
  label: string;
}

/**
 * The library as LyreAudio reads it: domain lookups (src/common/domain), the
 * per-playlist and per-scene audio profiles, where each track's file is, and
 * what each pad plays. Every call must answer at once (the engine reads it
 * while it plays), so the screens' data layer keeps what it has loaded and
 * answers from that. Read on every call, so changes are picked up.
 */
export interface LyreAudioLibrary extends DomainLookup {
  scene(ref: SceneRef): DomainScene | undefined;
  /** The ProfileOverrides provider: audio profiles keyed by placeKey, then track id. */
  profileOverrides(): ProfileOverrides;
  /** Where a track's audio is; null when its file is not known. */
  media(track: DomainTrack): MediaRequest | null;
  pad(boardId: string, padId: string): LyrePad | undefined;
  /** PLY-13: play order chosen in places (LyreApi playlists.playOrders), by place key then playlist id. */
  playOrders(): PlayOrderOverrides;
  /** PLY-15: the library's Normalise volume setting (LyreApi library.normaliseSettings). */
  normaliseSettings(): LibraryNormalise;
  /** ORG-13: a playlist's track order chosen in places (LyreApi playlists.trackOrders); optional for older hosts. */
  trackOrders?(): TrackOrders;
  /** PLY-17: Repeat one saved on scenes' tracks (repeatOnesOf the campaigns); optional for older hosts. */
  repeatOnes?(): RepeatOnes;
  /** PLY-8: Settings › Between tracks (LyreApi settings.get().crossfade); optional for older hosts. */
  crossfade?(): Crossfade;
  /** PLY-8: the scene after this one in its session, for a scene that moves on by itself; optional for older hosts. */
  nextScene?(ref: SceneRef): SceneRef | null;
}

// ---------- what the screens read ----------

/** One lane's track (music or ambience) in a room. Times are seconds in the file. */
export interface LaneNowPlaying {
  trackId: string;
  title: string;
  /** Where it came from: a scene step, a playlist step, or on its own. */
  origin: Origin;
  /** The playlist it plays through, for its audio profile; null when none. */
  playlistId: string | null;
  /** Seconds into the file; null while it is still loading. */
  position: number | null;
  /** Length of the file in seconds; null until known. */
  length: number | null;
  paused: boolean;
  loading: boolean;
  /**
   * UX-16, PLY-13: where it plays from: its scene, or the session or campaign list its playlist was played from;
   * null for a playlist on its own or a single track. The Now playing bar words it ("Scene: The abbey ruins …").
   */
  place: UsePlace | null;
  /** PLY-13: its playlist's play order where it plays (resolvePlayOrder); null when it is not from a playlist. */
  playOrder: PlayOrder | null;
  /**
   * PLY-15: the normalising gain it plays at, in dB (0: as it is: normalising is off there, or it is not measured
   * yet). normaliseHover words it for the Now playing bar and Live.
   */
  gainDb: number;
  /** PLY-8: the level a Fade step left the music at, 0 to 1 (1: as it plays; ambience is always 1). */
  level: number;
}

/** UX-16: what plays in the game master's headphones only (the Now playing bar's "Only you" row). */
export interface PreviewNowPlaying extends PreviewState {
  /** Seconds into the file; null while it loads. */
  position: number | null;
  /** Length of the file in seconds; null until known. */
  length: number | null;
  /** The headphone volume, 0 to 1 (kept from one preview to the next). */
  volume: number;
}

export interface RoomNowPlaying {
  /** A bot id, or "table" while no bot is in a voice channel. Use it as `{ room: roomId }`. */
  roomId: string;
  /** The voice channel's name ("Table" while there is none). */
  name: string;
  /** UX-16: the room's volume, 0 to 1: its mix level, the slider in the Now playing bar, Live and Outputs. */
  volume: number;
  music: LaneNowPlaying | null;
  ambience: LaneNowPlaying | null;
  /** The track Next would play in the music lane. */
  upNext: { trackId: string; title: string } | null;
  /** What was added to the room's list (Play next items, then Add to queue items); `entryId` for removeQueued. */
  queued: { entryId: string; trackId: string; title: string }[];
  /**
   * PLY-16: Up next, top to bottom: Play next items ("playNext"), the plan's tracks still to come ("planned"), then
   * what was added with Add to queue ("added"). Each can be taken out with removeFromUpNext(entry.ref). For this
   * evening only; nothing is saved.
   */
  upNextList: UpNextEntryNow[];
  /**
   * PLY-17: the room's Repeat for what plays now: `chosen` is the one pressed (null until then; never saved, back to
   * null when the music stops or a new plan starts), `shown` the one that applies (the chosen one, else the scene
   * track's saved Repeat one, else its playlist's play order there, else off).
   */
  repeat: { chosen: RoomRepeat; shown: Repeat };
  /** 0.5.1: the room's Shuffle is on, for what plays now (toggleShuffle). */
  shuffle: boolean;
  /** The last add, removal or Clear added in this room can be undone (undoUpNext). */
  canUndoUpNext: boolean;
  /** Effects and pads sounding. `padKey` is "<board id>/<pad id>" for a pad. */
  effects: { trackId: string; title: string; padKey: string | null }[];
  /**
   * PLY-1: What played in this room this evening, newest first (kept while the app runs, never saved). Play again is
   * playTrack(trackId, { from }); Play next is playNext({ kind: "track", trackId, from }).
   */
  played: { trackId: string; title: string; at: number; from: PlayedFrom | null }[];
}

/** One entry of a room's Up next (RoomNowPlaying.upNextList). */
export interface UpNextEntryNow {
  /** What × passes to removeFromUpNext. */
  ref: UpNextRef;
  kind: "playNext" | "planned" | "added";
  /** The tracks still to play of it (one for a track; a playlist's rest in its order). */
  trackIds: string[];
  /** A playlist's name, or the track's name where it was added from (DAT-14: its scene's name for it). */
  title: string;
  playlistId: string | null;
  /** The rest of an added playlist that plays now. */
  rest: boolean;
}

/**
 * UX-16: where each room's music and ambience and the preview are in their files, in seconds; null while one loads or
 * nothing plays there. Rooms by the ids NowPlaying uses. Read by the Now playing bar's and Live's time lines, which
 * redraw on their own (LyreAudioProvider's usePlayPosition), not the whole screen.
 */
export interface PlayPositions {
  rooms: Readonly<Record<string, { music: number | null; ambience: number | null }>>;
  preview: number | null;
}

/** How often positions move on while something plays (Nik, 0.5.0: the bar's time must follow the sound). */
export const POSITION_TICK_MS = 250;

export interface NowPlaying {
  /** One entry per room, the first room (where scenes play) first. */
  rooms: RoomNowPlaying[];
  /** A bot is in a voice channel: rooms are heard on Discord. While false nobody hears them (BUG-19). */
  broadcasting: boolean;
  /** What plays in the game master's headphones only. Key: track id, "pl:<id>" or "pad:<board>/<pad>". */
  preview: PreviewNowPlaying | null;
  /** The preview's sound device and, when it is not the chosen one, why. */
  previewDevice: DeviceStatus | null;
  /** Undo of the last scene start is possible. */
  canUndo: boolean;
  /** PRV-2: which ear the preview plays in ("both" unless one headset is split, setAudioDevices). */
  previewEar: "both" | "left" | "right";
}

export interface LyreAudioEvents {
  /** A sentence for the screen reader's live region ("Music: Tavern"). */
  announce: (text: string) => void;
  /** Something did not work, in plain words for a toast. Every failed call is reported here once. */
  error: (message: string) => void;
  /** Where the preview is in its file, about twenty times a second while it plays (the Audio profile's playhead). */
  "preview-position": (at: PreviewPosition) => void;
  /** A preview could not play: its key and why (a quiet preview announces nothing, so its screen hears it here). */
  "preview-failed": (at: { key: string; message: string }) => void;
  /** PLY-8: a step shows a pad board (Live shows it). */
  "show-board": (at: { boardId: string; scene: SceneRef | null }) => void;
  /** PLY-8: a scene started: pressed, by a step, or moving on by itself ("moved-on": Live follows it). */
  "scene-started": (at: { scene: SceneRef; by: "press" | "step" | "moved-on" }) => void;
}

/** The preview's place in its file: its key (a track's id, "pl:…", "pad:…") and the position in milliseconds. */
export interface PreviewPosition {
  key: string;
  positionMs: number;
}

/** How the Audio profile screen previews a track: from a point, with the profile it shows, saying nothing itself. */
export interface PreviewTrackOptions {
  /** Start this far into the file (default: the profile's Start, or 0). */
  startAtMs?: number;
  /**
   * Play as this profile says (Start to End, fades, loop). None: as the track's audio profile where it is previewed
   * (`place`, then `playlistId`, then the track's own), as the players would hear it from there.
   */
  profile?: AudioProfile;
  /** The scene (or session's list) it is previewed in, whose own audio settings for it apply. */
  place?: UsePlace;
  /** Announce nothing: the screen says what happens. */
  quiet?: boolean;
  /** UX-16: where the game master started it, in words for the Now playing bar ("the session planner"). */
  from?: string;
  /**
   * PLY-15: the playlist it is previewed from (a track row on a playlist's page, a playlist's track in a scene), so
   * its normalising choice applies, as it would on air from there.
   */
  playlistId?: string;
  /**
   * DAT-8, security review w4 Should 5: play this file's address as the track (Find missing files: the file it found,
   * before relinking). The main process prepares it only while that relink is planned.
   */
  file?: string;
}

/** Where a preview was started from (the Now playing bar's "Previewed from …"). */
export interface PreviewFrom {
  from?: string;
  /** previewPlaylist: the scene (or session's list) it is previewed in, whose audio settings for its first track apply. */
  place?: UsePlace;
}

/** The first room: where sound goes when a screen names no room, and where scenes always play. */
export const FIRST_ROOM: RoomTarget = { room: TABLE_ROOM };

export type MusicOrAmbience = "music" | "ambience";

export interface PlayOptions {
  /** Default: the first room. */
  target?: RoomTarget;
  /** Music: "now" crossfades (default), "next" queues after the current track. */
  when?: "now" | "next";
  /** The scene step or playlist it was picked from, for its audio profile and for Next. */
  from?: TrackFrom;
  /** Crossfade in milliseconds (default 3000). */
  fadeMs?: number;
  /** PLY-13: the session or campaign list a playlist is played from, so its play order (and audio settings) there apply. */
  place?: UsePlace;
  /** DAT-3 Play on air from a marker: where in the file it starts (default: its Start, or where it stopped, PLY-4). */
  fromMs?: number;
}

/**
 * Every call returns what happened ({ ok } or a plain message). A failure is
 * also sent once as an "error" event, so a single toast listener covers every
 * screen; use the return value only to decide what the screen does next.
 */
export interface LyreAudio {
  // ----- on air -----
  playTrack(trackId: string, options?: PlayOptions): CueOutcome;
  playPlaylist(playlistId: string, options?: Omit<PlayOptions, "from">): CueOutcome;
  /** Always in the first room (sceneRoom). */
  startScene(scene: SceneRef): CueOutcome;
  next(lane: MusicOrAmbience, target?: RoomTarget): CueOutcome;
  previous(lane: MusicOrAmbience, target?: RoomTarget): CueOutcome;
  /** Pause the lane, or carry on if it is paused (the prototype's pause button). */
  togglePause(lane: MusicOrAmbience, target?: RoomTarget): CueOutcome;
  /** Fade one lane out (default 5 s; effects 0.8 s). */
  stopLane(lane: RoomLane, options?: { target?: RoomTarget; fadeMs?: number }): CueOutcome;
  /** Fade everything out in every room (default 5 s). */
  fadeAll(fadeMs?: number): CueOutcome;
  /** Silence every room at once. */
  stopAll(): CueOutcome;
  /** UX-16: a room's volume (or every room's), 0 to 1, kept for that room while the app runs. */
  setRoomVolume(target: RoomTarget, volume: number): CueOutcome;
  /** A pad press ("down", default) or let-go ("up", for hold pads). A press on a pad that sounds stops it (BUG-20). */
  firePad(boardId: string, padId: string, phase?: "down" | "up", target?: RoomTarget): CueOutcome;
  /** BUG-20: Live's Stop pads: every pad sound in every room fades out quickly; music, ambience and other effects go on. */
  stopPads(): CueOutcome;
  removeQueued(entryId: string, target?: RoomTarget): CueOutcome;
  undoSceneStart(): CueOutcome;

  // ----- round 6: each room's running list and its Repeat (PLY-16, PLY-17), for the evening, never saved -----
  /** Play next: right after the current track (the newest first). A silent room plays it at once. Default: the first room. */
  playNext(what: ListWhat, options?: { target?: RoomTarget }): CueOutcome;
  /** Add to queue: after the bottom of the room's list, in the order added. A silent room plays it at once. */
  addToQueue(what: ListWhat, options?: { target?: RoomTarget }): CueOutcome;
  /** × in Up next: a planned track is skipped this evening, an added item goes. */
  removeFromUpNext(ref: UpNextRef, target?: RoomTarget): CueOutcome;
  /** Clear added: Play next and the queue empty. */
  clearAdded(target?: RoomTarget): CueOutcome;
  /** Undo (Ctrl+Z, the 8-second strip) of the last add, removal or Clear added in that room. */
  undoUpNext(target?: RoomTarget): CueOutcome;
  /** The room's Repeat (null: back to what the music does by itself). */
  setRepeat(repeat: RoomRepeat, target?: RoomTarget): CueOutcome;
  /** Repeat pressed: off, all, one in turn from what it shows. */
  cycleRepeat(target?: RoomTarget): CueOutcome;
  /** 0.5.1: the room's Shuffle on or off, for what plays now (never saved; off again when its music stops). */
  toggleShuffle(target?: RoomTarget): CueOutcome;
  /**
   * PLY-17: the screen saved Repeat one on (or off) for that scene's track (LyreApi sessions.setRepeatOne): a Repeat
   * chosen in a room playing it gives way, so the saved one shows at once. Call setLibrary with the reloaded data too.
   */
  savedRepeatOneChanged(scene: SceneRef, trackId: string): void;
  /** Live loaded another session: every room's list is cleared; what plays goes on. */
  sessionLoaded(): void;
  /** Any cue action (hotkeys, cues, later the remote API). */
  run(action: CueAction): CueOutcome;

  // ----- preview: the game master's headphones only, never on air -----
  /**
   * Start previewing, or stop if this one is previewing (the Preview button). Given a point, a profile (the Audio
   * profile screen) or another file (Find missing files) it always starts, from that point and with that profile.
   */
  previewTrack(trackId: string, options?: PreviewTrackOptions): CueOutcome;
  previewPlaylist(playlistId: string, options?: PreviewFrom): CueOutcome;
  previewPad(boardId: string, padId: string, options?: PreviewFrom): CueOutcome;
  /**
   * SFX-12 Try pads: a press ("down", default) or let-go ("up") played as the pad plays in Live, but in the
   * headphones only, as the preview (key "pad:<board>/<pad>"): a toggle loop starts, a hold pad loops while held, a
   * one-shot or restart pad plays once; as in Live, a press on a pad that sounds stops it (BUG-20).
   */
  tryPad(boardId: string, padId: string, phase?: "down" | "up", options?: PreviewFrom): CueOutcome;
  stopPreview(): void;
  /** UX-16: pause the preview, or carry on if it is paused. */
  togglePreviewPause(): CueOutcome;
  /** UX-16: the headphone volume, 0 to 1, kept for the next preview too. */
  setPreviewVolume(volume: number): void;
  isPreviewing(key: string): boolean;
  /**
   * w4-outputs: the Outputs screen's Test: a short chime in one room (a bot id) only, on its effects lane, so the
   * game master can tell which room is which. Not the preview, not the other rooms.
   */
  testChime(roomId: string): CueOutcome;
  /**
   * OUT-10 (w6-rooms): how loud a room (a bot id, or "table") is right now, 0 to 1: the peak of what it sends to
   * Discord over the last moment; 0 when silent or not there. The Rooms screen's meters read it a few times a second.
   */
  roomLevel(roomId: string): number;
  /** Sound devices to choose from for the preview (the default first). */
  previewDevices(): Promise<OutputDeviceInfo[]>;
  /** Choose and remember the preview's device ("" for the default). */
  choosePreviewDevice(deviceId: string): Promise<DeviceStatus>;
  /**
   * PRV-2: Settings › Headphones and speakers (LyreApi settings.get().devices): the preview's device and, with one
   * headset split, the ear the preview plays in. On air is heard through Discord (BUG-19); `airDevice` is kept for a
   * later monitor and not used here.
   */
  setAudioDevices(devices: AudioDevices): Promise<DeviceStatus | null>;

  // ----- state -----
  /** Read the library from here on (the screens' data layer loaded or reloaded). */
  setLibrary(library: LyreAudioLibrary): void;
  /** The same object until something changes (fit for React's useSyncExternalStore). */
  getNowPlaying(): NowPlaying;
  /** Called after each change, and about once a second while anything plays. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** The positions now: the same object until they move (fit for useSyncExternalStore). */
  getPositions(): PlayPositions;
  /**
   * Called every POSITION_TICK_MS while music, ambience or the preview plays (not paused, not stopped), and after each
   * change. Returns an unsubscribe.
   */
  subscribePositions(listener: () => void): () => void;
  on<E extends keyof LyreAudioEvents>(event: E, listener: LyreAudioEvents[E]): unknown;
  off<E extends keyof LyreAudioEvents>(event: E, listener: LyreAudioEvents[E]): unknown;

  dispose(): Promise<void>;
}

/** True when that pad sounds (in `roomId` if given, else in any room). */
export function padIsOn(state: NowPlaying, boardId: string, padId: string, roomId?: string): boolean {
  const key = `${boardId}/${padId}`;
  return state.rooms.some((room) => (roomId === undefined || room.roomId === roomId) && room.effects.some((e) => e.padKey === key));
}

/** A track's name as the game master sees it. */
export function trackTitle(track: DomainTrack | undefined): string {
  return track ? track.title || track.metaTitle || track.fileName : "a track that is no longer in the library";
}

// ---------- the implementation ----------

/** What tells LyreAudio that a broadcast runs (RoomStreams). */
export interface BroadcastSignal {
  readonly broadcasting: boolean;
  on(event: "broadcast", listener: (active: boolean) => void): unknown;
  off(event: "broadcast", listener: (active: boolean) => void): unknown;
}

export interface LyreAudioParts {
  engine: PlaybackEngine;
  mixer: RoomMixer;
  /** RoomStreams: sends the rooms to Discord and says when a broadcast runs. */
  streams: BroadcastSignal;
  /**
   * BUG-19: a silent node in the engine's context (a gain of 0 into its speakers). Every room's mix is joined to it,
   * because Chromium runs only the parts of an audio graph that lead somewhere: with no bot in a voice channel
   * nothing taps the rooms, and without it what plays there would stand still at 0:00. It is never heard.
   */
  keepAlive?: NodeLike;
  preview: PreviewPlayer;
  /** The preview's device choice, already attached to the preview output. */
  previewDevices?: OutputDeviceChooser;
  library: LyreAudioLibrary;
  /** Keeps the playing and next tracks in memory (ReadAhead). */
  readAhead?: { want(requests: readonly MediaRequest[]): void };
  /** w4-outputs: plays the Test chime into a room's bus (about 1.5 s, then it ends by itself). */
  chime?: (into: GainLike) => void;
  random?: Random;
  /** Called by dispose after everything is stopped: close audio contexts, the channel. */
  onDispose?: () => Promise<void> | void;
  /** The volume a room starts at, 0 to 1 (default 1; the app starts rooms at ROOM_START_VOLUME). */
  startRoomVolume?: number;
  /** PRV-2: puts the preview in one ear (or both) on its way to the game master's device; none: it plays in both. */
  setPreviewEar?: (ear: "both" | "left" | "right") => void;
  /** PLY-4: where Pick up tracks stopped, kept across restarts (resumePositions.ts); none: for the evening only. */
  resumePositions?: Map<string, number>;
  /** OUT-10: listens to a room's mix (an AnalyserNode in the app) for its level meter; none: every level is 0. */
  meter?: (output: GainLike) => RoomMeter;
}

/** OUT-10: one room's level meter. */
export interface RoomMeter {
  /** The peak of the last moment, 0 to 1 (more when it clips; roomLevel caps it). */
  level(): number;
  dispose(): void;
}

/**
 * UX-16: the volume rooms start at in the app: 85, as the design shows a new room, so a quiet room can still be
 * turned up.
 */
export const ROOM_START_VOLUME = 0.85;

const OK: CueOutcome = { ok: true };
const LANE_LABEL: Record<MusicOrAmbience, string> = { music: "Music", ambience: "Ambience" };

export class EngineLyreAudio extends TypedEmitter<LyreAudioEvents> implements LyreAudio {
  private readonly parts: LyreAudioParts;
  private library: LyreAudioLibrary;
  private readonly rooms: StableRooms;
  private readonly director: Director;
  /** Called on every change (named so as not to hide EventEmitter's own `listeners`). */
  private readonly subscribers = new Set<() => void>();
  private snapshot: NowPlaying | null = null;
  private notifyQueued = false;
  private stopProgress: (() => void) | null = null;
  private positions: PlayPositions | null = null;
  private readonly positionSubscribers = new Set<() => void>();
  private positionTimer: unknown = null;
  /** The room outputs joined to the keep-alive node now. */
  private readonly kept = new Set<GainLike>();
  /** OUT-10: a meter per room output, made when a screen first asks for that room's level. */
  private readonly meters = new Map<GainLike, RoomMeter>();
  private wantedKey = "";
  /** PRV-2: the ear the preview plays in. */
  /** PRV-2: the ear chosen for the preview when one headset is split; null when it is not split. */
  private splitEar: "left" | "right" | null = null;
  /** The ear the preview plays in now (sent to the preview's output when it changes). */
  private previewEar: "both" | "left" | "right" = "both";
  private disposed = false;
  /** Each room's volume by its real id (a bot id, or "table"), kept while the app runs. */
  private readonly roomVolumes = new Map<string, number>();
  private readonly cleanups: (() => void)[] = [];

  constructor(parts: LyreAudioParts) {
    super();
    this.parts = parts;
    this.library = parts.library;
    this.rooms = new StableRooms(parts.mixer);
    // Reads `this.library` on every call, so setLibrary takes effect at once.
    const library: ShowLibrary = {
      track: (id) => this.library.track(id),
      playlist: (id) => this.library.playlist(id),
      tracks: () => this.library.tracks(),
      scene: (ref) => this.library.scene(ref),
      profileOverrides: () => this.library.profileOverrides(),
      media: (track) => this.library.media(track),
      pad: (boardId, padId) => this.library.pad(boardId, padId),
      playOrders: () => this.library.playOrders(),
      normaliseSettings: () => this.library.normaliseSettings(),
      trackOrders: () => this.library.trackOrders?.() ?? {},
      repeatOnes: () => this.library.repeatOnes?.() ?? {},
      crossfade: () => this.library.crossfade?.() ?? { ms: DEFAULT_FADES.crossfade * 1000, curve: "even" },
      nextScene: (ref) => this.library.nextScene?.(ref) ?? null,
    };
    this.director = new Director({ engine: parts.engine, rooms: this.rooms, library, random: parts.random, resumeAt: parts.resumePositions });

    const onChange = () => this.changed();
    const onDirectorError = (message: string) => this.emit("error", message);
    const onRooms = () => {
      this.applyRoomVolumes();
      this.keepRoomsRunning();
      this.changed();
    };
    const onBroadcast = () => this.changed();
    const onVoice = () => this.changed();
    const onPreview = (_state: PreviewState | null, announcement: string) => {
      if (announcement) this.emit("announce", announcement);
      this.changed();
    };
    const onPreviewPosition = (key: string, seconds: number) => this.emit("preview-position", { key, positionMs: seconds * 1000 });
    const onPreviewFailed = (key: string, message: string) => this.emit("preview-failed", { key, message });
    const onDevice = (role: string, status: DeviceStatus) => {
      if (role === "preview" && status.message) {
        this.emit("announce", status.message);
      }
      this.changed();
    };
    this.director.on("change", onChange);
    this.director.on("error", onDirectorError);
    this.director.on("show-board", (at) => this.emit("show-board", at));
    this.director.on("scene-started", (at) => {
      if (at.by !== "press") this.emit("announce", `Scene: ${this.library.scene(at.scene)?.name ?? ""}`);
      this.emit("scene-started", at);
    });
    parts.mixer.on("rooms", onRooms);
    parts.streams.on("broadcast", onBroadcast);
    parts.engine.on("voice", onVoice);
    parts.preview.on("change", onPreview);
    parts.preview.on("position", onPreviewPosition);
    parts.preview.on("failed", onPreviewFailed);
    parts.previewDevices?.on("status", onDevice);
    this.cleanups.push(
      () => parts.mixer.off("rooms", onRooms),
      () => parts.streams.off("broadcast", onBroadcast),
      () => parts.engine.off("voice", onVoice),
      () => parts.preview.off("change", onPreview),
      () => parts.preview.off("position", onPreviewPosition),
      () => parts.preview.off("failed", onPreviewFailed),
      () => parts.previewDevices?.off("status", onDevice),
    );
    this.applyRoomVolumes();
    this.keepRoomsRunning();
  }

  /** Read from another library from now on (the data layer reloaded). */
  setLibrary(library: LyreAudioLibrary): void {
    this.library = library;
    // PLY-15: a changed setting, choice or measurement moves what plays, and the preview, to its new gain.
    this.director.libraryChanged();
    const previewing = this.parts.preview.current();
    if (previewing) this.parts.preview.setGainDb(this.previewGain(previewing.trackId, previewing.kind === "pad" ? null : previewing.playlistId));
    this.changed();
  }

  // ---------- on air ----------

  playTrack(trackId: string, options: PlayOptions = {}): CueOutcome {
    const target = options.target ?? FIRST_ROOM;
    const outcome = this.perform({ type: "playTrack", trackId, target, when: options.when, from: options.from, fadeMs: options.fadeMs, fromMs: options.fromMs });
    if (outcome.ok) {
      const track = this.library.track(trackId);
      const what = track?.kind === "fx" ? "Effect" : track?.kind === "amb" ? "Ambience" : options.when === "next" ? "Plays next" : "Music";
      this.emit("announce", `${what}${this.inRoom(target)}: ${trackTitle(track)}`);
    }
    return outcome;
  }

  playPlaylist(playlistId: string, options: Omit<PlayOptions, "from"> = {}): CueOutcome {
    const target = options.target ?? FIRST_ROOM;
    const outcome = this.perform({ type: "playPlaylist", playlistId, target, when: options.when, fadeMs: options.fadeMs, place: options.place });
    if (outcome.ok) {
      const playlist = this.library.playlist(playlistId);
      const what = playlist?.lane === "fx" ? "Effect" : playlist?.lane === "amb" ? "Ambience" : options.when === "next" ? "Plays next" : "Music";
      this.emit("announce", `${what}${this.inRoom(target)}: ${playlist?.name ?? ""}`);
    }
    return outcome;
  }

  startScene(scene: SceneRef): CueOutcome {
    const outcome = this.perform({ type: "startScene", scene });
    if (outcome.ok) {
      this.emit("announce", `Scene: ${this.library.scene(scene)?.name ?? ""}`);
    }
    return outcome;
  }

  next(lane: MusicOrAmbience, target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.step("next", lane, target);
  }

  previous(lane: MusicOrAmbience, target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.step("previous", lane, target);
  }

  togglePause(lane: MusicOrAmbience, target: RoomTarget = FIRST_ROOM): CueOutcome {
    const voices = this.targetRooms(target).flatMap((roomId) => {
      const voice = this.laneVoice(roomId, lane);
      return voice ? [voice] : [];
    });
    if (voices.length === 0) {
      return this.fail(lane === "music" ? "No music is playing." : "No ambience is playing.");
    }
    // Any of them playing: pause them all; else carry on.
    if (voices.some((voice) => voice.state === "playing")) {
      voices.forEach((voice) => voice.pause());
    } else {
      voices.forEach((voice) => voice.resume());
    }
    this.changed();
    return OK;
  }

  stopLane(lane: RoomLane, options: { target?: RoomTarget; fadeMs?: number } = {}): CueOutcome {
    return this.perform({ type: "fadeLane", lane, target: options.target ?? FIRST_ROOM, fadeMs: options.fadeMs });
  }

  fadeAll(fadeMs?: number): CueOutcome {
    const outcome = this.perform({ type: "fadeAll", fadeMs });
    if (outcome.ok) {
      this.emit("announce", "Fading everything out");
    }
    return outcome;
  }

  stopAll(): CueOutcome {
    const outcome = this.perform({ type: "stopAll" });
    if (outcome.ok) {
      this.emit("announce", "Everything stopped");
    }
    return outcome;
  }

  setRoomVolume(target: RoomTarget, volume: number): CueOutcome {
    if (!Number.isFinite(volume)) return this.fail("That volume is not a number from 0 to 100.");
    const level = Math.max(0, Math.min(1, volume));
    const ids = target === "all" ? this.realRoomIds() : [this.rooms.toReal(roomsFor(this.rooms.target(target), [...this.rooms.rooms()])[0])];
    for (const id of ids) this.roomVolumes.set(id, level);
    this.applyRoomVolumes();
    this.changed();
    return OK;
  }

  firePad(boardId: string, padId: string, phase: "down" | "up" = "down", target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.perform({ type: "firePad", boardId, padId, phase, target });
  }

  stopPads(): CueOutcome {
    const outcome = this.perform({ type: "stopPads" });
    if (outcome.ok) {
      this.emit("announce", "Pads stopped");
    }
    return outcome;
  }

  removeQueued(entryId: string, target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.perform({ type: "removeQueued", entryId, target });
  }

  playNext(what: ListWhat, options: { target?: RoomTarget } = {}): CueOutcome {
    return this.addToList("next", what, options.target ?? FIRST_ROOM);
  }

  addToQueue(what: ListWhat, options: { target?: RoomTarget } = {}): CueOutcome {
    return this.addToList("queue", what, options.target ?? FIRST_ROOM);
  }

  removeFromUpNext(ref: UpNextRef, target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.listCall(() => this.director.removeFromList(ref, this.rooms.target(target)));
  }

  clearAdded(target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.listCall(() => this.director.clearList(this.rooms.target(target)));
  }

  undoUpNext(target: RoomTarget = FIRST_ROOM): CueOutcome {
    return this.listCall(() => this.director.undoList(this.rooms.target(target)));
  }

  setRepeat(repeat: RoomRepeat, target: RoomTarget = FIRST_ROOM): CueOutcome {
    if (repeat !== null && !["off", "all", "one"].includes(repeat)) return this.fail("Repeat is off, all or one.");
    return this.listCall(() => this.director.setRepeat(repeat, this.rooms.target(target)));
  }

  cycleRepeat(target: RoomTarget = FIRST_ROOM): CueOutcome {
    const outcome = this.listCall(() => this.director.cycleRepeat(this.rooms.target(target)));
    if (outcome.ok) {
      const shown = this.director.shownRepeat(this.targetRooms(target)[0]);
      this.emit("announce", `Repeat: ${shown}, for what plays now${this.inRoom(target)}`);
    }
    return outcome;
  }

  toggleShuffle(target: RoomTarget = FIRST_ROOM): CueOutcome {
    const outcome = this.listCall(() => this.director.toggleShuffle(this.rooms.target(target)));
    if (outcome.ok) {
      const on = this.director.report().find((room) => room.roomId === this.targetRooms(target)[0])?.shuffle;
      this.emit("announce", `Shuffle ${on ? "on" : "off"}, for what plays now${this.inRoom(target)}`);
    }
    return outcome;
  }

  savedRepeatOneChanged(scene: SceneRef, trackId: string): void {
    if (!this.disposed) this.director.savedRepeatOneChanged(scene, trackId);
  }

  sessionLoaded(): void {
    if (!this.disposed) this.director.sessionLoaded();
  }

  private addToList(how: "next" | "queue", what: ListWhat, target: RoomTarget): CueOutcome {
    const outcome = this.listCall(() => this.director.addToList(how, what, this.rooms.target(target)));
    if (outcome.ok) {
      const name = what.name ?? (what.kind === "track" ? trackTitle(this.library.track(what.trackId)) : (this.library.playlist(what.playlistId)?.name ?? ""));
      this.emit("announce", `${how === "next" ? "Plays next" : "Added to the queue"}${this.inRoom(target)}: ${name}`);
    }
    return outcome;
  }

  private listCall(call: () => CueOutcome): CueOutcome {
    if (this.disposed) return this.fail("Lyre's sound has stopped. Reopen the Lyre tab.");
    const outcome = call();
    if ("message" in outcome && outcome.message) this.emit("error", outcome.message);
    return outcome;
  }

  undoSceneStart(): CueOutcome {
    const outcome = this.perform({ type: "undoSceneStart" });
    if (outcome.ok) {
      this.emit("announce", "Scene change undone");
    }
    return outcome;
  }

  run(action: CueAction): CueOutcome {
    return this.perform(action);
  }

  // ---------- preview ----------

  previewTrack(trackId: string, options?: PreviewTrackOptions): CueOutcome {
    const preview = this.parts.preview;
    // Where it was started from or the playlist it is in (every screen passes `from`) is no reason to start again:
    // only a point, a profile or another file is (Nik, 0.5.0: Stop preview started the track again).
    const startsAnew = options?.startAtMs !== undefined || options?.profile !== undefined || options?.file !== undefined;
    if (!startsAnew && preview.isPreviewing(trackId)) {
      preview.stop();
      return OK;
    }
    const track = this.library.track(trackId);
    if (!track) {
      return this.fail("That track is no longer in the library.");
    }
    // A file found for the track is not the track's own: no track id, so nothing cached for the track is used.
    const media = options?.file ? { url: options.file } : this.library.media(track);
    if (!media) {
      return this.fail(`Unable to preview: ${trackTitle(track)}`);
    }
    const gainDb = this.previewGain(track.id, options?.playlistId ?? null);
    const profile = options?.profile ?? this.previewProfile(track, options?.place ?? null, options?.playlistId ?? null);
    const voice = { startAt: options?.startAtMs === undefined ? undefined : options.startAtMs / 1000, profile, gainDb };
    preview.play({ ...trackPreview(track, media), playlistId: options?.playlistId ?? null, options: voice, quiet: options?.quiet, from: options?.from ?? null });
    return OK;
  }

  previewPlaylist(playlistId: string, options: PreviewFrom = {}): CueOutcome {
    const preview = this.parts.preview;
    if (preview.isPreviewing(`pl:${playlistId}`)) {
      preview.stop();
      return OK;
    }
    const playlist = this.library.playlist(playlistId);
    if (!playlist) {
      return this.fail("That playlist is no longer there.");
    }
    const first = playlistTracks(playlist, this.library)[0];
    const media = first ? this.library.media(first) : null;
    if (first && !media) {
      return this.fail(`Unable to preview: ${trackTitle(first)}`);
    }
    const item = playlistPreview(playlist, this.library, () => media!);
    if ("message" in item) {
      return this.fail(item.message);
    }
    const profile = this.previewProfile(first!, options.place ?? null, playlistId);
    preview.play({ ...item, options: { gainDb: this.previewGain(item.trackId ?? null, playlistId), profile }, from: options.from ?? null });
    return OK;
  }

  previewPad(boardId: string, padId: string, options: PreviewFrom = {}): CueOutcome {
    const preview = this.parts.preview;
    if (preview.isPreviewing(`pad:${boardId}/${padId}`)) {
      preview.stop();
      return OK;
    }
    const pad = this.library.pad(boardId, padId);
    const track = pad?.trackIds.length ? this.library.track(pad.trackIds[0]) : undefined;
    const media = track ? this.library.media(track) : null;
    if (!pad || !media) {
      return this.fail(padWithoutSound(pad));
    }
    // A pad's sound plays on its own on air: the track's choice, then the library's.
    preview.play({ ...padPreview({ boardId, padId, label: pad.label, media }), trackId: track!.id, options: { gainDb: this.previewGain(track!.id, null) }, from: options.from ?? null });
    return OK;
  }

  tryPad(boardId: string, padId: string, phase: "down" | "up" = "down", options: PreviewFrom = {}): CueOutcome {
    const preview = this.parts.preview;
    const key = `pad:${boardId}/${padId}`;
    const pad = this.library.pad(boardId, padId);
    if (!pad || pad.trackIds.length === 0) {
      return this.fail(padWithoutSound(pad));
    }
    const on = preview.isPreviewing(key);
    // The same rules as RoomPlayer.firePad, on the preview: a let-go only ends a hold pad; a press on a pad that
    // sounds stops it, whatever its play mode (BUG-20).
    if (phase === "up") {
      if (pad.mode === "hold" && on) preview.stop();
      return OK;
    }
    if (on) {
      preview.stop();
      return OK;
    }
    const track = this.library.track(this.tryVariant(key, pad.trackIds, pad.order));
    const media = track ? this.library.media(track) : null;
    if (!media) {
      return this.fail(padWithoutSound(pad));
    }
    const loop = pad.mode === "toggle" || pad.mode === "hold";
    // Quiet: the board says what the press did ("Storm: loop stopped"), in the words of Try pads.
    preview.play({ ...padPreview({ boardId, padId, label: pad.label, media }), options: { loop, volume: pad.volume }, quiet: true, from: options.from ?? null });
    return OK;
  }

  /** The sound a tried pad plays this press: in turn, or at random (as the Director picks a pad's variant). */
  private readonly tryTurns = new Map<string, number>();
  private tryVariant(key: string, trackIds: string[], order: "random" | "roundrobin"): string {
    if (order === "roundrobin") {
      const turn = this.tryTurns.get(key) ?? 0;
      this.tryTurns.set(key, turn + 1);
      return trackIds[turn % trackIds.length];
    }
    return trackIds[Math.min(trackIds.length - 1, Math.floor(Math.random() * trackIds.length))];
  }

  stopPreview(): void {
    this.parts.preview.stop();
  }

  togglePreviewPause(): CueOutcome {
    return this.parts.preview.togglePause() ? OK : this.fail("Nothing is previewing.");
  }

  setPreviewVolume(volume: number): void {
    this.parts.preview.setVolume(volume);
  }

  isPreviewing(key: string): boolean {
    return this.parts.preview.isPreviewing(key);
  }

  testChime(roomId: string): CueOutcome {
    if (this.disposed) {
      return this.fail("Lyre's sound has stopped. Reopen the Lyre tab.");
    }
    // getRoomBus falls back to the first room for an unknown id; a chime must never play somewhere else.
    if (!this.parts.mixer.rooms().some((room) => room.botId === roomId)) {
      return this.fail("That room is not in a voice channel now.");
    }
    if (!this.parts.chime) {
      return this.fail("The test chime cannot play here.");
    }
    this.parts.chime(this.parts.mixer.getRoomBus(roomId, "fx"));
    return OK;
  }

  roomLevel(roomId: string): number {
    if (this.disposed || !this.parts.meter) return 0;
    // mixer.output falls back to the first room for an unknown id; a meter must never show another room.
    const known = roomId === TABLE_ROOM ? this.parts.mixer.rooms().length === 0 : this.parts.mixer.rooms().some((room) => room.botId === roomId);
    if (!known) return 0;
    const output = this.parts.mixer.output(roomId);
    let meter = this.meters.get(output);
    if (!meter) {
      meter = this.parts.meter(output);
      this.meters.set(output, meter);
    }
    const level = meter.level();
    return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  }

  async previewDevices(): Promise<OutputDeviceInfo[]> {
    return this.parts.previewDevices ? this.parts.previewDevices.list() : [];
  }

  async setAudioDevices(devices: AudioDevices): Promise<DeviceStatus | null> {
    const split = devices.split ? devices.previewEar : null;
    if (split !== this.splitEar) {
      this.splitEar = split;
      this.changed();
    }
    if (!this.parts.previewDevices) return null;
    // A device that is not there plays on the computer's default until it is back (outputDevices.ts).
    return this.choosePreviewDevice(devices.previewDevice).catch(() => this.parts.previewDevices?.status("preview") ?? null);
  }

  async choosePreviewDevice(deviceId: string): Promise<DeviceStatus> {
    if (!this.parts.previewDevices) {
      throw new Error("This version of Lyre cannot choose a sound device for the preview.");
    }
    try {
      return await this.parts.previewDevices.choose("preview", deviceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That sound device could not be used.";
      this.emit("error", message);
      throw error;
    }
  }

  // ---------- state ----------

  getNowPlaying(): NowPlaying {
    if (!this.snapshot) {
      this.snapshot = this.build();
    }
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    if (!this.stopProgress && !this.disposed) {
      // The engine ticks about once a second, only while something plays.
      this.stopProgress = this.parts.engine.onProgress(() => this.changed());
    }
    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0) {
        this.stopProgress?.();
        this.stopProgress = null;
      }
    };
  }

  getPositions(): PlayPositions {
    if (!this.positions) {
      this.positions = this.readPositions();
    }
    return this.positions;
  }

  subscribePositions(listener: () => void): () => void {
    this.positionSubscribers.add(listener);
    this.updatePositionTicker();
    return () => {
      this.positionSubscribers.delete(listener);
      this.updatePositionTicker();
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopProgress?.();
    this.stopProgress = null;
    this.subscribers.clear();
    this.positionSubscribers.clear();
    this.updatePositionTicker();
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.director.dispose();
    this.rooms.dispose();
    this.parts.preview.dispose();
    this.parts.previewDevices?.dispose();
    this.keepRoomsRunning();
    this.removeAllListeners();
    await this.parts.onDispose?.();
  }

  // ---------- inside ----------

  /**
   * The audio profile a track plays with on air from that place and playlist (the scene's own settings, the
   * playlist's, then the track's), which its preview plays with too (Nik, 0.5.0: Preview ignored Start, End and fades).
   * The same as RoomPlayer.startLane: its lane's ending, and a role's (a sting never loops; Ending "Fades out").
   */
  private previewProfile(track: DomainTrack, place: UsePlace | null, playlistId: string | null): AudioProfile {
    const places = profilePlacesFor(place, playlistId);
    const overrides = this.library.profileOverrides();
    const lane = track.kind === "amb" ? "ambience" : track.kind === "fx" ? "effects" : "music";
    return roleProfile(track, laneProfile(track, lane, places, overrides), { fadeOutChosen: profileInputFor(track, places, overrides).fadeOut !== undefined });
  }

  /** PLY-15: the gain a track gets on air from that playlist (or on its own), which its preview hears too. */
  private previewGain(trackId: string | null, playlistId: string | null): number {
    const track = trackId ? this.library.track(trackId) : undefined;
    return normalisedGainDb(track, playlistId ? this.library.playlist(playlistId) : null, this.library.normaliseSettings?.() ?? DEFAULT_LIBRARY_NORMALISE);
  }

  private perform(action: CueAction): CueOutcome {
    if (this.disposed) {
      return { ok: false, message: "Lyre's sound has stopped. Reopen the Lyre tab." };
    }
    const outcome = this.director.run(this.inEngineIds(action));
    if ("message" in outcome) {
      this.emit("error", outcome.message);
    }
    return outcome;
  }

  private step(type: "next" | "previous", lane: MusicOrAmbience, target: RoomTarget): CueOutcome {
    const outcome = this.perform({ type, lane, target });
    if (outcome.ok) {
      const firstRoom = this.targetRooms(target)[0];
      const report = this.director.report().find((room) => room.roomId === firstRoom);
      const now = lane === "music" ? report?.music : report?.ambience;
      if (now) {
        this.emit("announce", `${LANE_LABEL[lane]}${this.inRoom(target)}: ${now.title}`);
      }
    }
    return outcome;
  }

  private fail(message: string): CueOutcome {
    this.emit("error", message);
    return { ok: false, message };
  }

  /** The action with its room named the way the Director knows it. */
  private inEngineIds(action: CueAction): CueAction {
    return "target" in action && action.target !== undefined ? { ...action, target: this.rooms.target(action.target) } : action;
  }

  /** The Director's ids of the rooms a target names. */
  private targetRooms(target: RoomTarget): string[] {
    return roomsFor(this.rooms.target(target), [...this.rooms.rooms()]);
  }

  /**
   * " in Dungeon" when there are two rooms or more (UX-R21: the first room is named too), " in every room" for all;
   * "" with one room or none.
   */
  private inRoom(target: RoomTarget): string {
    const rooms = this.rooms.rooms();
    if (rooms.length < 2) return "";
    if (target === "all") return " in every room";
    const id = this.targetRooms(target)[0];
    const name = rooms.find((room) => room.botId === id)?.name;
    return name ? ` in ${name}` : "";
  }

  /** The voice a lane plays now in a room (not one fading out). */
  private laneVoice(roomId: string, lane: MusicOrAmbience): Voice | undefined {
    const voices = this.parts.engine.voices(lane).filter((voice) => voice.room === roomId && voice.state !== "stopping");
    return voices[voices.length - 1];
  }

  /** The rooms by the ids screens know: the bots in voice channels, or "table" while there is none. */
  private realRoomIds(): string[] {
    const rooms = this.parts.mixer.rooms();
    return rooms.length ? rooms.map((room) => room.botId) : [TABLE_ROOM];
  }

  private roomVolume(realId: string): number {
    return this.roomVolumes.get(realId) ?? this.parts.startRoomVolume ?? 1;
  }

  /**
   * Each room's mix plays at its volume. A level chosen for the table stays with the table: the first bot's room
   * does not take it over (security review w4, Should 4), because from then on every slider shows and changes the
   * bot's own volume, kept by the main process, and the room would have stayed quieter than any slider said.
   */
  private applyRoomVolumes(): void {
    if (this.disposed) return;
    for (const id of this.realRoomIds()) this.parts.mixer.setLevel(id, "master", this.roomVolume(id));
  }

  /** Every room's mix joined to the silent keep-alive node (and none once disposed), so the graph keeps running. */
  private keepRoomsRunning(): void {
    const wanted = new Set(this.disposed ? [] : this.realRoomIds().map((id) => this.parts.mixer.output(id)));
    // OUT-10: a meter goes with its room.
    for (const [output, meter] of this.meters) {
      if (wanted.has(output)) continue;
      meter.dispose();
      this.meters.delete(output);
    }
    const keepAlive = this.parts.keepAlive;
    if (!keepAlive) return;
    for (const output of this.kept) {
      if (wanted.has(output)) continue;
      try {
        output.disconnect(keepAlive);
      } catch {
        // Already disconnected: the room it belonged to has gone.
      }
      this.kept.delete(output);
    }
    for (const output of wanted) {
      if (this.kept.has(output)) continue;
      output.connect(keepAlive);
      this.kept.add(output);
    }
  }

  private changed() {
    this.snapshot = null;
    this.positions = null;
    this.wantAhead();
    this.updatePositionTicker();
    if (this.notifyQueued || this.disposed) {
      return;
    }
    // Several changes in one action reach the listeners once.
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      // With a split headset the preview's ear follows what plays on air, even with no screen reading the state.
      if ((this.splitEar || this.previewEar !== "both") && !this.disposed) this.getNowPlaying();
      for (const listener of [...this.subscribers, ...this.positionSubscribers]) {
        listener();
      }
    });
  }

  /** Where every room's lanes and the preview are now. */
  private readPositions(): PlayPositions {
    const rooms: Record<string, { music: number | null; ambience: number | null }> = {};
    if (!this.disposed) {
      for (const room of this.director.report()) {
        rooms[this.rooms.toReal(room.roomId)] = { music: room.music?.positionSeconds ?? null, ambience: room.ambience?.positionSeconds ?? null };
      }
    }
    const current = this.parts.preview.current();
    const at = this.parts.preview.position();
    return { rooms, preview: current && at && at.key === current.key ? at.seconds : null };
  }

  /** A room's music or ambience, or the preview, is playing (or loading to play): its position moves on. */
  private somethingMovesOn(): boolean {
    if (this.disposed) return false;
    const plays = (lane: MusicOrAmbience) => this.parts.engine.voices(lane).some((voice) => voice.state === "playing");
    const preview = this.parts.preview.current();
    return plays("music") || plays("ambience") || (!!preview && !preview.paused);
  }

  /** One timer, and only while someone shows a position and something moves on (PERF-1: nothing polls at rest). */
  private updatePositionTicker(): void {
    const scheduler = this.parts.engine.scheduler;
    const wanted = this.positionSubscribers.size > 0 && this.somethingMovesOn();
    if (wanted && this.positionTimer === null) {
      this.positionTimer = scheduler.setTimeout(() => {
        this.positionTimer = null;
        this.positions = null;
        for (const listener of [...this.positionSubscribers]) {
          listener();
        }
        this.updatePositionTicker();
      }, POSITION_TICK_MS);
    } else if (!wanted && this.positionTimer !== null) {
      scheduler.clearTimeout(this.positionTimer);
      this.positionTimer = null;
    }
  }

  /** Keep the playing tracks and the next music track in memory (PLY-11). */
  private wantAhead() {
    const readAhead = this.parts.readAhead;
    if (!readAhead || this.disposed) {
      return;
    }
    const ids = new Set<string>();
    for (const room of this.director.report()) {
      [room.music?.trackId, room.upNext, room.ambience?.trackId].forEach((id) => id && ids.add(id));
      // SHW-3: what follows the playing track when nothing else waits.
      const follow = room.music && !room.upNext ? this.library.track(room.music.trackId)?.follow : null;
      if (follow?.kind === "track") ids.add(follow.id);
      else if (follow?.kind === "playlist") {
        const playlist = this.library.playlist(follow.id);
        const first = playlist ? playlistTracks(playlist, this.library)[0] : undefined;
        if (first) ids.add(first.id);
      }
    }
    const key = [...ids].join("\n");
    if (key === this.wantedKey) {
      return;
    }
    this.wantedKey = key;
    const requests = [...ids].flatMap((id) => {
      const track = this.library.track(id);
      const media = track ? this.library.media(track) : null;
      return media ? [media] : [];
    });
    readAhead.want(requests);
  }

  private build(): NowPlaying {
    const current = this.parts.preview.current();
    const at = this.parts.preview.position();
    const preview: PreviewNowPlaying | null = current && {
      ...current,
      position: at && at.key === current.key ? at.seconds : null,
      length: this.parts.preview.length(),
      volume: this.parts.preview.volume(),
    };
    const rooms = this.disposed ? [] : this.director.report().map((room) => this.roomState(room));
    this.applyPreviewEar(this.earFor(rooms));
    return {
      rooms,
      broadcasting: this.parts.streams.broadcasting,
      preview,
      previewDevice: this.parts.previewDevices?.status("preview") ?? null,
      canUndo: this.director.canUndo(),
      previewEar: this.previewEar,
    };
  }

  /**
   * 0.5.1 (Nik, 11 Nov): a split headset puts the preview in its ear only while something plays on air with it (music
   * or ambience not paused, or an effect); when the preview is the only sound it plays in both ears.
   */
  private earFor(rooms: readonly RoomNowPlaying[]): "both" | "left" | "right" {
    if (!this.splitEar) return "both";
    const onAir = rooms.some((room) => (room.music && !room.music.paused) || (room.ambience && !room.ambience.paused) || room.effects.length > 0);
    return onAir ? this.splitEar : "both";
  }

  private applyPreviewEar(ear: "both" | "left" | "right") {
    if (ear === this.previewEar) return;
    this.previewEar = ear;
    this.parts.setPreviewEar?.(ear);
  }

  private roomState(room: RoomReport): RoomNowPlaying {
    const title = (id: string) => trackTitle(this.library.track(id));
    return {
      roomId: this.rooms.toReal(room.roomId),
      name: room.name,
      volume: this.roomVolume(this.rooms.toReal(room.roomId)),
      music: room.music ? this.laneState(room.roomId, "music", room.music) : null,
      ambience: room.ambience ? this.laneState(room.roomId, "ambience", room.ambience) : null,
      upNext: room.upNext ? { trackId: room.upNext, title: title(room.upNext) } : null,
      queued: room.queued.map((entry) => ({ ...entry, title: title(entry.trackId) })),
      upNextList: room.list.map((entry) =>
        entry.kind === "plan"
          ? { ref: entry.ref, kind: "planned" as const, trackIds: [entry.trackId], title: title(entry.trackId), playlistId: entry.playlistId, rest: false }
          : { ref: entry.ref, kind: entry.source === "pn" ? ("playNext" as const) : ("added" as const), trackIds: [...entry.trackIds], title: entry.name, playlistId: entry.playlistId, rest: entry.rest },
      ),
      repeat: { ...room.repeat },
      shuffle: room.shuffle,
      canUndoUpNext: room.canUndoList,
      effects: room.effects.map((effect) => ({ ...effect, title: title(effect.trackId) })),
      played: room.played.map((p) => ({ ...p, title: title(p.trackId) })),
    };
  }

  private laneState(roomId: string, lane: MusicOrAmbience, playing: PlayingReport): LaneNowPlaying {
    const voice = this.laneVoice(roomId, lane);
    // The library's length, as every list shows it, so the Now playing bar agrees with them; the playing file's
    // length only for a track the library has no length for.
    const known = (this.library.track(playing.trackId)?.durationMs ?? 0) / 1000;
    const length = Number.isFinite(known) && known > 0 ? known : voice && Number.isFinite(voice.duration) ? voice.duration : null;
    return {
      trackId: playing.trackId,
      title: playing.title,
      origin: playing.origin,
      playlistId: playing.playlistId,
      position: playing.positionSeconds,
      length,
      paused: playing.state === "paused",
      loading: playing.state === "loading" || playing.state === null,
      place: placeOfOrigin(playing.origin),
      playOrder: playing.playlistId ? playOrderOf(playing.playlistId, playing.origin, this.library) : null,
      gainDb: playing.gainDb,
      level: playing.level,
    };
  }
}

/** Where a lane's track plays from, for the Now playing bar: its scene, or the list its playlist was played from. */
function placeOfOrigin(origin: Origin): UsePlace | null {
  if (origin.kind === "scene") return { kind: "scene", ...origin.scene };
  return origin.place ?? null;
}

/** The fades screens show next to their buttons, in milliseconds (from the prototype). */
export const DEFAULT_FADES_MS = {
  crossfade: DEFAULT_FADES.crossfade * 1000,
  fadeLane: DEFAULT_FADES.fadeLane * 1000,
  fadeAll: DEFAULT_FADES.fadeAll * 1000,
} as const;
