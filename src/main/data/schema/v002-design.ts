/**
 * Schema version 2 (DAT-11): the agreed design, Lyre design round 4
 * (design/prototype, shapes in src/common/domain).
 *
 * - Tracks: kind (music, amb, fx), the title from the file's tags (meta_title)
 *   beside the game master's own title (which may now be empty), and the
 *   track's own audio profile. Loop advice "with_crossfade" becomes "crossfade".
 * - Playlists: kind (manual or dynamic), lane (music, amb, fx), a dynamic rule, notes.
 * - Pad boards: a grid of 1 to 8 columns and rows; pads in its cells or spare
 *   (off the grid). The soundboard entries of version 1 become pads.
 * - Campaigns: theme, system, description and Obsidian fields; their playlists
 *   and boards are ordered.
 * - Sessions: number, status (played, next, draft; one next per campaign),
 *   their own ordered playlists and boards, a note link. played_on is now the
 *   session's date (session_date), planned or played.
 * - Scenes: "starts when", a note link, an ordered music list of tracks and
 *   playlists, one ambience item, an ordered list of boards. The version-1
 *   scene items are split into these.
 * - Audio profile overrides per playlist and per scene.
 *
 * Frozen once released: later changes go in a new numbered step.
 * Choices (kind, lane, theme, colour …) are checked in the repository, as in
 * version 1, so a later version can add one without rebuilding a table.
 */
import type { DatabaseSync } from "../sqlite";
import { rebuildTable, type Migration } from "./migrate";

/** Gap between positions of rows created here (as ../ordering.ts GAP; kept here so this step never changes). */
const GAP = 1024;
/** Columns of the grid that version-1 soundboard sounds are laid out on. */
const CONVERTED_COLUMNS = 4;
const MAX_GRID = 8;

const TABLES = `
ALTER TABLE tracks ADD COLUMN kind TEXT NOT NULL DEFAULT 'music';
-- The title in the file's tags; the game master's own title stays in "title" and may be empty.
ALTER TABLE tracks ADD COLUMN meta_title TEXT NOT NULL DEFAULT '';
-- The track's own audio profile: JSON matching AudioProfileInput (src/common/domain), or NULL for the defaults.
ALTER TABLE tracks ADD COLUMN profile TEXT;
UPDATE tracks SET loopable = 'crossfade' WHERE loopable = 'with_crossfade';
CREATE INDEX tracks_kind ON tracks (kind);

ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE playlists ADD COLUMN lane TEXT NOT NULL DEFAULT 'music';
-- Dynamic playlists only: JSON matching PlaylistRule (src/common/domain). Tag values are tag names.
ALTER TABLE playlists ADD COLUMN rule TEXT;
ALTER TABLE playlists ADD COLUMN notes TEXT NOT NULL DEFAULT '';

ALTER TABLE boards ADD COLUMN grid_cols INTEGER NOT NULL DEFAULT 4 CHECK (grid_cols BETWEEN 1 AND 8);
ALTER TABLE boards ADD COLUMN grid_rows INTEGER NOT NULL DEFAULT 3 CHECK (grid_rows BETWEEN 1 AND 8);

-- A pad sits in one grid cell (grid_row, grid_col, from 0) or waits among the spare
-- pads (spare_position). Cells outside the board's current size never hold a pad:
-- shrinking a board moves those pads to spare (repository), so nothing is lost.
CREATE TABLE pads (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  grid_row INTEGER CHECK (grid_row BETWEEN 0 AND 7),
  grid_col INTEGER CHECK (grid_col BETWEEN 0 AND 7),
  spare_position REAL,
  label TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'star',
  color TEXT NOT NULL DEFAULT 'gold',
  hotkey TEXT,
  mode TEXT NOT NULL DEFAULT 'oneshot',
  -- single: the first of pad_sounds; variants: all of them, at random or in turn; tag: any effect with the tag.
  sound_kind TEXT NOT NULL DEFAULT 'single',
  sound_order TEXT NOT NULL DEFAULT 'random',
  sound_tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  volume REAL NOT NULL DEFAULT 0.8 CHECK (volume BETWEEN 0 AND 1),
  fade_in_ms INTEGER NOT NULL DEFAULT 0 CHECK (fade_in_ms >= 0),
  -- The fade when the sound stops (toggle off, hold released).
  fade_ms INTEGER NOT NULL DEFAULT 1500 CHECK (fade_ms >= 0),
  CHECK ((grid_row IS NULL) = (grid_col IS NULL)),
  CHECK ((grid_row IS NULL) <> (spare_position IS NULL))
);
CREATE UNIQUE INDEX pads_cell ON pads (board_id, grid_row, grid_col) WHERE grid_row IS NOT NULL;
CREATE INDEX pads_spare ON pads (board_id, spare_position) WHERE spare_position IS NOT NULL;
CREATE INDEX pads_tag ON pads (sound_tag_id);

-- The library tracks a pad plays, in order. Kept when the pad switches between
-- one file and variants, so switching back loses nothing.
CREATE TABLE pad_sounds (
  pad_id TEXT NOT NULL REFERENCES pads (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (pad_id, track_id)
);
CREATE INDEX pad_sounds_track ON pad_sounds (track_id);

ALTER TABLE campaigns ADD COLUMN theme TEXT NOT NULL DEFAULT 'candle';
ALTER TABLE campaigns ADD COLUMN system TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN description TEXT NOT NULL DEFAULT '';
-- Obsidian links (not used yet): the vault, the campaign's note, the folder of session notes.
ALTER TABLE campaigns ADD COLUMN obsidian_vault TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN obsidian_note TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN obsidian_sessions TEXT NOT NULL DEFAULT '';

ALTER TABLE sessions RENAME COLUMN played_on TO session_date;
ALTER TABLE sessions ADD COLUMN number INTEGER NOT NULL DEFAULT 0 CHECK (number >= 0);
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE sessions ADD COLUMN note_link TEXT NOT NULL DEFAULT '';
UPDATE sessions SET status = 'played' WHERE session_date IS NOT NULL;
UPDATE sessions SET number = (
  SELECT count(*) FROM sessions s2 WHERE s2.campaign_id = sessions.campaign_id
    AND (s2.position < sessions.position OR (s2.position = sessions.position AND s2.rowid <= sessions.rowid)));
CREATE UNIQUE INDEX sessions_next ON sessions (campaign_id) WHERE status = 'next';

CREATE TABLE session_playlists (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (session_id, playlist_id)
);
CREATE INDEX session_playlists_playlist ON session_playlists (playlist_id);

CREATE TABLE session_boards (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (session_id, board_id)
);
CREATE INDEX session_boards_board ON session_boards (board_id);

ALTER TABLE scenes ADD COLUMN starts_when TEXT NOT NULL DEFAULT '';
ALTER TABLE scenes ADD COLUMN note_link TEXT NOT NULL DEFAULT '';

-- A scene's music, in playing order: tracks and playlists in any mix; one may come twice.
CREATE TABLE scene_music (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  CHECK ((track_id IS NULL) <> (playlist_id IS NULL))
);
CREATE INDEX scene_music_order ON scene_music (scene_id, position);
CREATE INDEX scene_music_track ON scene_music (track_id);
CREATE INDEX scene_music_playlist ON scene_music (playlist_id);

-- A scene's one ambience item; no row means none.
CREATE TABLE scene_ambience (
  scene_id TEXT PRIMARY KEY REFERENCES scenes (id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  CHECK ((track_id IS NULL) <> (playlist_id IS NULL))
);
CREATE INDEX scene_ambience_track ON scene_ambience (track_id);
CREATE INDEX scene_ambience_playlist ON scene_ambience (playlist_id);

-- A scene's pad boards; the first shows when the scene starts.
CREATE TABLE scene_boards (
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (scene_id, board_id)
);
CREATE INDEX scene_boards_board ON scene_boards (board_id);

INSERT INTO scene_music (id, scene_id, track_id, playlist_id, position)
  SELECT id, scene_id, track_id, playlist_id, position FROM scene_items WHERE board_id IS NULL;
INSERT INTO scene_boards (scene_id, board_id, position)
  SELECT scene_id, board_id, min(position) FROM scene_items WHERE board_id IS NOT NULL GROUP BY scene_id, board_id;
DROP TABLE scene_items;

-- A track's audio profile in one place: inside one playlist, or in one scene. JSON as tracks.profile.
-- The domain's place key for a scene ("sc:<campaign>:<session>:<scene>") is worked out when read,
-- so an override follows its scene when the scene moves to another session.
CREATE TABLE profile_overrides (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes (id) ON DELETE CASCADE,
  profile TEXT NOT NULL,
  CHECK ((playlist_id IS NULL) <> (scene_id IS NULL))
);
CREATE UNIQUE INDEX profile_overrides_playlist ON profile_overrides (playlist_id, track_id) WHERE playlist_id IS NOT NULL;
CREATE UNIQUE INDEX profile_overrides_scene ON profile_overrides (scene_id, track_id) WHERE scene_id IS NOT NULL;
CREATE INDEX profile_overrides_track ON profile_overrides (track_id);
`;

/**
 * Rebuilds the search documents of the tracks in `ids`. As version 1, except
 * that a track without the game master's title shows (and is found by) its
 * file-tag title, and the file-tag title of a titled track is still searchable.
 * For rows of version 1 (meta_title empty, title never empty) the documents are
 * the same as before, so nothing needs re-indexing.
 */
function refreshTrackDocs(ids: string): string {
  return `
    DELETE FROM search_fts WHERE rowid IN
      (SELECT doc_id FROM search_docs WHERE kind = 'track' AND ref_id IN (${ids}));
    INSERT OR IGNORE INTO search_docs (kind, ref_id) SELECT 'track', id FROM tracks WHERE id IN (${ids});
    INSERT INTO search_fts (rowid, title, file_name, tags, markers, notes, source)
      SELECT d.doc_id, coalesce(nullif(t.title, ''), t.meta_title), t.file_name,
        (SELECT group_concat(tg.name || coalesce(' ' ||
            (SELECT group_concat(s.synonym, ' ') FROM tag_synonyms s WHERE s.tag_id = tg.id), ''), ' ')
           FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.track_id = t.id),
        (SELECT group_concat(m.label, ' ') FROM markers m WHERE m.track_id = t.id),
        t.notes,
        concat_ws(' ', CASE WHEN t.title <> '' THEN nullif(t.meta_title, '') END,
          t.source_composer, t.source_album, t.source_cue_number)
      FROM tracks t JOIN search_docs d ON d.kind = 'track' AND d.ref_id = t.id
      WHERE t.id IN (${ids});`;
}

const TRACK_TRIGGERS: [name: string, sql: string][] = [
  ["tracks_search_insert", `AFTER INSERT ON tracks BEGIN ${refreshTrackDocs("NEW.id")} END`],
  [
    "tracks_search_update",
    `AFTER UPDATE OF title, meta_title, file_name, notes, source_composer, source_album, source_cue_number ON tracks
     BEGIN ${refreshTrackDocs("NEW.id")} END`,
  ],
  ["track_tags_search_insert", `AFTER INSERT ON track_tags BEGIN ${refreshTrackDocs("NEW.track_id")} END`],
  ["track_tags_search_delete", `AFTER DELETE ON track_tags BEGIN ${refreshTrackDocs("OLD.track_id")} END`],
  [
    "tags_search_rename",
    `AFTER UPDATE OF name ON tags BEGIN ${refreshTrackDocs("SELECT track_id FROM track_tags WHERE tag_id = NEW.id")} END`,
  ],
  [
    "tag_synonyms_search_insert",
    `AFTER INSERT ON tag_synonyms BEGIN ${refreshTrackDocs("SELECT track_id FROM track_tags WHERE tag_id = NEW.tag_id")} END`,
  ],
  [
    "tag_synonyms_search_delete",
    `AFTER DELETE ON tag_synonyms BEGIN ${refreshTrackDocs("SELECT track_id FROM track_tags WHERE tag_id = OLD.tag_id")} END`,
  ],
  ["markers_search_insert", `AFTER INSERT ON markers BEGIN ${refreshTrackDocs("NEW.track_id")} END`],
  [
    "markers_search_update",
    `AFTER UPDATE OF label, track_id ON markers BEGIN ${refreshTrackDocs("NEW.track_id, OLD.track_id")} END`,
  ],
  ["markers_search_delete", `AFTER DELETE ON markers BEGIN ${refreshTrackDocs("OLD.track_id")} END`],
];

/** Adds a position to the campaign membership tables, keeping the library's order for what is there. */
function orderCampaignMembers(db: DatabaseSync) {
  for (const [table, column, parent] of [
    ["campaign_playlists", "playlist_id", "playlists"],
    ["campaign_boards", "board_id", "boards"],
  ] as const) {
    rebuildTable(
      db,
      table,
      `campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
       ${column} TEXT NOT NULL REFERENCES ${parent} (id) ON DELETE CASCADE,
       position REAL NOT NULL DEFAULT 0,
       PRIMARY KEY (campaign_id, ${column})`,
      ["campaign_id", column],
    );
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
    db.exec(`CREATE INDEX ${table}_order ON ${table} (campaign_id, position)`);
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
    `SELECT i.id, i.kind, i.track_id, t.title AS track_title, i.loop, i.volume, i.fade_in_ms, i.fade_out_ms
     FROM board_items i LEFT JOIN tracks t ON t.id = i.track_id WHERE i.board_id = ? ORDER BY i.position, i.rowid`,
  );
  const setRows = db.prepare("UPDATE boards SET grid_cols = ?, grid_rows = ? WHERE id = ?");
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
    setRows.run(CONVERTED_COLUMNS, rows, board.id);
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

/** Version 1 offered Location and Faction too; the design starts a new library with three groups. */
const GROUPS_NOT_OFFERED = ["Location", "Faction"];

export const v002Design: Migration = {
  version: 2,
  name: "design round 4: lanes, dynamic playlists, pad grids, scene music lists and audio profiles",
  up(db, context) {
    // Rebuilt first: rebuildTable drops and recreates every trigger.
    orderCampaignMembers(db);
    db.exec(TABLES);
    convertBoardItems(db);
    for (const [name, sql] of TRACK_TRIGGERS) {
      db.exec(`DROP TRIGGER ${name}`);
      db.exec(`CREATE TRIGGER ${name} ${sql}`);
    }
    if (context.startVersion === 0) {
      const remove = db.prepare(
        "DELETE FROM tag_groups WHERE name = ? AND NOT EXISTS (SELECT 1 FROM tags WHERE tags.group_id = tag_groups.id)",
      );
      for (const name of GROUPS_NOT_OFFERED) remove.run(name);
    }
  },
};
