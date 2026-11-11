/**
 * Schema version 3 (wave 4, design round 5: design/prototype/ROUND5.md). docs/data-model.md "Version 3" explains each
 * table, key and index.
 *
 * - Play order per place (PLY-13): `play_orders`, one row per playlist and place (the playlist's own order when no
 *   place is named, else one scene, one session list or one campaign list). No row: the defaults of
 *   resolvePlayOrder (src/common/domain/round5.ts).
 * - A track's name in a scene (DAT-14): `scene_track_names`. The names are searchable: they join the track's search
 *   entry in a new `scene_names` column of search_fts (a game master who named a track "The wight rises" types that).
 * - Track shape (DAT-13): `tracks.shape` is the game master's choice (NULL: follow the suggestion);
 *   `track_peaks.suggested_shape` is the suggestion shapeFromPeaks makes from those peaks, written with them, so the
 *   Shape filter and dynamic rules read coalesce(chosen, suggested) without reading the levels. `rule_shapes` holds the
 *   shapes a dynamic playlist asks for (none: any shape).
 * - Tracks on hand (ORG-12): `campaign_tracks`, `session_tracks`, like the playlist and board link tables.
 * - A session list's own audio settings (PLY-14): `audio_profiles.session_id` (the table is rebuilt so its CHECK says
 *   "at most one place").
 * - Pads put aside by hand (SFX-11): `pads.put_aside` (only a spare pad can be aside; reflowBoard's isAside).
 *
 * Frozen once released: later changes go in a new step. The search triggers below are copied, never imported.
 */
// The suggestion is derived data (as the peaks are): a later change to the rule may give other suggestions, which is
// what the game master would see anyway the next time the peaks are worked out.
import { shapeFromPeaks } from "../../../common/domain/round5";
import type { DatabaseSync } from "../sqlite";
import { rebuildTable, type Migration } from "./migrate";

/** The five shapes (src/common/domain TRACK_SHAPES), written into this step so it never changes with that list. */
const SHAPES = "'steady', 'builds', 'fallsAway', 'peaksThenFalls', 'risesAndFalls'";

const TABLES = `
-- PLY-13: how a playlist plays in one place, or its own order (no place). At most one place.
CREATE TABLE play_orders (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns (id) ON DELETE CASCADE,
  shuffle INTEGER NOT NULL CHECK (shuffle IN (0, 1)),
  repeat TEXT NOT NULL CHECK (repeat IN ('off', 'all', 'one')),
  CHECK ((scene_id IS NOT NULL) + (session_id IS NOT NULL) + (campaign_id IS NOT NULL) <= 1)
);

-- DAT-14: the name a track has in one scene. Blank names are not stored (no row: the track's own name).
CREATE TABLE scene_track_names (
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200 AND name = trim(name)),
  PRIMARY KEY (scene_id, track_id)
) WITHOUT ROWID;

-- DAT-13: the shapes a dynamic playlist asks for; a track matches when its shape is one of them.
CREATE TABLE rule_shapes (
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  shape TEXT NOT NULL CHECK (shape IN (${SHAPES})),
  PRIMARY KEY (playlist_id, shape)
) WITHOUT ROWID;

-- ORG-12: single tracks kept on hand all campaign long, or for one session, in order.
CREATE TABLE campaign_tracks (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (campaign_id, track_id)
) WITHOUT ROWID;
CREATE TABLE session_tracks (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (session_id, track_id)
) WITHOUT ROWID;
`;

/** audio_profiles with the session place (PLY-14); every other column and check as in version 1. */
const AUDIO_PROFILES = `
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
  -- PLY-14: a session list's own settings for the track.
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  CHECK ((playlist_id IS NOT NULL) + (scene_id IS NOT NULL) + (session_id IS NOT NULL) <= 1),
  CHECK ((fade_in_ms IS NULL) = (fade_in_shape IS NULL)),
  CHECK ((fade_out_ms IS NULL) = (fade_out_shape IS NULL)),
  CHECK (start_ms IS NULL OR end_ms IS NULL OR start_ms < end_ms),
  CHECK (loop_start_ms IS NULL OR end_ms IS NULL OR loop_start_ms < end_ms),
  CHECK (loop_start_ms IS NULL OR start_ms IS NULL OR loop_start_ms >= start_ms)`;
const AUDIO_PROFILE_COLUMNS = ["id", "track_id", "playlist_id", "scene_id", "start_ms", "end_ms", "after_end", "loop_start_ms", "loop_crossfade_ms",
  "fade_in_ms", "fade_in_shape", "fade_out_ms", "fade_out_shape"];

/**
 * track_peaks with the suggested shape before the levels: SQLite reads a row's columns in order, and a level BLOB of
 * about 1 KB can spill into overflow pages, so the shape is kept ahead of it and read without them.
 */
const TRACK_PEAKS = `
  track_id TEXT PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
  file_mtime_ms INTEGER,
  -- DAT-13: the shape shapeFromPeaks suggests from these levels; NULL with NULL levels or too few points.
  suggested_shape TEXT CHECK (suggested_shape IS NULL OR suggested_shape IN (${SHAPES})),
  levels BLOB CHECK (levels IS NULL OR (typeof(levels) = 'blob' AND length(levels) BETWEEN 1 AND 4096)),
  worked_out_at INTEGER NOT NULL,
  CHECK (levels IS NOT NULL OR suggested_shape IS NULL)`;

const INDEXES = `
-- PLY-13: a playlist's order in one place (PLAY_ORDER_LOOKUP_SQL), one row per playlist per place.
CREATE UNIQUE INDEX play_orders_own ON play_orders (playlist_id) WHERE scene_id IS NULL AND session_id IS NULL AND campaign_id IS NULL;
CREATE UNIQUE INDEX play_orders_scene ON play_orders (scene_id, playlist_id) WHERE scene_id IS NOT NULL;
CREATE UNIQUE INDEX play_orders_session ON play_orders (session_id, playlist_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX play_orders_campaign ON play_orders (campaign_id, playlist_id) WHERE campaign_id IS NOT NULL;
-- A playlist's orders everywhere (deleting it: ON DELETE CASCADE).
CREATE INDEX play_orders_playlist ON play_orders (playlist_id);

-- DAT-14: a track's names in every scene (Library details "Names in scenes", TRACK_SCENE_NAMES_SQL; a track deleted).
CREATE INDEX scene_track_names_track ON scene_track_names (track_id);

-- ORG-12: a campaign's and a session's tracks in order (campaign tree); uses of a track on hand.
CREATE UNIQUE INDEX campaign_tracks_order ON campaign_tracks (campaign_id, position);
CREATE INDEX campaign_tracks_track ON campaign_tracks (track_id);
CREATE UNIQUE INDEX session_tracks_order ON session_tracks (session_id, position);
CREATE INDEX session_tracks_track ON session_tracks (track_id);

-- DAT-13: the Shape filter (TRACKS_BY_SHAPE_SQL): tracks by the shape chosen, and by the shape suggested.
CREATE INDEX tracks_shape ON tracks (shape) WHERE shape IS NOT NULL;
CREATE INDEX track_peaks_shape ON track_peaks (suggested_shape) WHERE suggested_shape IS NOT NULL;

-- PLY-14: profile lookup by (track, session list), one per track per session.
CREATE UNIQUE INDEX audio_profiles_session ON audio_profiles (session_id, track_id) WHERE session_id IS NOT NULL;
`;

/** The playlists a rule shape or a playlist entry may belong to (as version 1's triggers for conditions and items). */
const INTEGRITY_TRIGGERS = `
CREATE TRIGGER rule_shapes_dynamic_only BEFORE INSERT ON rule_shapes
  WHEN (SELECT kind FROM playlists WHERE id = NEW.playlist_id) = 'manual'
  BEGIN SELECT RAISE(ABORT, 'A manual playlist has no rule.'); END;
CREATE TRIGGER rule_shapes_dynamic_only_move BEFORE UPDATE OF playlist_id ON rule_shapes
  WHEN (SELECT kind FROM playlists WHERE id = NEW.playlist_id) = 'manual'
  BEGIN SELECT RAISE(ABORT, 'A manual playlist has no rule.'); END;
`;

/**
 * search_fts with a tenth column, scene_names (DAT-14). FTS5 tables cannot gain columns, so it is made again; the
 * search triggers name it, and SQLite checks triggers when a table is dropped or renamed, so they step aside meanwhile.
 */
function addSceneNamesToSearch(db: DatabaseSync) {
  const triggers = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND sql LIKE '%search_fts%'").all() as { name: string; sql: string }[];
  for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`);
  db.exec(`
    CREATE VIRTUAL TABLE search_fts__v3 USING fts5 (
      title, meta_title, file_name, artist, album, tags, markers, notes, cue, scene_names,
      tokenize = 'unicode61 remove_diacritics 2',
      prefix = '1 2 3'
    );
    INSERT INTO search_fts__v3 (rowid, title, meta_title, file_name, artist, album, tags, markers, notes, cue, scene_names)
      SELECT rowid, title, meta_title, file_name, artist, album, tags, markers, notes, cue, '' FROM search_fts;
    DROP TABLE search_fts;
    ALTER TABLE search_fts__v3 RENAME TO search_fts;
  `);
  for (const t of triggers) db.exec(t.sql);
}

/** The suggestion for every track whose peaks were worked out before this step (levels are bytes, 0 to 255). */
function suggestShapes(db: DatabaseSync) {
  const rows = db.prepare("SELECT track_id, levels FROM track_peaks WHERE levels IS NOT NULL").all() as { track_id: string; levels: Uint8Array }[];
  const save = db.prepare("UPDATE track_peaks SET suggested_shape = ? WHERE track_id = ?");
  for (const row of rows) save.run(shapeFromPeaks(Array.from(row.levels, (b) => b / 255)), row.track_id);
}

export const v003Round5: Migration = {
  version: 3,
  name: "design round 5: play order per place, names in scenes, track shape, tracks on hand, session settings, pads put aside",
  up(db) {
    // Rebuilt first: rebuildTable drops and recreates every trigger, so the new triggers are added after it.
    rebuildTable(db, "audio_profiles", AUDIO_PROFILES, AUDIO_PROFILE_COLUMNS);
    rebuildTable(db, "track_peaks", TRACK_PEAKS, ["track_id", "file_size", "file_mtime_ms", "levels", "worked_out_at"], {
      withoutRowid: true,
    });
    db.exec(`ALTER TABLE tracks ADD COLUMN shape TEXT CHECK (shape IS NULL OR shape IN (${SHAPES}))`);
    // A pad the game master put among the spare pads by hand stays there when the grid grows (Nik, 5 Nov 2026).
    db.exec("ALTER TABLE pads ADD COLUMN put_aside INTEGER NOT NULL DEFAULT 0 CHECK (put_aside IN (0, 1) AND (put_aside = 0 OR spare_position IS NOT NULL))");
    db.exec(TABLES);
    db.exec(INDEXES);
    db.exec(INTEGRITY_TRIGGERS);
    addSceneNamesToSearch(db);
    suggestShapes(db);
  },
};
