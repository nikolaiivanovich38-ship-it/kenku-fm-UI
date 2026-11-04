/**
 * Schema version 1: the library, tags, track metadata, markers, folders,
 * campaigns/sessions/scenes and the search index.
 *
 * Frozen once released: later changes go in a new numbered step.
 *
 * Conventions
 * - Ids are text (UUIDs), so ids from the current player's Redux data can be kept.
 * - Times are whole milliseconds since 1970 (UTC); durations and marker times are milliseconds.
 * - `position` columns are REAL "gap" order keys: insert between two rows by taking the
 *   midpoint, so nothing else is renumbered (see ../ordering.ts).
 * - Lists of choices (arc, role, folder scope …) are checked in the repository, not by
 *   CHECK constraints, so a later version can add a choice without rebuilding a table.
 *   Fixed numeric ranges (energy 1–5, rating 1–5, volume 0–1) are checked here as well.
 * - `search_docs` and `search_fts` are derived from the other tables by triggers and are
 *   never written directly.
 */
import { randomUUID } from "crypto";
import type { Migration } from "./migrate";

const TABLES = `
CREATE TABLE library_roots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX library_roots_name ON library_roots (name COLLATE NOCASE);

-- A track exists on its own (DAT-1). Its file is either a path under a library root
-- (root_id + path relative to it, with "/" separators), an absolute path (root_id NULL),
-- or a web address (url). Size, modified time and checksum help relink moved files (DAT-8).
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root_id TEXT REFERENCES library_roots (id) ON DELETE RESTRICT,
  path TEXT,
  url TEXT,
  file_name TEXT NOT NULL DEFAULT '',
  file_size INTEGER,
  file_mtime_ms INTEGER,
  checksum TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  -- Scoring metadata (DAT-2); every field optional.
  energy INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 5),
  arc TEXT,
  role TEXT,
  loopable TEXT,
  ending TEXT,
  transition_in TEXT,   -- JSON, see Transition in ../types.ts (PLY-8 may extend it)
  transition_out TEXT,  -- JSON
  follow_required INTEGER NOT NULL DEFAULT 0 CHECK (follow_required IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  source_composer TEXT,
  source_album TEXT,
  source_cue_number TEXT,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((path IS NULL) <> (url IS NULL)),
  CHECK (root_id IS NULL OR path IS NOT NULL)
);
CREATE INDEX tracks_root ON tracks (root_id);
CREATE INDEX tracks_file_name ON tracks (file_name COLLATE NOCASE);
CREATE INDEX tracks_title ON tracks (title COLLATE NOCASE);

-- "Follow with" suggestions (DAT-2, SHW-3): what to cue after this track, in order.
CREATE TABLE track_follow_with (
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  follow_track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (track_id, follow_track_id),
  CHECK (track_id <> follow_track_id)
) WITHOUT ROWID;
CREATE INDEX track_follow_with_target ON track_follow_with (follow_track_id);

-- Named points in a track (DAT-3): kind is marker, loop_in, loop_out or mix_out.
CREATE TABLE markers (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX markers_track ON markers (track_id, time_ms);

-- Nested folders (ORG-4). scope says what a folder holds: playlists, boards or sessions
-- now; dynamic playlists and scene blocks later. Deleting a folder moves its contents up
-- (repository); SET NULL is only a safety net.
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  parent_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT,
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  position REAL NOT NULL
);
CREATE INDEX folders_parent ON folders (scope, parent_id, position);

-- Manual playlists. background is a picture name ("tavern") or an address, as today.
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT '',
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX playlists_folder ON playlists (folder_id, position);

-- Ordered entries of a playlist: a track, or a divider with a label (ORG-4).
-- A track can be in many playlists; removing an entry never deletes the track.
CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  CHECK ((kind = 'track') = (track_id IS NOT NULL))
);
CREATE INDEX playlist_items_order ON playlist_items (playlist_id, position);
CREATE INDEX playlist_items_track ON playlist_items (track_id);

-- Soundboards. Their sounds keep the current player's settings (loop, volume, fades in
-- milliseconds) per entry, so one track can sit on several boards with different settings.
-- Pads and their actions (SFX-1, PLY-8) come in a later version.
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT '',
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX boards_folder ON boards (folder_id, position);

CREATE TABLE board_items (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  loop INTEGER NOT NULL DEFAULT 0 CHECK (loop IN (0, 1)),
  volume REAL NOT NULL DEFAULT 1 CHECK (volume BETWEEN 0 AND 1),
  fade_in_ms INTEGER NOT NULL DEFAULT 0 CHECK (fade_in_ms >= 0),
  fade_out_ms INTEGER NOT NULL DEFAULT 0 CHECK (fade_out_ms >= 0),
  position REAL NOT NULL,
  CHECK ((kind = 'sound') = (track_id IS NOT NULL))
);
CREATE INDEX board_items_order ON board_items (board_id, position);
CREATE INDEX board_items_track ON board_items (track_id);

-- Tag vocabulary (DAT-10): groups hold tags; a tag may have a parent and synonyms.
CREATE TABLE tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  position REAL NOT NULL
);
CREATE UNIQUE INDEX tag_groups_name ON tag_groups (name COLLATE NOCASE);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES tag_groups (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT,
  position REAL NOT NULL
);
CREATE UNIQUE INDEX tags_name ON tags (group_id, name COLLATE NOCASE);
CREATE INDEX tags_parent ON tags (parent_id);

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
CREATE INDEX track_tags_tag ON track_tags (tag_id);

-- Campaigns > sessions > scenes (ORG-7). Cue lists and scene blocks hang off sessions
-- and scenes in a later version.
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  notes TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  played_on TEXT,       -- calendar date, YYYY-MM-DD
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sessions_campaign ON sessions (campaign_id, position);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX scenes_session ON scenes (session_id, position);

-- Playlists and boards can belong to several campaigns; the library itself is shared.
CREATE TABLE campaign_playlists (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, playlist_id)
) WITHOUT ROWID;
CREATE INDEX campaign_playlists_playlist ON campaign_playlists (playlist_id);

CREATE TABLE campaign_boards (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, board_id)
) WITHOUT ROWID;
CREATE INDEX campaign_boards_board ON campaign_boards (board_id);

-- Material prepared for a scene: a playlist, a board or a single track, in order.
CREATE TABLE scene_items (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
  board_id TEXT REFERENCES boards (id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  CHECK ((playlist_id IS NOT NULL) + (board_id IS NOT NULL) + (track_id IS NOT NULL) = 1)
);
CREATE INDEX scene_items_order ON scene_items (scene_id, position);
CREATE INDEX scene_items_playlist ON scene_items (playlist_id);
CREATE INDEX scene_items_board ON scene_items (board_id);
CREATE INDEX scene_items_track ON scene_items (track_id);

-- Full-text search (ORG-1). One document per searchable row; doc_id is the FTS rowid
-- (text ids cannot be FTS rowids, and plain rowids may change on VACUUM).
CREATE TABLE search_docs (
  doc_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE VIRTUAL TABLE search_fts USING fts5 (
  title, file_name, tags, markers, notes, source,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);
`;

/**
 * SQL that rebuilds the search documents of the tracks listed by `ids`
 * (an expression list or a SELECT, used as `IN (ids)`). Tags contribute
 * their names and synonyms, so "sad" finds a track tagged Melancholy.
 */
function refreshTrackDocs(ids: string): string {
  return `
    DELETE FROM search_fts WHERE rowid IN
      (SELECT doc_id FROM search_docs WHERE kind = 'track' AND ref_id IN (${ids}));
    INSERT OR IGNORE INTO search_docs (kind, ref_id) SELECT 'track', id FROM tracks WHERE id IN (${ids});
    INSERT INTO search_fts (rowid, title, file_name, tags, markers, notes, source)
      SELECT d.doc_id, t.title, t.file_name,
        (SELECT group_concat(tg.name || coalesce(' ' ||
            (SELECT group_concat(s.synonym, ' ') FROM tag_synonyms s WHERE s.tag_id = tg.id), ''), ' ')
           FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.track_id = t.id),
        (SELECT group_concat(m.label, ' ') FROM markers m WHERE m.track_id = t.id),
        t.notes,
        concat_ws(' ', t.source_composer, t.source_album, t.source_cue_number)
      FROM tracks t JOIN search_docs d ON d.kind = 'track' AND d.ref_id = t.id
      WHERE t.id IN (${ids});`;
}

function removeDoc(kind: string, id: string): string {
  return `
    DELETE FROM search_fts WHERE rowid = (SELECT doc_id FROM search_docs WHERE kind = '${kind}' AND ref_id = ${id});
    DELETE FROM search_docs WHERE kind = '${kind}' AND ref_id = ${id};`;
}

/** Search triggers for rows indexed by a title and optional notes. */
function simpleDocTriggers(kind: string, table: string, titleColumn: string, hasNotes: boolean): string {
  const notes = hasNotes ? "NEW.notes" : "''";
  const refresh = `
    DELETE FROM search_fts WHERE rowid = (SELECT doc_id FROM search_docs WHERE kind = '${kind}' AND ref_id = NEW.id);
    INSERT OR IGNORE INTO search_docs (kind, ref_id) VALUES ('${kind}', NEW.id);
    INSERT INTO search_fts (rowid, title, file_name, tags, markers, notes, source)
      SELECT doc_id, NEW.${titleColumn}, '', '', '', ${notes}, '' FROM search_docs
      WHERE kind = '${kind}' AND ref_id = NEW.id;`;
  const watched = hasNotes ? `${titleColumn}, notes` : titleColumn;
  return `
CREATE TRIGGER ${table}_search_insert AFTER INSERT ON ${table} BEGIN ${refresh} END;
CREATE TRIGGER ${table}_search_update AFTER UPDATE OF ${watched} ON ${table} BEGIN ${refresh} END;
CREATE TRIGGER ${table}_search_delete AFTER DELETE ON ${table} BEGIN ${removeDoc(kind, "OLD.id")} END;`;
}

const SEARCH_TRIGGERS = `
CREATE TRIGGER tracks_search_insert AFTER INSERT ON tracks BEGIN ${refreshTrackDocs("NEW.id")} END;
CREATE TRIGGER tracks_search_update
  AFTER UPDATE OF title, file_name, notes, source_composer, source_album, source_cue_number ON tracks
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
${simpleDocTriggers("playlist", "playlists", "title", false)}
${simpleDocTriggers("board", "boards", "title", false)}
${simpleDocTriggers("campaign", "campaigns", "name", true)}
${simpleDocTriggers("session", "sessions", "name", true)}
${simpleDocTriggers("scene", "scenes", "name", true)}
`;

/** Offered on first use (DAT-10); the game master can rename or delete any of it. */
export const DEFAULT_TAG_GROUPS = ["Mood", "Leitmotif", "Scene type", "Location", "Faction"] as const;
export const DEFAULT_MOOD_TAGS = ["Melancholy", "Heroic", "Tense", "Wistful", "Warm", "Triumphant", "Eerie"] as const;

export const v001Initial: Migration = {
  version: 1,
  name: "library, tags, metadata, markers, folders, campaigns and search",
  up(db) {
    db.exec(TABLES);
    db.exec(SEARCH_TRIGGERS);
    const addGroup = db.prepare("INSERT INTO tag_groups (id, name, position) VALUES (?, ?, ?)");
    const addTag = db.prepare("INSERT INTO tags (id, group_id, name, position) VALUES (?, ?, ?, ?)");
    DEFAULT_TAG_GROUPS.forEach((name, index) => {
      const groupId = randomUUID();
      addGroup.run(groupId, name, (index + 1) * 1024);
      if (name === "Mood") {
        DEFAULT_MOOD_TAGS.forEach((tag, tagIndex) => addTag.run(randomUUID(), groupId, tag, (tagIndex + 1) * 1024));
      }
    });
  },
};
