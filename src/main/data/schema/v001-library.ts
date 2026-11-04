/**
 * Schema version 1: the whole library (DAT-11), the agreed design (Lyre design
 * round 4, design/prototype; shapes in src/common/domain), normalised for this
 * app's read paths. docs/data-model.md explains every table, key, constraint
 * and index, the normal form each meets and the deliberate exceptions.
 *
 * Nothing was released before this step, so the three steps written during
 * waves 1 and 2 (the first schema, the design round 4 rebuild and the import
 * stream's additions) are folded into this one (DB review item 8).
 *
 * Principles
 * - Third normal form: one fact in one place, no lists inside a column.
 *   Ordered relations are join tables with a REAL `position` (gap ordering,
 *   ../ordering.ts) that is UNIQUE within its list. A reference that may be a
 *   track or a playlist is two nullable foreign keys with a CHECK that exactly
 *   one is set, so ON DELETE rules work.
 * - JSON only for self-contained values the database never queries (a long
 *   job's report in library_jobs).
 * - Integrity in the schema: foreign keys with explicit ON DELETE, CHECK
 *   constraints for every list of choices and every range, UNIQUE natural keys
 *   and positions, partial unique indexes, and triggers only where a rule spans
 *   two tables. A later choice is added with rebuildTable in a new step.
 * - Every index serves a named read path (the comment above it).
 *
 * Frozen once released: later changes go in a new step.
 */
import { randomUUID } from "crypto";
import type { DatabaseSync } from "../sqlite";
import type { Migration } from "./migrate";

/** Gap between positions of rows created here (as ../ordering.ts GAP; kept here so this step never changes). */
const GAP = 1024;

/** Offered to a new library (DAT-10, design round 4); the game master can rename or delete any of it. */
export const DEFAULT_TAG_GROUPS = ["Mood", "Leitmotif", "Scene type"] as const;
export const DEFAULT_MOOD_TAGS = ["Melancholy", "Heroic", "Tense", "Wistful", "Warm", "Triumphant", "Eerie"] as const;

/** A colour written #rrggbb in lower case (validate.ts nullableColor), or NULL. */
const COLOR = (column: string) =>
  `CHECK (${column} IS NULL OR (length(${column}) = 7 AND ${column} GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))`;

const TABLES = `
-- Named library folders (DAT-8): tracks under one store their path relative to it.
CREATE TABLE library_roots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row per audio file (DAT-1). Its file is a path under a library root (root_id + path
-- relative to it, "/" separators), an absolute path (root_id NULL), or a web address (url).
-- Size, modified time and checksum help relink moved files (DAT-8).
CREATE TABLE tracks (
  -- Library order, the order tracks were added (dynamic playlists, the Library): an explicit key, so
  -- undo puts a deleted track back in its place and VACUUM cannot renumber it (DB review 3).
  -- AUTOINCREMENT never hands out a number again, so a restored track cannot clash with a newer one.
  added_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'music' CHECK (kind IN ('music', 'amb', 'fx')),
  -- The game master's title; empty until given one (screens then show meta_title, then file_name).
  title TEXT NOT NULL DEFAULT '',
  -- The title in the file's tags.
  meta_title TEXT NOT NULL DEFAULT '',
  root_id TEXT REFERENCES library_roots (id) ON DELETE RESTRICT,
  path TEXT,
  url TEXT,
  file_name TEXT NOT NULL DEFAULT '',
  file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
  file_mtime_ms INTEGER,
  checksum TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  energy INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 5),
  arc TEXT CHECK (arc IS NULL OR arc IN ('builds', 'steady', 'swells', 'resolves')),
  role TEXT CHECK (role IS NULL OR role IN ('loop_bed', 'underscore', 'sting', 'transition', 'effect')),
  loopable TEXT CHECK (loopable IS NULL OR loopable IN ('yes', 'crossfade', 'no')),
  ending TEXT CHECK (ending IS NULL OR ending IN ('fades', 'hard_stop', 'resolves')),
  -- JSON by design: a self-contained Transition value (../types.ts) the engine reads whole; never queried.
  transition_in TEXT CHECK (transition_in IS NULL OR json_valid(transition_in)),
  transition_out TEXT CHECK (transition_out IS NULL OR json_valid(transition_out)),
  follow_required INTEGER NOT NULL DEFAULT 0 CHECK (follow_required IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  -- Artist (composer) and album, from the file's tags or typed in.
  source_composer TEXT,
  source_album TEXT,
  source_cue_number TEXT,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  last_used_at INTEGER,
  -- New: added by an import and not yet given a title of its own and a tag (the Library's New badge).
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((path IS NULL) <> (url IS NULL)),
  CHECK (root_id IS NULL OR path IS NOT NULL)
);

-- "Follow with" suggestions (DAT-2, SHW-3): what to cue after this track, in order.
CREATE TABLE track_follow_with (
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  follow_track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (track_id, follow_track_id),
  CHECK (track_id <> follow_track_id)
) WITHOUT ROWID;

-- Named points in a track (DAT-3), searchable.
CREATE TABLE markers (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('marker', 'loop_in', 'loop_out', 'mix_out')),
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Nested folders (ORG-4). Deleting a folder moves its contents up first (repository); SET NULL is a safety net.
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('playlists', 'boards', 'sessions')),
  parent_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT ${COLOR("color")},
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  position REAL NOT NULL
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- A picture name ("tavern") or an address.
  background TEXT NOT NULL DEFAULT '',
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  position REAL NOT NULL,
  -- manual: tracks picked by hand (playlist_items); dynamic: every track in its lane matching its rule.
  kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'dynamic')),
  lane TEXT NOT NULL DEFAULT 'music' CHECK (lane IN ('music', 'amb', 'fx')),
  -- A dynamic playlist's rule settings (its conditions are rule_conditions rows).
  rule_energy_min INTEGER CHECK (rule_energy_min BETWEEN 0 AND 5),
  rule_energy_max INTEGER CHECK (rule_energy_max BETWEEN 0 AND 5),
  rule_leave_out_stings INTEGER NOT NULL DEFAULT 0 CHECK (rule_leave_out_stings IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((rule_energy_min IS NULL) = (rule_energy_max IS NULL)),
  CHECK (rule_energy_min IS NULL OR rule_energy_min <= rule_energy_max),
  CHECK (kind = 'dynamic' OR (rule_energy_min IS NULL AND rule_leave_out_stings = 0))
);

-- A manual playlist's entries in order: a track, or a divider with a label (ORG-4).
CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('track', 'divider')),
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  CHECK ((kind = 'track') = (track_id IS NOT NULL))
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT '',
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  position REAL NOT NULL,
  grid_cols INTEGER NOT NULL DEFAULT 4 CHECK (grid_cols BETWEEN 1 AND 8),
  grid_rows INTEGER NOT NULL DEFAULT 3 CHECK (grid_rows BETWEEN 1 AND 8),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Tag vocabulary (DAT-10): groups hold tags; a tag may have a parent and synonyms.
CREATE TABLE tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  position REAL NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES tag_groups (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT,
  position REAL NOT NULL
);

CREATE TABLE tag_synonyms (
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  synonym TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (tag_id, synonym)
) WITHOUT ROWID;

CREATE TABLE track_tags (
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, tag_id)
) WITHOUT ROWID;

-- A pad sits in one grid cell (grid_row, grid_col, from 0) or waits among the
-- spare pads (spare_position); never both, never neither. Shrinking a board
-- moves pads outside the new size to spare (repository), so nothing is lost.
CREATE TABLE pads (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  grid_row INTEGER CHECK (grid_row BETWEEN 0 AND 7),
  grid_col INTEGER CHECK (grid_col BETWEEN 0 AND 7),
  spare_position REAL,
  label TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'star' CHECK (length(icon) BETWEEN 1 AND 40 AND icon NOT GLOB '*[^a-z0-9_-]*'),
  color TEXT NOT NULL DEFAULT 'gold' CHECK (color IN ('steel', 'ember', 'gold', 'moss', 'violet', 'plum', 'sea', 'bone')),
  -- One key, lower case. Not unique: two pads may share a key while the game master sorts it out (the screen warns).
  hotkey TEXT CHECK (hotkey IS NULL OR (length(hotkey) BETWEEN 1 AND 12 AND hotkey = lower(hotkey))),
  mode TEXT NOT NULL DEFAULT 'oneshot' CHECK (mode IN ('oneshot', 'toggle', 'hold', 'retrigger')),
  -- single: the first of pad_sounds; variants: all of them, at random or in turn; tag: any effect with sound_tag_id.
  sound_kind TEXT NOT NULL DEFAULT 'single' CHECK (sound_kind IN ('single', 'variants', 'tag')),
  sound_order TEXT NOT NULL DEFAULT 'random' CHECK (sound_order IN ('random', 'in_turn')),
  -- SET NULL: deleting a tag leaves the pad, which then plays nothing until given a sound.
  sound_tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  volume REAL NOT NULL DEFAULT 0.8 CHECK (volume BETWEEN 0 AND 1),
  fade_in_ms INTEGER NOT NULL DEFAULT 0 CHECK (fade_in_ms >= 0),
  -- The fade when the sound stops (toggle off, hold released).
  fade_ms INTEGER NOT NULL DEFAULT 1500 CHECK (fade_ms >= 0),
  CHECK ((grid_row IS NULL) = (grid_col IS NULL)),
  CHECK ((grid_row IS NULL) <> (spare_position IS NULL))
);

-- The library tracks a pad plays, in order. Kept when the pad switches between
-- one file and variants, so switching back loses nothing.
CREATE TABLE pad_sounds (
  pad_id TEXT NOT NULL REFERENCES pads (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (pad_id, track_id)
);

-- A dynamic playlist's conditions, in order; every condition must match. Deleting
-- the tag group a condition looks at deletes the condition.
CREATE TABLE rule_conditions (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES tag_groups (id) ON DELETE CASCADE,
  match TEXT NOT NULL CHECK (match IN ('any', 'all', 'none')),
  position REAL NOT NULL
);

-- The tags a condition names, in order. group_id repeats the condition's group
-- deliberately (docs/data-model.md) so that both composite keys hold, which makes
-- the schema guarantee a value is a tag of the condition's group. A renamed tag is
-- renamed in every rule by its key; a deleted tag leaves every rule (CASCADE).
CREATE TABLE rule_condition_tags (
  condition_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  position REAL NOT NULL,
  PRIMARY KEY (condition_id, tag_id),
  FOREIGN KEY (condition_id, group_id) REFERENCES rule_conditions (id, group_id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, tag_id) REFERENCES tags (group_id, id) ON DELETE CASCADE
);

-- Campaigns > sessions > scenes (ORG-7).
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT ${COLOR("color")},
  notes TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'candle' CHECK (theme IN ('fern', 'hearth', 'candle', 'parchment', 'elysium')),
  system TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Obsidian links (not used yet): the vault, the campaign's note, the folder of session notes.
  obsidian_vault TEXT NOT NULL DEFAULT '',
  obsidian_note TEXT NOT NULL DEFAULT '',
  obsidian_sessions TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  -- "Session 14": unique within the campaign (a natural key).
  number INTEGER NOT NULL CHECK (number >= 0),
  name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  -- Calendar date YYYY-MM-DD, planned or played.
  session_date TEXT CHECK (session_date IS NULL OR session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('played', 'next', 'draft')),
  note_link TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- One line: when the scene starts, for example "Roll initiative".
  starts_when TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  note_link TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- What a campaign and a session use all along, in order; the library itself is shared.
CREATE TABLE campaign_playlists (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, playlist_id)
);

CREATE TABLE campaign_boards (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, board_id)
);

CREATE TABLE session_playlists (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (session_id, playlist_id)
);

CREATE TABLE session_boards (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (session_id, board_id)
);

-- A scene's music, in playing order: tracks and playlists in any mix; one may come twice.
CREATE TABLE scene_music (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  CHECK ((track_id IS NULL) <> (playlist_id IS NULL))
);

-- A scene's one ambience item; no row means none.
CREATE TABLE scene_ambience (
  scene_id TEXT PRIMARY KEY REFERENCES scenes (id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  CHECK ((track_id IS NULL) <> (playlist_id IS NULL))
);

-- A scene's pad boards in order; the first shows when the scene starts.
CREATE TABLE scene_boards (
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (scene_id, board_id)
);

-- Audio profiles (PLY-12): a track's own (no place), or its own in one playlist
-- or one scene (an override). A NULL setting means "the default" (resolveProfile
-- in src/common/domain), so a profile with every setting NULL is valid.
CREATE TABLE audio_profiles (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes (id) ON DELETE CASCADE,
  start_ms INTEGER CHECK (start_ms >= 0),
  end_ms INTEGER CHECK (end_ms >= 0),
  after_end TEXT CHECK (after_end IN ('loop', 'next', 'stop')),
  loop_start_ms INTEGER CHECK (loop_start_ms >= 0),
  loop_crossfade_ms INTEGER CHECK (loop_crossfade_ms >= 0),
  fade_in_ms INTEGER CHECK (fade_in_ms >= 0),
  fade_in_shape REAL CHECK (fade_in_shape BETWEEN 0 AND 100),
  fade_out_ms INTEGER CHECK (fade_out_ms >= 0),
  fade_out_shape REAL CHECK (fade_out_shape BETWEEN 0 AND 100),
  CHECK (playlist_id IS NULL OR scene_id IS NULL),
  CHECK ((fade_in_ms IS NULL) = (fade_in_shape IS NULL)),
  CHECK ((fade_out_ms IS NULL) = (fade_out_shape IS NULL)),
  CHECK (start_ms IS NULL OR end_ms IS NULL OR start_ms < end_ms),
  CHECK (loop_start_ms IS NULL OR end_ms IS NULL OR loop_start_ms < end_ms),
  CHECK (loop_start_ms IS NULL OR start_ms IS NULL OR loop_start_ms >= start_ms)
);

-- Named points of one profile, in order (PLY-12). Separate from a track's markers
-- (DAT-3), which are searchable; a profile's markers belong to that profile and may differ per place.
CREATE TABLE audio_profile_markers (
  profile_id TEXT NOT NULL REFERENCES audio_profiles (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  at_ms INTEGER NOT NULL CHECK (at_ms >= 0),
  label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (profile_id, position)
);

-- Long jobs that must run once and survive a crash (moving the old player's library in,
-- ../import/legacy.ts): their state and a JSON report. Bookkeeping, written outside undo.
CREATE TABLE library_jobs (
  -- For example 'legacy-player'.
  name TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('running', 'done')),
  -- The job's own record (what it has done, its report), read whole.
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- Full-text search (ORG-1). One document per searchable row; doc_id is the FTS rowid
-- (text ids cannot be FTS rowids). Derived: written only by the search triggers.
CREATE TABLE search_docs (
  doc_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE VIRTUAL TABLE search_fts USING fts5 (
  title, meta_title, file_name, artist, album, tags, markers, notes, cue,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);
`;

/**
 * Every index of the library, each with the read path it serves. "Uses of"
 * paths are the "Used in" lists and the questions asked before deleting;
 * ON DELETE CASCADE and SET NULL use the same indexes to find child rows.
 */
const INDEXES = `
-- Natural keys.
CREATE UNIQUE INDEX library_roots_name ON library_roots (name COLLATE NOCASE);
CREATE UNIQUE INDEX tag_groups_name ON tag_groups (name COLLATE NOCASE);
CREATE UNIQUE INDEX tags_name ON tags (group_id, name COLLATE NOCASE);
CREATE UNIQUE INDEX sessions_number ON sessions (campaign_id, number);
-- At most one next session per campaign.
CREATE UNIQUE INDEX sessions_next ON sessions (campaign_id) WHERE status = 'next';

-- Library: tracks of a lane, sorted by energy (dynamic playlists without tag conditions, the kind filter).
CREATE INDEX tracks_kind ON tracks (kind, energy);
-- FX lane: stings are music tracks with role sting, so "kind = 'fx' OR role = 'sting'" reads both
-- this index and tracks_kind (an OR of two index searches) instead of every track.
CREATE INDEX tracks_role ON tracks (role, energy) WHERE role IS NOT NULL;
-- Library: tracks under a library folder (moving the folder, relinking files).
CREATE INDEX tracks_root ON tracks (root_id) WHERE root_id IS NOT NULL;
-- Library: finding a file again by name (relinking, DAT-8).
CREATE INDEX tracks_file_name ON tracks (file_name COLLATE NOCASE);
-- The Library's "New, not tagged yet" filter and its count (NEW_TRACKS_SQL, repo/tracks.ts).
CREATE INDEX tracks_new ON tracks (is_new) WHERE is_new = 1;
-- Tracks by tag: dynamic playlists and the library's tag filter.
CREATE INDEX track_tags_tag ON track_tags (tag_id);
-- A track's markers in time order.
CREATE INDEX markers_track ON markers (track_id, time_ms);
-- "Follow with" suggestions pointing at a track (uses of a track).
CREATE INDEX track_follow_with_target ON track_follow_with (follow_track_id);
CREATE UNIQUE INDEX track_follow_with_order ON track_follow_with (track_id, position);

-- Tag groups and tags in order; tags below a tag.
CREATE UNIQUE INDEX tag_groups_order ON tag_groups (position);
CREATE UNIQUE INDEX tags_order ON tags (group_id, position);
CREATE INDEX tags_parent ON tags (parent_id) WHERE parent_id IS NOT NULL;
-- Target of rule_condition_tags' (group, tag) key.
CREATE UNIQUE INDEX tags_group_id ON tags (group_id, id);

-- A folder's subfolders, playlists and boards in order (NULL parent or folder = top level).
CREATE UNIQUE INDEX folders_order ON folders (scope, coalesce(parent_id, ''), position);
CREATE UNIQUE INDEX playlists_order ON playlists (coalesce(folder_id, ''), position);
CREATE UNIQUE INDEX boards_order ON boards (coalesce(folder_id, ''), position);
-- A folder of sessions (moving its sessions up when it is deleted).
CREATE INDEX sessions_folder ON sessions (folder_id) WHERE folder_id IS NOT NULL;

-- A manual playlist's tracks in order.
CREATE UNIQUE INDEX playlist_items_order ON playlist_items (playlist_id, position);
-- Uses of a track in playlists.
CREATE INDEX playlist_items_track ON playlist_items (track_id) WHERE track_id IS NOT NULL;
-- A dynamic playlist's conditions in order, and each condition's tags in order.
CREATE UNIQUE INDEX rule_conditions_order ON rule_conditions (playlist_id, position);
-- Target of rule_condition_tags' (condition, group) key.
CREATE UNIQUE INDEX rule_conditions_group ON rule_conditions (id, group_id);
CREATE UNIQUE INDEX rule_condition_tags_order ON rule_condition_tags (condition_id, position);
-- Rules that name a tag (a tag deleted, merged or moved to another group; tagUsage), and the target
-- of the cascade from tags' (group, tag) key. tag_id first, so "tag_id = ?" alone can use it.
CREATE INDEX rule_condition_tags_tag ON rule_condition_tags (tag_id, group_id);

-- Drawing a board (all its pads, on the grid and spare) and deleting one (ON DELETE CASCADE):
-- the two partial indexes below cannot serve "board_id = ?" on its own.
CREATE INDEX pads_board ON pads (board_id);
-- A board's pads by cell (one per cell) and its spare pads in order.
CREATE UNIQUE INDEX pads_cell ON pads (board_id, grid_row, grid_col) WHERE grid_row IS NOT NULL;
CREATE UNIQUE INDEX pads_spare ON pads (board_id, spare_position) WHERE spare_position IS NOT NULL;
-- Pads that play a tag (a tag deleted).
CREATE INDEX pads_tag ON pads (sound_tag_id) WHERE sound_tag_id IS NOT NULL;
-- A pad's sounds in order; uses of a track on pads.
CREATE UNIQUE INDEX pad_sounds_order ON pad_sounds (pad_id, position);
CREATE INDEX pad_sounds_track ON pad_sounds (track_id);

-- Campaign tree: campaigns, a campaign's sessions, a session's scenes, each in order.
CREATE UNIQUE INDEX campaigns_order ON campaigns (position);
CREATE UNIQUE INDEX sessions_order ON sessions (campaign_id, position);
CREATE UNIQUE INDEX scenes_order ON scenes (session_id, position);
-- Campaign tree: a campaign's and a session's playlists and boards in order; uses of a playlist / board.
CREATE UNIQUE INDEX campaign_playlists_order ON campaign_playlists (campaign_id, position);
CREATE INDEX campaign_playlists_playlist ON campaign_playlists (playlist_id);
CREATE UNIQUE INDEX campaign_boards_order ON campaign_boards (campaign_id, position);
CREATE INDEX campaign_boards_board ON campaign_boards (board_id);
CREATE UNIQUE INDEX session_playlists_order ON session_playlists (session_id, position);
CREATE INDEX session_playlists_playlist ON session_playlists (playlist_id);
CREATE UNIQUE INDEX session_boards_order ON session_boards (session_id, position);
CREATE INDEX session_boards_board ON session_boards (board_id);
-- A scene's music in order (scene view, campaign tree, the engine's scene sequence); uses of a track / playlist.
CREATE UNIQUE INDEX scene_music_order ON scene_music (scene_id, position);
CREATE INDEX scene_music_track ON scene_music (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX scene_music_playlist ON scene_music (playlist_id) WHERE playlist_id IS NOT NULL;
-- Uses of a track / playlist as a scene's ambience.
CREATE INDEX scene_ambience_track ON scene_ambience (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX scene_ambience_playlist ON scene_ambience (playlist_id) WHERE playlist_id IS NOT NULL;
-- A scene's boards in order; uses of a board.
CREATE UNIQUE INDEX scene_boards_order ON scene_boards (scene_id, position);
CREATE INDEX scene_boards_board ON scene_boards (board_id);

-- Profile lookup by (track, place): one profile per track per place.
CREATE UNIQUE INDEX audio_profiles_own ON audio_profiles (track_id) WHERE playlist_id IS NULL AND scene_id IS NULL;
CREATE UNIQUE INDEX audio_profiles_playlist ON audio_profiles (playlist_id, track_id) WHERE playlist_id IS NOT NULL;
CREATE UNIQUE INDEX audio_profiles_scene ON audio_profiles (scene_id, track_id) WHERE scene_id IS NOT NULL;
-- A track's profiles in every place (profile screen; a track deleted).
CREATE INDEX audio_profiles_track ON audio_profiles (track_id);
`;

/**
 * Rules a CHECK cannot express because they span two tables: a manual playlist
 * has no conditions and a dynamic one no entries, and a playlist keeps its kind.
 * A missing playlist (rows replayed by undo, child first) is left to the foreign key.
 * A new track settles (is no longer New) once it has a title of its own and a tag,
 * as the prototype's `settle` does; undo puts the mark back, since trigger writes are captured.
 */
const INTEGRITY_TRIGGERS = `
CREATE TRIGGER rule_conditions_dynamic_only BEFORE INSERT ON rule_conditions
  WHEN (SELECT kind FROM playlists WHERE id = NEW.playlist_id) = 'manual'
  BEGIN SELECT RAISE(ABORT, 'A manual playlist has no rule.'); END;
CREATE TRIGGER playlist_items_manual_only BEFORE INSERT ON playlist_items
  WHEN (SELECT kind FROM playlists WHERE id = NEW.playlist_id) = 'dynamic'
  BEGIN SELECT RAISE(ABORT, 'A dynamic playlist chooses its own tracks.'); END;
CREATE TRIGGER playlists_kind_fixed BEFORE UPDATE OF kind ON playlists
  WHEN OLD.kind <> NEW.kind
  BEGIN SELECT RAISE(ABORT, 'A playlist keeps its kind; copy it to change it.'); END;

CREATE TRIGGER tracks_settle_on_title AFTER UPDATE OF title ON tracks
  WHEN NEW.is_new = 1 AND NEW.title <> '' AND EXISTS (SELECT 1 FROM track_tags WHERE track_id = NEW.id)
  BEGIN UPDATE tracks SET is_new = 0 WHERE id = NEW.id; END;
CREATE TRIGGER tracks_settle_on_tag AFTER INSERT ON track_tags
  WHEN EXISTS (SELECT 1 FROM tracks WHERE id = NEW.track_id AND is_new = 1 AND title <> '')
  BEGIN UPDATE tracks SET is_new = 0 WHERE id = NEW.track_id; END;
`;

/*
 * Search triggers. search_fts is a derived copy, the one denormalisation made
 * for speed; search_docs maps its rowid to the row's kind and id.
 * Track columns: the name shown for it, the file-tag title, the file name, the
 * artist, the album, tag names with synonyms, marker labels, notes, the cue number.
 */

/** SQL that rebuilds the search documents of the tracks whose ids `ids` gives (a list or a SELECT). */
function refreshTrackDocs(ids: string): string {
  return `
    DELETE FROM search_fts WHERE rowid IN
      (SELECT doc_id FROM search_docs WHERE kind = 'track' AND ref_id IN (${ids}));
    INSERT OR IGNORE INTO search_docs (kind, ref_id) SELECT 'track', id FROM tracks WHERE id IN (${ids});
    INSERT INTO search_fts (rowid, title, meta_title, file_name, artist, album, tags, markers, notes, cue)
      SELECT d.doc_id, coalesce(nullif(t.title, ''), nullif(t.meta_title, ''), t.file_name), t.meta_title, t.file_name,
        t.source_composer, t.source_album,
        (SELECT group_concat(tg.name || coalesce(' ' ||
            (SELECT group_concat(s.synonym, ' ') FROM tag_synonyms s WHERE s.tag_id = tg.id), ''), ' ')
           FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.track_id = t.id),
        (SELECT group_concat(m.label, ' ') FROM markers m WHERE m.track_id = t.id),
        t.notes, t.source_cue_number
      FROM tracks t JOIN search_docs d ON d.kind = 'track' AND d.ref_id = t.id
      WHERE t.id IN (${ids});`;
}

function removeDoc(kind: string, id: string): string {
  return `
    DELETE FROM search_fts WHERE rowid = (SELECT doc_id FROM search_docs WHERE kind = '${kind}' AND ref_id = ${id});
    DELETE FROM search_docs WHERE kind = '${kind}' AND ref_id = ${id};`;
}

/** Rows found by a title (or name) and, for some, notes. */
const SIMPLE_DOCS: [kind: string, table: string, title: string, notes: string | null][] = [
  ["playlist", "playlists", "title", "notes"],
  ["board", "boards", "title", null],
  ["campaign", "campaigns", "name", "notes"],
  ["session", "sessions", "name", "notes"],
  ["scene", "scenes", "name", "notes"],
];

function simpleDoc(kind: string, title: string, notes: string | null): string {
  return `
    DELETE FROM search_fts WHERE rowid = (SELECT doc_id FROM search_docs WHERE kind = '${kind}' AND ref_id = NEW.id);
    INSERT OR IGNORE INTO search_docs (kind, ref_id) VALUES ('${kind}', NEW.id);
    INSERT INTO search_fts (rowid, title, notes)
      SELECT doc_id, NEW.${title}, ${notes ? `NEW.${notes}` : "''"} FROM search_docs WHERE kind = '${kind}' AND ref_id = NEW.id;`;
}

function searchTriggers(): string {
  const simple = SIMPLE_DOCS.map(
    ([kind, table, title, notes]) => `
CREATE TRIGGER ${table}_search_insert AFTER INSERT ON ${table} BEGIN ${simpleDoc(kind, title, notes)} END;
CREATE TRIGGER ${table}_search_update AFTER UPDATE OF ${notes ? `${title}, ${notes}` : title} ON ${table}
  BEGIN ${simpleDoc(kind, title, notes)} END;
CREATE TRIGGER ${table}_search_delete AFTER DELETE ON ${table} BEGIN ${removeDoc(kind, "OLD.id")} END;`,
  ).join("\n");
  return `
CREATE TRIGGER tracks_search_insert AFTER INSERT ON tracks BEGIN ${refreshTrackDocs("NEW.id")} END;
CREATE TRIGGER tracks_search_update
  AFTER UPDATE OF title, meta_title, file_name, notes, source_composer, source_album, source_cue_number ON tracks
  BEGIN ${refreshTrackDocs("NEW.id")} END;
CREATE TRIGGER tracks_search_delete AFTER DELETE ON tracks BEGIN ${removeDoc("track", "OLD.id")} END;
CREATE TRIGGER track_tags_search_insert AFTER INSERT ON track_tags BEGIN ${refreshTrackDocs("NEW.track_id")} END;
CREATE TRIGGER track_tags_search_delete AFTER DELETE ON track_tags BEGIN ${refreshTrackDocs("OLD.track_id")} END;
CREATE TRIGGER tags_search_rename AFTER UPDATE OF name ON tags
  BEGIN ${refreshTrackDocs("SELECT track_id FROM track_tags WHERE tag_id = NEW.id")} END;
CREATE TRIGGER tag_synonyms_search_insert AFTER INSERT ON tag_synonyms
  BEGIN ${refreshTrackDocs("SELECT track_id FROM track_tags WHERE tag_id = NEW.tag_id")} END;
CREATE TRIGGER tag_synonyms_search_delete AFTER DELETE ON tag_synonyms
  BEGIN ${refreshTrackDocs("SELECT track_id FROM track_tags WHERE tag_id = OLD.tag_id")} END;
CREATE TRIGGER markers_search_insert AFTER INSERT ON markers BEGIN ${refreshTrackDocs("NEW.track_id")} END;
CREATE TRIGGER markers_search_update AFTER UPDATE OF label, track_id ON markers
  BEGIN ${refreshTrackDocs("NEW.track_id, OLD.track_id")} END;
CREATE TRIGGER markers_search_delete AFTER DELETE ON markers BEGIN ${refreshTrackDocs("OLD.track_id")} END;
${simple}`;
}

function offerDefaultTags(db: DatabaseSync) {
  const addGroup = db.prepare("INSERT INTO tag_groups (id, name, position) VALUES (?, ?, ?)");
  const addTag = db.prepare("INSERT INTO tags (id, group_id, name, position) VALUES (?, ?, ?, ?)");
  DEFAULT_TAG_GROUPS.forEach((name, index) => {
    const groupId = randomUUID();
    addGroup.run(groupId, name, (index + 1) * GAP);
    if (name === "Mood") DEFAULT_MOOD_TAGS.forEach((tag, tagIndex) => addTag.run(randomUUID(), groupId, tag, (tagIndex + 1) * GAP));
  });
}

export const v001Library: Migration = {
  version: 1,
  name: "library: tracks, tags, playlists, pad boards, campaigns, audio profiles and search",
  up(db) {
    db.exec(TABLES);
    db.exec(INDEXES);
    db.exec(INTEGRITY_TRIGGERS);
    db.exec(searchTriggers());
    offerDefaultTags(db);
  },
};
