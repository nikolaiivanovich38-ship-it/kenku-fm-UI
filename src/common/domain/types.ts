/**
 * DAT-12: the shapes of the agreed design (Lyre design round 4, design/prototype).
 * These are the game master's concepts, independent of how the database stores them
 * (src/main/data maps its rows to these) and of how the engine plays them.
 * Times are milliseconds.
 */

import type { NormaliseChoice, TrackLoudness } from "./normalise";

/** What kind of sound a track is. "fx" covers sound effects; stings are music tracks with role "sting". */
export const TRACK_KINDS = ["music", "amb", "fx"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** A playlist's lane: what it plays into. Music, Ambience or FX (effects and stings). */
export type Lane = TrackKind;

export const TRACK_ROLES = ["loop_bed", "underscore", "sting", "transition", "effect"] as const;
export type TrackRole = (typeof TRACK_ROLES)[number];

/**
 * DAT-13: how a track moves over time, as a short fixed list. Lyre suggests one from the loudness (shapeFromPeaks);
 * the game master's choice wins.
 */
export const TRACK_SHAPES = ["steady", "builds", "fallsAway", "peaksThenFalls", "risesAndFalls"] as const;
export type TrackShape = (typeof TRACK_SHAPES)[number];
/** The words shown for each shape (with a small glyph beside them on screen). */
export const SHAPE_WORDS: Record<TrackShape, string> = {
  steady: "Steady",
  builds: "Builds",
  fallsAway: "Falls away",
  peaksThenFalls: "Peaks then falls",
  risesAndFalls: "Rises and falls",
};

/** Whether a track loops by default when it has no audio profile of its own. */
export type LoopAdvice = "yes" | "crossfade" | "no";

export interface DomainTrack {
  id: string;
  kind: TrackKind;
  /** The title the game master gave it; empty when none yet. */
  title: string;
  /** The title in the file's tags. */
  metaTitle: string;
  fileName: string;
  durationMs: number;
  role: TrackRole | null;
  loop: LoopAdvice | null;
  /** 1 to 5, or null when not rated. */
  energy: number | null;
  /** Tag values by tag group id, for example { mood: ["Eerie"], motif: [], scene: ["Ritual"] }. */
  tags: Record<string, string[]>;
  /** The track's own audio profile; missing fields take the defaults (see resolveProfile). */
  profile?: AudioProfileInput | null;
  /** DAT-13: the shape the game master chose, or null for none. */
  shape?: TrackShape | null;
  /** DAT-13: the shape Lyre suggests from the track's loudness (shapeFromPeaks), used while none is chosen. */
  suggestedShape?: TrackShape | null;
  /** PLY-15: the track's own normalising choice; null or missing follows its playlist, then the library. */
  normalise?: NormaliseChoice | null;
  /** DAT-15: what Lyre measured from its file; null or missing: not measured yet (it plays as it is). */
  loudness?: TrackLoudness | null;
  /** PLY-4: Ending "Fades out": it fades out before its end (roleProfile); missing or false: it plays to its end. */
  fadesOut?: boolean;
  /** PLY-4: "Pick up where it stopped": it starts again where it was last stopped this evening. */
  resume?: boolean;
  /** SHW-3: what plays when it ends, unless something is already waiting; null or missing: nothing. */
  follow?: SoundRef | null;
}

/** One condition of a dynamic playlist. A condition with no values is ignored (it is still being written). */
export interface TagCondition {
  group: string;
  match: "any" | "all" | "none";
  values: string[];
}

export interface PlaylistRule {
  conds: TagCondition[];
  /** Inclusive energy range. */
  energy?: [number, number];
  /** Leave out tracks whose role is "sting". */
  leaveOutStings?: boolean;
  /** DAT-13: only tracks of one of these shapes (the chosen shape, else the suggested one). Empty or missing: any. */
  shapes?: TrackShape[];
}

/** PLY-13: whether a playlist repeats all its tracks, one track, or not at all. */
export const REPEATS = ["off", "all", "one"] as const;
export type Repeat = (typeof REPEATS)[number];
/** How a playlist plays: shuffled or in order, and whether it repeats all its tracks, one track, or not at all. */
export interface PlayOrder {
  shuffle: boolean;
  repeat: Repeat;
}

export type DomainPlaylist = {
  id: string;
  name: string;
  lane: Lane;
  /** PLY-13: the playlist's own play order; null or missing: the default for where it plays (resolvePlayOrder). */
  order?: PlayOrder | null;
  /** PLY-15: the playlist's normalising choice for its tracks; null or missing follows the library. */
  normalise?: NormaliseChoice | null;
} & (
  | { kind: "manual"; trackIds: string[] }
  | { kind: "dynamic"; rule: PlaylistRule }
);

/** An item in a scene's music list or its ambience slot: a single track or a playlist. */
export type SoundRef = { kind: "track"; id: string } | { kind: "playlist"; id: string };

export interface DomainScene {
  id: string;
  name: string;
  /** Plays in order: each track, then each playlist's tracks, then back to the start. The first item starts the scene. */
  music: SoundRef[];
  /** One ambience track or ambience playlist, or none. */
  ambience: SoundRef | null;
  /** Pad boards; the first shows when the scene starts. */
  boardIds: string[];
  /** PLY-8: what it does when it starts (round7.ts CueStep); null or missing: the usual (usualSceneSteps). */
  steps?: import("./round7").CueStep[] | null;
  /** PLY-8 "Then": whether it starts the next scene by itself; missing: it stays until Next. */
  movesOn?: import("./round7").MovesOn;
}

export interface DomainSession {
  id: string;
  campaignId: string;
  scenes: DomainScene[];
  playlistIds: string[];
  boardIds: string[];
  /** ORG-12: single tracks kept on hand for the whole session (Use in… on a track). */
  trackIds?: string[];
}

export interface DomainCampaign {
  id: string;
  playlistIds: string[];
  boardIds: string[];
  sessions: DomainSession[];
  /** ORG-12: single tracks kept on hand for the whole campaign (Use in… on a track). */
  trackIds?: string[];
}

/** A fade: its length and its intensity, 0 (gentle) to 100 (sharp); 36-64 is even (a straight line). */
export interface Fade {
  ms: number;
  shape: number;
}

/** What happens when playback reaches the end point. */
export type AfterEnd = "loop" | "next" | "stop";

/** PLY-12: where a track starts and ends, what happens at the end, and its fades. */
export interface AudioProfile {
  startMs: number;
  endMs: number;
  after: AfterEnd;
  loopStartMs: number;
  /** Crossfade when jumping back to loopStartMs. */
  loopCrossfadeMs: number;
  fadeIn: Fade;
  fadeOut: Fade;
  /** DAT-3: named points; `mix` marks the one mix-out point (where the next track crossfades in), at most one. */
  markers: { atMs: number; label: string; mix?: boolean }[];
  /**
   * 0.5.1 Start at: where the track starts by default wherever it plays with this profile, the time of one of its
   * markers; null or missing: the Beginning (startMs). A marker chosen to play from, or Pick up where it stopped, wins.
   */
  startAtMs?: number | null;
}

export type AudioProfileInput = Partial<AudioProfile>;

/**
 * A place where a track can have its own audio profile: inside one playlist, in one scene (cue), or (PLY-14) in one
 * session's list of tracks and playlists kept on hand.
 */
export type ProfilePlace =
  | { kind: "playlist"; playlistId: string }
  | { kind: "scene"; campaignId: string; sessionId: string; sceneId: string }
  | { kind: "session"; campaignId: string; sessionId: string };

/** Overrides by place key (see placeKey), then by track id. */
export type ProfileOverrides = Record<string, Record<string, AudioProfileInput>>;

/** Where an audio profile came from. */
export type ProfileSource = "scene" | "session" | "playlist" | "track";

/** One step in a scene's music order. */
export interface SequenceStep {
  trackId: string;
  /** Index into DomainScene.music. */
  itemIndex: number;
  /** Set when the step comes from a playlist item. */
  playlistId: string | null;
}

/** Where something is used (shown before deleting, and in "Used in"). */
export type Use =
  | { level: "campaign"; campaignId: string }
  | { level: "session"; campaignId: string; sessionId: string }
  | { level: "scene"; campaignId: string; sessionId: string; sceneId: string; role: "music" | "ambience" | "board"; position: number };

/** Looks things up by id; the caller decides where they come from (database, prototype data, tests). */
export interface DomainLookup {
  track(id: string): DomainTrack | undefined;
  playlist(id: string): DomainPlaylist | undefined;
  /** Every track, for dynamic playlists. */
  tracks(): Iterable<DomainTrack>;
  /** DAT-10: tags inside other tags (round7.ts TagTree), so a rule naming a tag finds the tags inside it too. */
  tagTree?(): Record<string, Record<string, string>>;
}

/** How a pad plays when pressed (SFX-3): once, on/off, while held, or from the start on every press. */
export const PAD_MODES = ["oneshot", "toggle", "hold", "retrigger"] as const;
export type PadMode = (typeof PAD_MODES)[number];

/** Rooms (OUT-5, OUT-6): every bot in a voice channel is a room, named after its channel. */
export interface Room {
  botId: string;
  /** The channel's name, for example "Table". */
  name: string;
}

/** Where an action sends its sound: one room, or every room. */
export type RoomTarget = { room: string } | "all";
