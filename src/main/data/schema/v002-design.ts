/**
 * Schema version 2 (DAT-11): the agreed design, Lyre design round 4
 * (design/prototype; shapes in src/common/domain), normalised for this app's
 * read paths. docs/data-model.md explains every table, key, constraint and
 * index, the normal form each meets and the deliberate exceptions.
 *
 * Principles
 * - Third normal form: one fact in one place, no lists inside a column.
 *   Ordered relations are join tables with a REAL `position` (gap ordering,
 *   ../ordering.ts) that is UNIQUE within its list. A reference that may be a
 *   track or a playlist is two nullable foreign keys with a CHECK that exactly
 *   one is set, so ON DELETE rules work.
 * - JSON only for self-contained values the database never queries: a track's
 *   default transition in and out (version 1, read whole by the engine).
 *   Dynamic playlist rules, audio profiles and pad sounds are rows.
 * - Integrity in the schema: foreign keys with explicit ON DELETE, CHECK
 *   constraints for every list of choices and every range, UNIQUE natural keys
 *   and positions, a partial unique index for "one next session per campaign",
 *   and triggers only where a rule spans two tables. Version 1 checked choices
 *   in the repository so a choice could be added without rebuilding a table;
 *   this step rebuilds those tables with CHECKs, and a later choice is added
 *   the same way (rebuildTable).
 * - Every index serves a named read path (the comment above it).
 *
 * The step: drops version 1's triggers and indexes, rebuilds the version-1
 * tables that gain constraints or columns (copying every row), creates the new
 * tables, carries soundboard entries and scene items over, declares every
 * index, then rebuilds the search index and its triggers.
 * Frozen once released: later changes go in a new step.
 */
import type { DatabaseSync } from "../sqlite";
import { rebuildTable, type Migration } from "./migrate";

/** Gap between positions of rows created here (as ../ordering.ts GAP; kept here so this step never changes). */
const GAP = 1024;
/** Columns of the grid that version-1 soundboard sounds are laid out on. */
const CONVERTED_COLUMNS = 4;
const MAX_GRID = 8;

/** A colour written #rrggbb in lower case (validate.ts nullableColor), or NULL. */
const COLOR = (column: string) =>
  `CHECK (${column} IS NULL OR (length(${column}) = 7 AND ${column} GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))`;

/**
 * Version-1 tables rebuilt with their final definition: [table, columns and
 * constraints, version-1 columns copied]. Rows keep their order.
 */
const REBUILT: [table: string, definition: string, copied: string[]][] = [
  [
    "tracks",
    `id TEXT PRIMARY KEY,
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
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     CHECK ((path IS NULL) <> (url IS NULL)),
     CHECK (root_id IS NULL OR path IS NOT NULL)`,
    [
      "id", "title", "root_id", "path", "url", "file_name", "file_size", "file_mtime_ms", "checksum", "duration_ms",
      "energy", "arc", "role", "loopable", "ending", "transition_in", "transition_out", "follow_required", "notes",
      "source_composer", "source_album", "source_cue_number", "rating", "last_used_at", "created_at", "updated_at",
    ],
  ],
  [
    "markers",
    `id TEXT PRIMARY KEY,
     track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
     time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
     kind TEXT NOT NULL CHECK (kind IN ('marker', 'loop_in', 'loop_out', 'mix_out')),
     label TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL`,
    ["id", "track_id", "time_ms", "kind", "label", "created_at"],
  ],
  [
    "folders",
    `id TEXT PRIMARY KEY,
     scope TEXT NOT NULL CHECK (scope IN ('playlists', 'boards', 'sessions')),
     -- Deleting a folder moves its contents up first (repository); SET NULL is a safety net.
     parent_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
     name TEXT NOT NULL,
     color TEXT ${COLOR("color")},
     collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
     position REAL NOT NULL`,
    ["id", "scope", "parent_id", "name", "color", "collapsed", "position"],
  ],
  [
    "playlists",
    `id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
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
     CHECK (kind = 'dynamic' OR (rule_energy_min IS NULL AND rule_leave_out_stings = 0))`,
    ["id", "title", "background", "folder_id", "position", "created_at", "updated_at"],
  ],
  [
    "playlist_items",
    `id TEXT PRIMARY KEY,
     playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('track', 'divider')),
     track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
     label TEXT NOT NULL DEFAULT '',
     position REAL NOT NULL,
     CHECK ((kind = 'track') = (track_id IS NOT NULL))`,
    ["id", "playlist_id", "kind", "track_id", "label", "position"],
  ],
  [
    "boards",
    `id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     background TEXT NOT NULL DEFAULT '',
     folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
     position REAL NOT NULL,
     grid_cols INTEGER NOT NULL DEFAULT 4 CHECK (grid_cols BETWEEN 1 AND 8),
     grid_rows INTEGER NOT NULL DEFAULT 3 CHECK (grid_rows BETWEEN 1 AND 8),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL`,
    ["id", "title", "background", "folder_id", "position", "created_at", "updated_at"],
  ],
  [
    "campaigns",
    `id TEXT PRIMARY KEY,
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
     updated_at INTEGER NOT NULL`,
    ["id", "name", "color", "notes", "position", "created_at", "updated_at"],
  ],
  [
    "sessions",
    `id TEXT PRIMARY KEY,
     campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
     folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
     -- "Session 14": unique within the campaign (a natural key).
     number INTEGER NOT NULL CHECK (number >= 0),
     name TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     -- Calendar date YYYY-MM-DD, planned or played (version 1: played_on).
     session_date TEXT CHECK (session_date IS NULL OR session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('played', 'next', 'draft')),
     note_link TEXT NOT NULL DEFAULT '',
     position REAL NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL`,
    ["id", "campaign_id", "folder_id", "number", "name", "notes", "session_date", "status", "position", "created_at", "updated_at"],
  ],
  [
    "scenes",
    `id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
     name TEXT NOT NULL DEFAULT '',
     -- One line: when the scene starts, for example "Roll initiative".
     starts_when TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     note_link TEXT NOT NULL DEFAULT '',
     position REAL NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL`,
    ["id", "session_id", "name", "notes", "position", "created_at", "updated_at"],
  ],
  [
    "campaign_playlists",
    `campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
     playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
     position REAL NOT NULL DEFAULT 0,
     PRIMARY KEY (campaign_id, playlist_id)`,
    ["campaign_id", "playlist_id"],
  ],
  [
    "campaign_boards",
    `campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
     board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     position REAL NOT NULL DEFAULT 0,
     PRIMARY KEY (campaign_id, board_id)`,
    ["campaign_id", "board_id"],
  ],
];

const NEW_TABLES = `
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
  mode TEXT NOT NULL DEFAULT 'oneshot' CHECK (mode IN ('oneshot', 'toggle', 'hold', 'restart')),
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
-- (DAT-3), which are searchable and typed (loop in, mix out); a profile's markers
-- belong to that profile and may differ per place.
CREATE TABLE audio_profile_markers (
  profile_id TEXT NOT NULL REFERENCES audio_profiles (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  at_ms INTEGER NOT NULL CHECK (at_ms >= 0),
  label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (profile_id, position)
);
`;

/**
 * Every index of the library, each with the read path it serves. Version 1's
 * indexes are dropped first and the ones still wanted are declared again here,
 * so the whole list is in one place. "Uses of" paths are the "Used in" lists
 * and the questions asked before deleting; ON DELETE CASCADE and SET NULL use
 * the same indexes to find child rows.
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
-- Rules that name a tag (tag deleted or merged; a tag's "used in").
CREATE INDEX rule_condition_tags_tag ON rule_condition_tags (group_id, tag_id);

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
 */
const KIND_TRIGGERS = `
CREATE TRIGGER rule_conditions_dynamic_only BEFORE INSERT ON rule_conditions
  WHEN (SELECT kind FROM playlists WHERE id = NEW.playlist_id) = 'manual'
  BEGIN SELECT RAISE(ABORT, 'A manual playlist has no rule.'); END;
CREATE TRIGGER playlist_items_manual_only BEFORE INSERT ON playlist_items
  WHEN (SELECT kind FROM playlists WHERE id = NEW.playlist_id) = 'dynamic'
  BEGIN SELECT RAISE(ABORT, 'A dynamic playlist chooses its own tracks.'); END;
CREATE TRIGGER playlists_kind_fixed BEFORE UPDATE OF kind ON playlists
  WHEN OLD.kind <> NEW.kind
  BEGIN SELECT RAISE(ABORT, 'A playlist keeps its kind; copy it to change it.'); END;
`;

/*
 * Full-text search (ORG-1): one document per searchable row. search_fts is a
 * derived copy, the one denormalisation made for speed, kept in step by the
 * triggers below; search_docs maps its rowid to the row's kind and id.
 * Track columns: the name shown for it, the file-tag title, the file name, the
 * artist, the album, tag names with synonyms, marker labels, notes, the cue number.
 */
const SEARCH_TABLE = `
DROP TABLE search_fts;
DELETE FROM search_docs;
CREATE VIRTUAL TABLE search_fts USING fts5 (
  title, meta_title, file_name, artist, album, tags, markers, notes, cue,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);
`;

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

/** Fills the new search index from every searchable row. */
function reindex(db: DatabaseSync) {
  db.exec(refreshTrackDocs("SELECT id FROM tracks"));
  for (const [kind, table, title, notes] of SIMPLE_DOCS) {
    db.exec(`
      INSERT INTO search_docs (kind, ref_id) SELECT '${kind}', id FROM ${table};
      INSERT INTO search_fts (rowid, title, notes)
        SELECT d.doc_id, r.${title}, ${notes ? `r.${notes}` : "''"} FROM ${table} r
        JOIN search_docs d ON d.kind = '${kind}' AND d.ref_id = r.id;`);
  }
}

/** Numbers version-1 sessions in order within their campaign; one with a date was played. */
const NUMBER_SESSIONS = `
ALTER TABLE sessions RENAME COLUMN played_on TO session_date;
ALTER TABLE sessions ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
UPDATE sessions SET status = 'played' WHERE session_date IS NOT NULL;
UPDATE sessions SET number = (
  SELECT count(*) FROM sessions s2 WHERE s2.campaign_id = sessions.campaign_id
    AND (s2.position < sessions.position OR (s2.position = sessions.position AND s2.rowid <= sessions.rowid)));
`;

/** Gives the rebuilt campaign membership tables positions in the library's order of what they hold. */
function orderCampaignMembers(db: DatabaseSync) {
  for (const [table, column, parent] of [
    ["campaign_playlists", "playlist_id", "playlists"],
    ["campaign_boards", "board_id", "boards"],
  ] as const) {
    const rows = db
      .prepare(
        `SELECT m.campaign_id, m.${column} AS member FROM ${table} m JOIN ${parent} p ON p.id = m.${column}
         ORDER BY m.campaign_id, p.position, p.rowid`,
      )
      .all() as { campaign_id: string; member: string }[];
    const set = db.prepare(`UPDATE ${table} SET position = ? WHERE campaign_id = ? AND ${column} = ?`);
    let campaign = "";
    let index = 0;
    for (const row of rows) {
      index = row.campaign_id === campaign ? index + 1 : 1;
      campaign = row.campaign_id;
      set.run(index * GAP, row.campaign_id, row.member);
    }
  }
}

type BoardItemRow = {
  id: string;
  kind: string;
  track_id: string | null;
  track_title: string | null;
  loop: number;
  volume: number;
  fade_in_ms: number;
  fade_out_ms: number;
};

/**
 * Version-1 soundboard sounds become pads with the same ids, laid out in order
 * on a grid of four columns; a divider starts a new row (its label has no place
 * on a grid). A looping sound becomes a toggle pad. What does not fit on an
 * 8 x 8 grid waits among the spare pads.
 */
function convertBoardItems(db: DatabaseSync) {
  const boards = db.prepare("SELECT id FROM boards ORDER BY rowid").all() as { id: string }[];
  const items = db.prepare(
    `SELECT i.id, i.kind, i.track_id, coalesce(nullif(t.title, ''), t.file_name) AS track_title,
            i.loop, i.volume, i.fade_in_ms, i.fade_out_ms
     FROM board_items i LEFT JOIN tracks t ON t.id = i.track_id WHERE i.board_id = ? ORDER BY i.position, i.rowid`,
  );
  const setSize = db.prepare("UPDATE boards SET grid_cols = ?, grid_rows = ? WHERE id = ?");
  const addPad = db.prepare(
    `INSERT INTO pads (id, board_id, grid_row, grid_col, spare_position, label, mode, volume, fade_in_ms, fade_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const addSound = db.prepare("INSERT INTO pad_sounds (pad_id, track_id, position) VALUES (?, ?, ?)");
  for (const board of boards) {
    const placed: { item: BoardItemRow; slot: number }[] = [];
    let slot = 0;
    for (const item of items.all(board.id) as BoardItemRow[]) {
      if (item.kind !== "sound") {
        if (slot % CONVERTED_COLUMNS !== 0) slot += CONVERTED_COLUMNS - (slot % CONVERTED_COLUMNS);
        continue;
      }
      placed.push({ item, slot: slot++ });
    }
    if (placed.length === 0) continue;
    const rows = Math.min(MAX_GRID, Math.ceil((placed[placed.length - 1].slot + 1) / CONVERTED_COLUMNS));
    setSize.run(CONVERTED_COLUMNS, rows, board.id);
    let spare = 0;
    for (const { item, slot: at } of placed) {
      const onGrid = at < CONVERTED_COLUMNS * rows;
      addPad.run(
        item.id,
        board.id,
        onGrid ? Math.floor(at / CONVERTED_COLUMNS) : null,
        onGrid ? at % CONVERTED_COLUMNS : null,
        onGrid ? null : ++spare * GAP,
        item.track_title ?? "",
        item.loop === 1 ? "toggle" : "oneshot",
        item.volume,
        item.fade_in_ms,
        item.fade_out_ms,
      );
      addSound.run(item.id, item.track_id, GAP);
    }
  }
  db.exec("DROP TABLE board_items");
}

/** Version-1 scene items split into the ordered music list and the ordered board list. */
const SPLIT_SCENE_ITEMS = `
INSERT INTO scene_music (id, scene_id, track_id, playlist_id, position)
  SELECT id, scene_id, track_id, playlist_id, position FROM scene_items WHERE board_id IS NULL;
INSERT INTO scene_boards (scene_id, board_id, position)
  SELECT scene_id, board_id, min(position) FROM scene_items WHERE board_id IS NOT NULL GROUP BY scene_id, board_id;
DROP TABLE scene_items;
`;

/** Version 1 offered Location and Faction too; the design starts a new library with three groups. */
const GROUPS_NOT_OFFERED = ["Location", "Faction"];

function dropAll(db: DatabaseSync, type: "trigger" | "index") {
  const names = db.prepare(`SELECT name FROM sqlite_schema WHERE type = ? AND sql IS NOT NULL`).all(type) as { name: string }[];
  for (const { name } of names) db.exec(`DROP ${type.toUpperCase()} "${name}"`);
}

export const v002Design: Migration = {
  version: 2,
  name: "design round 4: lanes, dynamic playlists, pad grids, scene music lists and audio profiles",
  up(db, context) {
    // Version 1's triggers (all for search) and indexes are replaced below.
    dropAll(db, "trigger");
    dropAll(db, "index");
    // Values the rebuilt tables' CHECKs no longer accept, and the sessions' new facts.
    db.exec("UPDATE tracks SET loopable = 'crossfade' WHERE loopable = 'with_crossfade'");
    db.exec(NUMBER_SESSIONS);
    for (const [table, definition, copied] of REBUILT) rebuildTable(db, table, definition, copied);
    orderCampaignMembers(db);
    db.exec(NEW_TABLES);
    convertBoardItems(db);
    db.exec(SPLIT_SCENE_ITEMS);
    db.exec(INDEXES);
    db.exec(KIND_TRIGGERS);
    db.exec(SEARCH_TABLE);
    db.exec(searchTriggers());
    reindex(db);
    if (context.startVersion === 0) {
      const remove = db.prepare(
        "DELETE FROM tag_groups WHERE name = ? AND NOT EXISTS (SELECT 1 FROM tags WHERE tags.group_id = tag_groups.id)",
      );
      for (const name of GROUPS_NOT_OFFERED) remove.run(name);
    }
  },
};
