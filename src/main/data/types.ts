/**
 * The shapes the data layer hands out and accepts. Field names are camelCase;
 * the tables use snake_case (see schema/v001-initial.ts and v002-design.ts).
 * Times are milliseconds since 1970 (UTC); durations and marker times are milliseconds.
 * The design's own shapes (DomainTrack, DomainCampaign …) come from src/common/domain;
 * repo/domain.ts maps rows to them.
 */
import {
  TRACK_KINDS,
  TRACK_ROLES,
  type AudioProfileInput,
  type Lane,
  type LoopAdvice,
  type PlaylistRule,
  type SoundRef,
  type TrackKind,
  type TrackRole,
} from "../../common/domain";

export { TRACK_KINDS };
export type { TrackKind };

/** A playlist's lane (DAT-11): Music, Ambience or FX. */
export const LANES: readonly Lane[] = TRACK_KINDS;

/** How a track tends to develop (DAT-2). */
export const ARCS = ["builds", "steady", "swells", "resolves"] as const;
export type Arc = (typeof ARCS)[number];

/** What a track is used as (DAT-2; "effect" added by the design, DAT-11). */
export const ROLES = TRACK_ROLES;
export type Role = TrackRole;

/** Whether a track loops well (DAT-2): the design's loop advice. */
export const LOOPABLE: readonly LoopAdvice[] = ["yes", "crossfade", "no"];
export type Loopable = LoopAdvice;

/** How a track ends (DAT-2). */
export const ENDINGS = ["fades", "hard_stop", "resolves"] as const;
export type Ending = (typeof ENDINGS)[number];

/**
 * Marker kinds (DAT-3). "marker" is a plain named point such as "swell";
 * "mix_out" is where the next track may start. Where a loop starts and ends is
 * the audio profile's (loopStartMs, endMs), stored once (DB review 7).
 */
export const MARKER_KINDS = ["marker", "mix_out"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

/** What a folder holds (ORG-4). Dynamic playlists and scene blocks arrive later. */
export const FOLDER_SCOPES = ["playlists", "boards", "sessions"] as const;
export type FolderScope = (typeof FOLDER_SCOPES)[number];

/** Where to put an item among its siblings. */
export type Placement = "start" | "end" | { before: string } | { after: string };

export type LibraryRoot = {
  id: string;
  /** Name the game master gives the folder, for example "Soundtracks". */
  name: string;
  /** Absolute folder path on this computer. */
  path: string;
  /** New files in it are added by themselves (DB review 9). */
  watched: boolean;
  createdAt: number;
};

/** Where a track's audio is. */
export type TrackLocation =
  /** A file under a library root; `path` is relative to the root, with "/" separators. */
  | { kind: "root"; rootId: string; path: string }
  /** A file outside every library root. */
  | { kind: "absolute"; path: string }
  /** A web address. */
  | { kind: "url"; url: string };

export type TrackMetadata = {
  /** Music, ambience or sound effect (DAT-11). */
  kind: TrackKind;
  /** The title in the file's tags (DAT-11). */
  metaTitle: string;
  /** The track's own audio profile; null for the defaults (see resolveProfile in src/common/domain). */
  profile: AudioProfileInput | null;
  energy: number | null;
  arc: Arc | null;
  role: Role | null;
  loopable: Loopable | null;
  ending: Ending | null;
  /** "Cue something up after this" (DAT-2 example: a sting that must be followed). */
  followRequired: boolean;
  notes: string;
  sourceComposer: string | null;
  sourceAlbum: string | null;
  sourceCueNumber: string | null;
  rating: number | null;
  /** Added by an import and not settled yet (no title of its own or no tag): the Library's New mark (schema v3). */
  isNew: boolean;
};

export type Track = TrackMetadata & {
  id: string;
  /** The game master's own title; empty until given one (screens then show metaTitle, then fileName). */
  title: string;
  location: TrackLocation;
  fileName: string;
  fileSize: number | null;
  fileMtimeMs: number | null;
  checksum: string | null;
  durationMs: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** File facts recorded when a track is added, used to relink moved files (DAT-8). */
export type FileFacts = {
  /** Absolute path; stored relative to a library root when it is under one. */
  path: string;
  size?: number | null;
  mtimeMs?: number | null;
  checksum?: string | null;
};

export type TrackInput = Partial<TrackMetadata> & {
  /** Keep an existing id (for example from the current player's data). */
  id?: string;
  /** Empty when left out. */
  title?: string;
  /** Exactly one of `file` and `url`. */
  file?: FileFacts;
  url?: string;
  durationMs?: number | null;
};

export type TrackPatch = Partial<TrackMetadata> & {
  title?: string;
  file?: FileFacts;
  url?: string;
  durationMs?: number | null;
};

export type Marker = {
  id: string;
  trackId: string;
  timeMs: number;
  kind: MarkerKind;
  label: string;
  createdAt: number;
};

export type Folder = {
  id: string;
  scope: FolderScope;
  parentId: string | null;
  name: string;
  color: string | null;
  collapsed: boolean;
  position: number;
};

/** Manual: tracks picked by hand, in order. Dynamic: every track in its lane that matches its rule (DAT-11). */
export const PLAYLIST_KINDS = ["manual", "dynamic"] as const;
export type PlaylistKind = (typeof PLAYLIST_KINDS)[number];

export type Playlist = {
  id: string;
  title: string;
  /** A picture name such as "tavern", or an address. */
  background: string;
  folderId: string | null;
  position: number;
  kind: PlaylistKind;
  lane: Lane;
  /** Dynamic playlists only; null for manual ones. */
  rule: PlaylistRule | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type PlaylistItem =
  | { id: string; playlistId: string; kind: "track"; trackId: string; title: string; position: number }
  | { id: string; playlistId: string; kind: "divider"; label: string; position: number };

/** A pad board (DAT-11): a grid of `cols` x `rows` cells, 1 to 8 each. */
export type Board = {
  id: string;
  title: string;
  background: string;
  folderId: string | null;
  position: number;
  cols: number;
  rows: number;
  createdAt: number;
  updatedAt: number;
};

export const MAX_GRID_SIZE = 8;

/** Pad colours: lane-safe hue names (the screens map them to colours). */
export const PAD_COLORS = ["steel", "ember", "gold", "moss", "violet", "plum", "sea", "bone"] as const;
export type PadColor = (typeof PAD_COLORS)[number];

/** How a pad plays: one shared list for the database, the engine and the screens (src/common/domain). */
export { PAD_MODES } from "../../common/domain/types";
import type { PadMode } from "../../common/domain/types";
export type { PadMode };

/** One file, several variants, or any effect with a tag. */
export const PAD_SOUND_KINDS = ["single", "variants", "tag"] as const;
export type PadSoundKind = (typeof PAD_SOUND_KINDS)[number];

/** How variants take turns: at random, or one after the other. */
export const PAD_SOUND_ORDERS = ["random", "in_turn"] as const;
export type PadSoundOrder = (typeof PAD_SOUND_ORDERS)[number];

/** A grid cell, counted from 0 (row 0, column 0 is the top left). */
export type PadCell = { row: number; col: number };

export type PadSound = {
  kind: PadSoundKind;
  /** The library tracks it plays, in order; "single" plays the first. Kept when switching kinds. */
  trackIds: string[];
  order: PadSoundOrder;
  /** For "tag": the tag whose effects it plays (null once that tag is deleted). */
  tagId: string | null;
};

export type Pad = {
  id: string;
  boardId: string;
  /** Where it sits on the grid, or null for a spare pad (off the grid; its hotkey does nothing). */
  cell: PadCell | null;
  label: string;
  /** An icon name from the screens' icon set, such as "swords". */
  icon: string;
  color: PadColor;
  /** A single key, lower case; null for none. */
  hotkey: string | null;
  mode: PadMode;
  sound: PadSound;
  /** 0 to 1. */
  volume: number;
  /** The fade when the sound stops (toggle off, hold released), in milliseconds. */
  fadeMs: number;
  /** Fade in, in milliseconds (kept from the old soundboards; the design's pads start at once). */
  fadeInMs: number;
};

/** What a pad can be given; missing fields take the prototype's defaults (New pad, star, gold, one-shot, 80%, 1.5 s). */
export type PadInput = Partial<Omit<Pad, "id" | "boardId" | "cell" | "sound">> & {
  id?: string;
  sound?: Partial<PadSound>;
};

/** A board as the screens show it: the grid row by row (null = empty cell), then the spare pads. */
export type BoardLayout = { board: Board; slots: (Pad | null)[]; spare: Pad[] };

export type TagGroup = {
  id: string;
  name: string;
  color: string | null;
  position: number;
};

export type Tag = {
  id: string;
  groupId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  position: number;
  synonyms: string[];
};

/** Campaign themes of the design; candle is the default. */
export const CAMPAIGN_THEMES = ["fern", "hearth", "candle", "parchment", "elysium"] as const;
export type CampaignTheme = (typeof CAMPAIGN_THEMES)[number];

/** Where a campaign's notes are in Obsidian (not used yet). */
export type ObsidianLinks = { vault: string; note: string; sessionsFolder: string };

export type Campaign = {
  id: string;
  name: string;
  color: string | null;
  notes: string;
  theme: CampaignTheme;
  /** The game system, for example "D&D 5e". */
  system: string;
  /** A line or two about the campaign. */
  description: string;
  obsidian: ObsidianLinks;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export const SESSION_STATUSES = ["played", "next", "draft"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type Session = {
  id: string;
  campaignId: string;
  folderId: string | null;
  /** Shown as "Session 14". */
  number: number;
  /** May be empty. */
  name: string;
  notes: string;
  /** Calendar date, YYYY-MM-DD, planned or played. */
  date: string | null;
  /** At most one session per campaign is next. */
  status: SessionStatus;
  /** The session's Obsidian note (not used yet). */
  noteLink: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type Scene = {
  id: string;
  sessionId: string;
  /** May be empty. */
  name: string;
  /** One line: when the scene starts, for example "Roll initiative". */
  startsWhen: string;
  notes: string;
  /** The scene's Obsidian note (not used yet). */
  noteLink: string;
  /** One ambience track or ambience playlist, or none. */
  ambience: SoundRef | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

/** An entry of a scene's music list. */
export type SceneMusicItem = {
  id: string;
  sceneId: string;
  ref: SoundRef;
  position: number;
  /** The track's or playlist's title (a track without one shows its file-tag title, then its file name). */
  title: string;
};

/** Playlists and boards given to a campaign or a session, in order. */
export type Members = { playlistIds: string[]; boardIds: string[] };

/** A place a playlist or board can be used: a whole campaign, one session, or one scene. */
export type UseTarget = { campaignId: string } | { sessionId: string } | { sceneId: string };

/**
 * Where a tag is used; shown before it is deleted (DB review 2). Deleting it
 * takes it off the tracks, out of the rules (a condition left with no tags then
 * plays nothing) and leaves the pads silent until given another sound.
 */
export type TagUsage = {
  /** How many tracks carry the tag. */
  tracks: number;
  /** Dynamic playlists whose rule names it, by title. */
  playlists: { id: string; title: string }[];
  /** Pads that play any effect with the tag, by board then label. */
  pads: { id: string; label: string; boardId: string; boardTitle: string }[];
};

/** Where a track is used; shown before it is deleted (DAT-1). */
export type TrackUsage = {
  playlists: { id: string; title: string }[];
  boards: { id: string; title: string }[];
  scenes: { id: string; name: string }[];
};
