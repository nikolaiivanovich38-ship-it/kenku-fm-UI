/**
 * Schema version 6 (0.5.0, design round 7: design/prototype/ROUND7.md, each item's "Data" paragraph).
 * docs/data-model.md "Version 6" explains each table, key and index.
 *
 * - DAT-10, ORG-4: tag groups, tags and folders take a colour by name from the pad palette (the prototype's
 *   L.colors), as pads do; a colour of version 5 that is not one of those names is dropped (no screen wrote one).
 *   The vocabulary itself (groups in order, tags in order, a tag inside another, other words) is version 1's.
 * - ORG-4: `board_dividers`, a name above a row of a pad board. A playlist's dividers are version 1's
 *   playlist_items of kind 'divider'.
 * - PLY-8: `cue_lists`, one per scene or pad that has its own steps (no row: the usual ones, which are never stored),
 *   and `cue_steps`, its steps in order, each with exactly the facts its kind needs. Cue lists (SHW-1), shortcuts and
 *   remote buttons can own one later. `scene_moves_on`: a scene that starts the next one by itself.
 * - SHW-3: `track_follows`, what plays when a track ends (a track or a playlist). Version 1's `track_follow_with`
 *   (a list of suggestions nothing showed) gives each track its first suggestion and is no longer read.
 * - PLY-4: `tracks.resume` (Pick up where it stopped). Ending "Fades out" is version 1's `tracks.ending = 'fades'`.
 * - DAT-3: `audio_profile_markers.mix_out`, at most one per profile: where the next track crossfades in.
 * - UX-12: `shortcut_keys`, only the keys the game master changed; PLY-8, UX-12: the crossfade between tracks and
 *   Next scene's guard as columns of the one-row `library_settings`.
 * - UX-12 Find and play: pads get search entries (their label), kept by triggers like boards'.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";
import { rebuildTable } from "./migrate";

/** The pad palette (src/common/lyre/api.ts PAD_COLORS), written into this step so it never changes with that list. */
const PALETTE = "'steel', 'ember', 'gold', 'moss', 'violet', 'plum', 'sea', 'bone'";
const PALETTE_COLOR = (column: string) => `CHECK (${column} IS NULL OR ${column} IN (${PALETTE}))`;
/** The kinds of step (src/common/domain/round7.ts CUE_STEP_KINDS) and their choices, likewise. */
const ACTIONS = "'music', 'ambience', 'board', 'sound', 'play', 'stop', 'fade', 'wait', 'pad', 'scene'";
const HOWS = "'crossfade', 'cut', 'trackEnds', 'mixOut', 'loopEnds'";
const UP_NEXTS = "'replace', 'playNext', 'addToQueue'";
/** SHORTCUT_ACTIONS' ids. */
const SHORTCUTS = "'palette', 'nextScene', 'fadeAll', 'undo', 'find', 'boxes', 'back', 'help'";

const TABLES = `
-- ORG-4: a name above a row of pads (row 0 is the top row). A divider above a row the grid no longer has stays, and
-- shows again when the grid grows, as spare pads come back.
CREATE TABLE board_dividers (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  grid_row INTEGER NOT NULL CHECK (grid_row BETWEEN 0 AND 7),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  PRIMARY KEY (board_id, grid_row)
) WITHOUT ROWID;

-- PLY-8: the own steps of one scene's start or one pad. No row: the usual steps (src/common/domain usualSceneSteps,
-- usualPadSteps). A row with no steps: it does nothing of its own (the game master removed every step).
CREATE TABLE cue_lists (
  id TEXT PRIMARY KEY,
  scene_id TEXT UNIQUE REFERENCES scenes (id) ON DELETE CASCADE,
  pad_id TEXT UNIQUE REFERENCES pads (id) ON DELETE CASCADE,
  CHECK ((scene_id IS NOT NULL) + (pad_id IS NOT NULL) = 1)
);

-- PLY-8: one step, in order. What it acts on is a foreign key, so a step whose track, playlist, board, pad or scene is
-- deleted goes too (it could do nothing), in the same undo step. Each kind has exactly the facts it needs.
CREATE TABLE cue_steps (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES cue_lists (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  action TEXT NOT NULL CHECK (action IN (${ACTIONS})),
  -- music (the scene's music from this item on), ambience, play: a track or a playlist.
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  -- board: the pad board to show.
  board_id TEXT REFERENCES boards (id) ON DELETE CASCADE,
  -- pad: the pad to fire (its board follows from it); scene: the scene to start (its session and campaign follow).
  target_pad_id TEXT REFERENCES pads (id) ON DELETE CASCADE,
  target_scene_id TEXT REFERENCES scenes (id) ON DELETE CASCADE,
  stop_what TEXT CHECK (stop_what IN ('music', 'ambience', 'all')),
  -- music and play: how it comes in, what it does to Up next, and where in the file it starts (NULL: the start).
  comes_in TEXT CHECK (comes_in IN (${HOWS})),
  up_next TEXT CHECK (up_next IN (${UP_NEXTS})),
  from_ms INTEGER CHECK (from_ms >= 0),
  -- fade: the music's level, 0 to 1, over duration_ms; wait: duration_ms (at most 10 minutes).
  level REAL CHECK (level BETWEEN 0 AND 1),
  duration_ms INTEGER CHECK (duration_ms BETWEEN 0 AND 600000),
  CHECK ((track_id IS NOT NULL) + (playlist_id IS NOT NULL) = (action IN ('music', 'ambience', 'play'))),
  CHECK ((board_id IS NOT NULL) = (action = 'board')),
  CHECK ((target_pad_id IS NOT NULL) = (action = 'pad')),
  CHECK ((target_scene_id IS NOT NULL) = (action = 'scene')),
  CHECK ((stop_what IS NOT NULL) = (action = 'stop')),
  CHECK ((comes_in IS NOT NULL) = (action IN ('music', 'play'))),
  CHECK ((up_next IS NOT NULL) = (action IN ('music', 'play'))),
  CHECK (from_ms IS NULL OR action IN ('music', 'play')),
  CHECK ((level IS NOT NULL) = (action = 'fade')),
  CHECK ((duration_ms IS NOT NULL) = (action IN ('fade', 'wait'))),
  CHECK (action <> 'fade' OR duration_ms <= 60000)
);

-- PLY-8 "Then": a scene that starts the next scene by itself (no row: it stays until Next).
CREATE TABLE scene_moves_on (
  scene_id TEXT PRIMARY KEY REFERENCES scenes (id) ON DELETE CASCADE,
  moves_on TEXT NOT NULL CHECK (moves_on IN ('musicEnds', 'after')),
  -- 'after': how long after the scene starts (1 second to 6 hours).
  after_ms INTEGER CHECK (after_ms BETWEEN 1000 AND 21600000),
  CHECK ((moves_on = 'after') = (after_ms IS NOT NULL))
) WITHOUT ROWID;

-- SHW-3: what plays when the track ends, unless something is already waiting (one track or one playlist).
CREATE TABLE track_follows (
  track_id TEXT PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  follow_track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  follow_playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  CHECK ((follow_track_id IS NULL) <> (follow_playlist_id IS NULL)),
  CHECK (follow_track_id IS NOT track_id)
) WITHOUT ROWID;

-- UX-12: a key the game master gave an action (only the changed ones; the rest keep Lyre's key).
CREATE TABLE shortcut_keys (
  action TEXT PRIMARY KEY CHECK (action IN (${SHORTCUTS})),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 40)
) WITHOUT ROWID;

-- PLY-4: Pick up where it stopped.
ALTER TABLE tracks ADD COLUMN resume INTEGER NOT NULL DEFAULT 0 CHECK (resume IN (0, 1));
-- DAT-3: the mix-out marker.
ALTER TABLE audio_profile_markers ADD COLUMN mix_out INTEGER NOT NULL DEFAULT 0 CHECK (mix_out IN (0, 1));
-- PLY-8: Settings › Sound to Discord › Between tracks; UX-12: Next scene ignores a second press within a second.
ALTER TABLE library_settings ADD COLUMN crossfade_ms INTEGER NOT NULL DEFAULT 3000 CHECK (crossfade_ms BETWEEN 0 AND 20000);
ALTER TABLE library_settings ADD COLUMN crossfade_curve TEXT NOT NULL DEFAULT 'even' CHECK (crossfade_curve IN ('even', 'power'));
ALTER TABLE library_settings ADD COLUMN next_scene_guard INTEGER NOT NULL DEFAULT 1 CHECK (next_scene_guard IN (0, 1));
`;

const INDEXES = `
-- PLY-8: a list's steps in order (CUE_STEPS_SQL), one step per position.
CREATE UNIQUE INDEX cue_steps_order ON cue_steps (list_id, position);
-- What a step acts on (ON DELETE CASCADE when it is deleted; "Used in" later).
CREATE INDEX cue_steps_track ON cue_steps (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX cue_steps_playlist ON cue_steps (playlist_id) WHERE playlist_id IS NOT NULL;
CREATE INDEX cue_steps_board ON cue_steps (board_id) WHERE board_id IS NOT NULL;
CREATE INDEX cue_steps_pad ON cue_steps (target_pad_id) WHERE target_pad_id IS NOT NULL;
CREATE INDEX cue_steps_scene ON cue_steps (target_scene_id) WHERE target_scene_id IS NOT NULL;
-- SHW-3: what follows with a track or playlist (ON DELETE CASCADE).
CREATE INDEX track_follows_track ON track_follows (follow_track_id) WHERE follow_track_id IS NOT NULL;
CREATE INDEX track_follows_playlist ON track_follows (follow_playlist_id) WHERE follow_playlist_id IS NOT NULL;
-- DAT-3: one mix-out marker per profile.
CREATE UNIQUE INDEX audio_profile_markers_mix ON audio_profile_markers (profile_id) WHERE mix_out = 1;
-- UX-12: a key does one thing (letter case ignored); shortcutKey's lookup by key.
CREATE UNIQUE INDEX shortcut_keys_key ON shortcut_keys (key COLLATE NOCASE);
`;

/** Pads' search entries, as v001's simpleDoc (copied, never imported: this step must not change with v001). */
function padDoc(): string {
  return `
    DELETE FROM search_fts WHERE rowid = (SELECT doc_id FROM search_docs WHERE kind = 'pad' AND ref_id = NEW.id);
    INSERT OR IGNORE INTO search_docs (kind, ref_id) VALUES ('pad', NEW.id);
    INSERT INTO search_fts (rowid, title, notes) SELECT doc_id, NEW.label, '' FROM search_docs WHERE kind = 'pad' AND ref_id = NEW.id;`;
}
const PAD_SEARCH = `
CREATE TRIGGER pads_search_insert AFTER INSERT ON pads BEGIN ${padDoc()} END;
CREATE TRIGGER pads_search_update AFTER UPDATE OF label ON pads BEGIN ${padDoc()} END;
CREATE TRIGGER pads_search_delete AFTER DELETE ON pads BEGIN
  DELETE FROM search_fts WHERE rowid = (SELECT doc_id FROM search_docs WHERE kind = 'pad' AND ref_id = OLD.id);
  DELETE FROM search_docs WHERE kind = 'pad' AND ref_id = OLD.id;
END;
`;

export const v006Round7: Migration = {
  version: 6,
  name: "design round 7: palette colours, board dividers, steps, follow with, mix out, shortcuts, crossfade, pads in search",
  up(db) {
    // Colours by palette name: a version 5 colour that is not one is dropped before the CHECK is added.
    for (const table of ["tag_groups", "tags", "folders"]) db.exec(`UPDATE ${table} SET color = NULL WHERE color IS NOT NULL AND color NOT IN (${PALETTE})`);
    rebuildTable(
      db,
      "tag_groups",
      `id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT ${PALETTE_COLOR("color")}, position REAL NOT NULL`,
      ["id", "name", "color", "position"],
    );
    rebuildTable(
      db,
      "tags",
      `id TEXT PRIMARY KEY,
       group_id TEXT NOT NULL REFERENCES tag_groups (id) ON DELETE CASCADE,
       parent_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
       name TEXT NOT NULL,
       color TEXT ${PALETTE_COLOR("color")},
       position REAL NOT NULL`,
      ["id", "group_id", "parent_id", "name", "color", "position"],
    );
    rebuildTable(
      db,
      "folders",
      `id TEXT PRIMARY KEY,
       scope TEXT NOT NULL CHECK (scope IN ('playlists', 'boards', 'sessions')),
       parent_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
       name TEXT NOT NULL,
       color TEXT ${PALETTE_COLOR("color")},
       collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
       position REAL NOT NULL`,
      ["id", "scope", "parent_id", "name", "color", "collapsed", "position"],
    );
    db.exec(TABLES);
    db.exec(INDEXES);
    // SHW-3: each track's first follow suggestion (version 1, never shown) becomes its Follow with.
    db.exec(`INSERT INTO track_follows (track_id, follow_track_id)
      SELECT track_id, follow_track_id FROM track_follow_with f
      WHERE position = (SELECT min(position) FROM track_follow_with g WHERE g.track_id = f.track_id)`);
    db.exec(PAD_SEARCH);
    db.exec(`INSERT OR IGNORE INTO search_docs (kind, ref_id) SELECT 'pad', id FROM pads;
      INSERT INTO search_fts (rowid, title, notes) SELECT d.doc_id, p.label, '' FROM search_docs d JOIN pads p ON p.id = d.ref_id WHERE d.kind = 'pad';`);
  },
};
