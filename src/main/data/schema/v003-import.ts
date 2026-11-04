/**
 * Schema version 3 (import stream: EDT-6, DAT-9).
 *
 * - `tracks.is_new`: a track added by an import is marked New (the Library's
 *   "New, not tagged yet" filter and its New badge, design/prototype
 *   views/library.js). The mark goes by itself once the track has a title of
 *   its own and at least one tag, as the prototype's `settle` does; two
 *   triggers keep that rule in the database, so undo puts the mark back too.
 * - `library_jobs`: long jobs that must run once and survive a crash (moving
 *   the old player's library in, ../import/legacy.ts) record their state and a
 *   JSON report here. Bookkeeping: written outside the undo history.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v003Import: Migration = {
  version: 3,
  name: "import: new tracks and library jobs",
  up(db) {
    db.exec(`
      ALTER TABLE tracks ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1));

      -- Read path: the Library's "New, not tagged yet" filter and its count (NEW_TRACKS_SQL, repo/tracks.ts).
      CREATE INDEX tracks_new ON tracks (is_new) WHERE is_new = 1;

      -- A new track settles (is no longer New) once it has a title of its own and a tag.
      CREATE TRIGGER tracks_settle_on_title AFTER UPDATE OF title ON tracks
        WHEN NEW.is_new = 1 AND NEW.title <> '' AND EXISTS (SELECT 1 FROM track_tags WHERE track_id = NEW.id)
        BEGIN UPDATE tracks SET is_new = 0 WHERE id = NEW.id; END;
      CREATE TRIGGER tracks_settle_on_tag AFTER INSERT ON track_tags
        WHEN EXISTS (SELECT 1 FROM tracks WHERE id = NEW.track_id AND is_new = 1 AND title <> '')
        BEGIN UPDATE tracks SET is_new = 0 WHERE id = NEW.track_id; END;

      CREATE TABLE library_jobs (
        -- For example 'legacy-player'.
        name TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('running', 'done')),
        -- The job's own record (what it has done, its report), read whole.
        detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );
    `);
  },
};
