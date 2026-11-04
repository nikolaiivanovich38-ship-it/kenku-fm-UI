/**
 * The shapes the data layer hands out and accepts. Field names are camelCase;
 * the tables use snake_case (see schema/v001-initial.ts).
 * Times are milliseconds since 1970 (UTC); durations and marker times are milliseconds.
 */

/** How a track tends to develop (DAT-2). */
export const ARCS = ["builds", "steady", "swells", "resolves"] as const;
export type Arc = (typeof ARCS)[number];

/** What a track is used as (DAT-2). */
export const ROLES = ["sting", "loop_bed", "underscore", "transition"] as const;
export type Role = (typeof ROLES)[number];

/** Whether a track can loop (DAT-2). */
export const LOOPABLE = ["yes", "with_crossfade", "no"] as const;
export type Loopable = (typeof LOOPABLE)[number];

/** How a track ends (DAT-2). */
export const ENDINGS = ["fades", "hard_stop", "resolves"] as const;
export type Ending = (typeof ENDINGS)[number];

/** Marker kinds (DAT-3). "marker" is a plain named point such as "swell". */
export const MARKER_KINDS = ["marker", "loop_in", "loop_out", "mix_out"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

/** What a folder holds (ORG-4). Dynamic playlists and scene blocks arrive later. */
export const FOLDER_SCOPES = ["playlists", "boards", "sessions"] as const;
export type FolderScope = (typeof FOLDER_SCOPES)[number];

/**
 * A track's default way in or out (DAT-2, PLY-8). PLY-8 may add kinds;
 * stored as JSON so that needs no table change.
 */
export type Transition =
  | { kind: "crossfade"; seconds: number; curve: "linear" | "equal_power" }
  | { kind: "cut" }
  | { kind: "after_current_ends" }
  | { kind: "at_mix_out" }
  | { kind: "after_loop" };

/** Where to put an item among its siblings. */
export type Placement = "start" | "end" | { before: string } | { after: string };

export type LibraryRoot = {
  id: string;
  /** Name the game master gives the folder, for example "Soundtracks". */
  name: string;
  /** Absolute folder path on this computer. */
  path: string;
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
  energy: number | null;
  arc: Arc | null;
  role: Role | null;
  loopable: Loopable | null;
  ending: Ending | null;
  transitionIn: Transition | null;
  transitionOut: Transition | null;
  /** "Cue something up after this" (DAT-2 example: a sting that must be followed). */
  followRequired: boolean;
  notes: string;
  sourceComposer: string | null;
  sourceAlbum: string | null;
  sourceCueNumber: string | null;
  rating: number | null;
};

export type Track = TrackMetadata & {
  id: string;
  /** The game master's label. */
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
  title: string;
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

export type Playlist = {
  id: string;
  title: string;
  /** A picture name such as "tavern", or an address. */
  background: string;
  folderId: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type PlaylistItem =
  | { id: string; playlistId: string; kind: "track"; trackId: string; title: string; position: number }
  | { id: string; playlistId: string; kind: "divider"; label: string; position: number };

export type Board = Playlist;

/** Per-sound settings carried over from the current soundboards. */
export type SoundSettings = {
  loop: boolean;
  /** 0 to 1. */
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export type BoardItem =
  | ({ id: string; boardId: string; kind: "sound"; trackId: string; title: string; position: number } & SoundSettings)
  | { id: string; boardId: string; kind: "divider"; label: string; position: number };

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

export type Campaign = {
  id: string;
  name: string;
  color: string | null;
  notes: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type Session = {
  id: string;
  campaignId: string;
  folderId: string | null;
  name: string;
  notes: string;
  /** Calendar date, YYYY-MM-DD. */
  playedOn: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type Scene = {
  id: string;
  sessionId: string;
  name: string;
  notes: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type SceneItemRef = { playlistId: string } | { boardId: string } | { trackId: string };

export type SceneItem = {
  id: string;
  sceneId: string;
  position: number;
  /** Title of the playlist, board or track. */
  title: string;
} & ({ kind: "playlist"; playlistId: string } | { kind: "board"; boardId: string } | { kind: "track"; trackId: string });

/** Where a track is used; shown before it is deleted (DAT-1). */
export type TrackUsage = {
  playlists: { id: string; title: string }[];
  boards: { id: string; title: string }[];
  scenes: { id: string; name: string }[];
};
