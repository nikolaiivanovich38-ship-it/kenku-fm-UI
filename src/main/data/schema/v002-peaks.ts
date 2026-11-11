/**
 * Schema version 2 (w3-media): loudness peaks per track, for the wave the Audio profile screen draws.
 *
 * A table of its own, not columns on `tracks`: the levels are about 1 KB per track, worked out in the background
 * long after the track is added, and read one track at a time; kept apart they never widen a scan of the tracks
 * table. One row per track (third normal form: every column depends on the track alone), deleted with it.
 *
 * The file's size and modified time are those the levels were worked out from, so a changed or relinked file is
 * seen as needing new ones. NULL levels mean the file could not be read, so it is not tried again until it changes.
 * Derived data: written outside undo (undo.ts NOT_UNDOABLE; SQLite's JSON functions cannot hold a BLOB either).
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v002Peaks: Migration = {
  version: 2,
  name: "loudness peaks per track",
  up(db) {
    db.exec(`
      CREATE TABLE track_peaks (
        track_id TEXT PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
        -- The file the levels were worked out from (tracks.file_size and file_mtime_ms at that time).
        file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
        file_mtime_ms INTEGER,
        -- One byte per point across the file, 0 (-60 dBFS or quieter) to 255 (full scale); NULL: unreadable.
        levels BLOB CHECK (levels IS NULL OR (typeof(levels) = 'blob' AND length(levels) BETWEEN 1 AND 4096)),
        worked_out_at INTEGER NOT NULL
      ) WITHOUT ROWID;
    `);
  },
};
