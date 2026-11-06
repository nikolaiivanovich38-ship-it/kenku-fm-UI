/**
 * Schema version 4 (wave 4, PLY-15 and DAT-15: volume normalisation; design/prototype/ROUND5.md "Volume
 * normalisation"). docs/data-model.md "Version 4" explains each table and column.
 *
 * - `track_loudness`: what Lyre measured from a track's file (integrated loudness in LUFS, true peak in dBTP), with
 *   the file's size and modified time it was measured from, like `track_peaks`. A table of its own, not columns of
 *   `track_peaks`: the two are worked out by different reads of the file and saved at different moments, and each
 *   row's file stamp must say which file its own figures came from. NULL figures: the file could not be measured
 *   (unreadable, or silent), so it is not tried again until it changes. Derived data, outside undo.
 * - `tracks.normalise`, `playlists.normalise`: the game master's choice, 'on' or 'off'; NULL follows the library.
 * - `library_settings`: one row (id 1) with the library's own setting, off at first, and the target level.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

/** The targets (src/common/domain NORMALISE_TARGETS), written into this step so it never changes with that list. */
const TARGETS = "'quiet', 'standard', 'loud'";

export const v004Loudness: Migration = {
  version: 4,
  name: "volume normalisation",
  up(db) {
    db.exec(`
      CREATE TABLE track_loudness (
        track_id TEXT PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
        -- The file the figures were measured from (tracks.file_size and file_mtime_ms at that time).
        file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
        file_mtime_ms INTEGER,
        -- EBU R128 integrated loudness (a sound under 3 s: its loudest momentary loudness); NULL: not measurable.
        lufs REAL CHECK (lufs IS NULL OR lufs BETWEEN -70 AND 0),
        -- True peak in dB relative to full scale; lossy files can go a little above 0.
        true_peak_db REAL CHECK (true_peak_db IS NULL OR true_peak_db BETWEEN -100 AND 12),
        measured_at INTEGER NOT NULL,
        CHECK ((lufs IS NULL) = (true_peak_db IS NULL))
      ) WITHOUT ROWID;

      ALTER TABLE tracks ADD COLUMN normalise TEXT CHECK (normalise IS NULL OR normalise IN ('on', 'off'));
      ALTER TABLE playlists ADD COLUMN normalise TEXT CHECK (normalise IS NULL OR normalise IN ('on', 'off'));

      CREATE TABLE library_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        normalise_on INTEGER NOT NULL DEFAULT 0 CHECK (normalise_on IN (0, 1)),
        normalise_target TEXT NOT NULL DEFAULT 'standard' CHECK (normalise_target IN (${TARGETS}))
      );
      INSERT INTO library_settings (id) VALUES (1);
    `);
  },
};
