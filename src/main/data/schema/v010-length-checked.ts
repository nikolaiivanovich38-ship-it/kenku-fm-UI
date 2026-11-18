/**
 * Schema version 10 (0.5.2, review of the merged streams). docs/data-model.md "Version 10".
 *
 * 0.5.2 puts right a length the file's tags got wrong (a cut or joined MP3 read as 3 s for a 20 s file) when the peaks
 * job decodes the whole file for its waveform. A waveform saved before 0.5.2 was never checked that way, and is never
 * worked out again while its file stays the same, so its track kept the wrong length.
 *
 * - `track_peaks.length_checked`: 1 once the waveform's read also checked the track's length; 0 while it still has to
 *   be (the peaks job reads the file once more for it, in the background; the waveform shows meanwhile).
 * - The upgrade marks 0 the waveforms of MP3 files only: other formats' lengths come from headers that count every
 *   sample. A file found unreadable stays 1 (it is not read again until it changes).
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v010LengthChecked: Migration = {
  version: 10,
  name: "a waveform's length checked (0.5.2)",
  up(db) {
    db.exec(`
      ALTER TABLE track_peaks ADD COLUMN length_checked INTEGER NOT NULL DEFAULT 1 CHECK (length_checked IN (0, 1));
      UPDATE track_peaks SET length_checked = 0
        WHERE levels IS NOT NULL AND track_id IN (SELECT id FROM tracks WHERE lower(path) LIKE '%.mp3');
    `);
  },
};
