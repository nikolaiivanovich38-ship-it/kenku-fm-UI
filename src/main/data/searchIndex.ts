/**
 * Keeps the tracks' search entries (search_fts, search_docs) up to date
 * (ORG-1; DB review item 5).
 *
 * A track's entry gathers its names, notes, artist, album, tags with their
 * synonyms and marker labels. Rebuilding it on every row change made bulk work
 * slow: tagging 10,000 tracks with three tags rebuilt each entry three times
 * (85% of the time). Instead, temporary triggers only note which tracks
 * changed, in the temporary table search_dirty, and `flushSearchIndex` rebuilds
 * each noted entry once, just before the change is saved (Store calls it before
 * every COMMIT). A change that is rolled back takes its notes with it, because
 * the temporary table is part of the transaction.
 *
 * The triggers are temporary (they live only on this connection, like the undo
 * history's), because a trigger saved in the file cannot write to a temporary
 * table. Every write goes through a Store, which installs them. Playlists,
 * boards, campaigns, sessions and scenes have one entry each, made from their
 * own row, so their triggers stay in the schema (v001-library.ts).
 */
import type { DatabaseSync, StatementSync } from "./sqlite";

/** Changes that alter what a track's entry holds, and which tracks they touch. */
const WATCHED: [name: string, event: string, tracks: string][] = [
  ["tracks_insert", "AFTER INSERT ON main.tracks", "SELECT NEW.id"],
  [
    "tracks_update",
    "AFTER UPDATE OF title, meta_title, file_name, notes, source_composer, source_album, source_cue_number ON main.tracks",
    "SELECT NEW.id",
  ],
  ["tracks_delete", "AFTER DELETE ON main.tracks", "SELECT OLD.id"],
  ["track_tags_insert", "AFTER INSERT ON main.track_tags", "SELECT NEW.track_id"],
  ["track_tags_delete", "AFTER DELETE ON main.track_tags", "SELECT OLD.track_id"],
  ["tags_rename", "AFTER UPDATE OF name ON main.tags", "SELECT track_id FROM main.track_tags WHERE tag_id = NEW.id"],
  ["tag_synonyms_insert", "AFTER INSERT ON main.tag_synonyms", "SELECT track_id FROM main.track_tags WHERE tag_id = NEW.tag_id"],
  ["tag_synonyms_delete", "AFTER DELETE ON main.tag_synonyms", "SELECT track_id FROM main.track_tags WHERE tag_id = OLD.tag_id"],
  ["markers_insert", "AFTER INSERT ON main.markers", "SELECT NEW.track_id"],
  ["markers_update", "AFTER UPDATE OF label, track_id ON main.markers", "SELECT NEW.track_id UNION SELECT OLD.track_id"],
  ["markers_delete", "AFTER DELETE ON main.markers", "SELECT OLD.track_id"],
];

/** Creates the temporary table and triggers on this connection (again, if they exist). */
export function installSearchIndex(db: DatabaseSync): void {
  db.exec("CREATE TEMP TABLE IF NOT EXISTS search_dirty (track_id TEXT PRIMARY KEY) WITHOUT ROWID");
  for (const [name, event, tracks] of WATCHED) {
    db.exec(`
      DROP TRIGGER IF EXISTS temp.search_dirty_${name};
      CREATE TEMP TRIGGER search_dirty_${name} ${event}
      BEGIN INSERT OR IGNORE INTO temp.search_dirty (track_id) ${tracks}; END;`);
  }
}

/** The track columns of a search entry, for the tracks noted in search_dirty. */
const REBUILD = `
DELETE FROM search_fts WHERE rowid IN
  (SELECT doc_id FROM search_docs WHERE kind = 'track' AND ref_id IN (SELECT track_id FROM temp.search_dirty));
DELETE FROM search_docs WHERE kind = 'track' AND ref_id IN
  (SELECT track_id FROM temp.search_dirty WHERE track_id NOT IN (SELECT id FROM tracks));
INSERT OR IGNORE INTO search_docs (kind, ref_id) SELECT 'track', id FROM tracks WHERE id IN (SELECT track_id FROM temp.search_dirty);
INSERT INTO search_fts (rowid, title, meta_title, file_name, artist, album, tags, markers, notes, cue)
  SELECT d.doc_id, coalesce(nullif(t.title, ''), nullif(t.meta_title, ''), t.file_name), t.meta_title, t.file_name,
    t.source_composer, t.source_album,
    (SELECT group_concat(tg.name || coalesce(' ' ||
        (SELECT group_concat(s.synonym, ' ') FROM tag_synonyms s WHERE s.tag_id = tg.id), ''), ' ')
       FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.track_id = t.id),
    (SELECT group_concat(m.label, ' ') FROM markers m WHERE m.track_id = t.id),
    t.notes, t.source_cue_number
  FROM tracks t JOIN search_docs d ON d.kind = 'track' AND d.ref_id = t.id
  WHERE t.id IN (SELECT track_id FROM temp.search_dirty);
DELETE FROM temp.search_dirty;
`;

const pendingStatements = new WeakMap<DatabaseSync, StatementSync>();

/** Rebuilds the entries of the tracks changed in the open transaction; call just before COMMIT. */
export function flushSearchIndex(db: DatabaseSync): void {
  let pending = pendingStatements.get(db);
  if (!pending) {
    pending = db.prepare("SELECT EXISTS (SELECT 1 FROM temp.search_dirty) AS any");
    pendingStatements.set(db, pending);
  }
  if ((pending.get() as { any: number }).any === 1) db.exec(REBUILD);
}
