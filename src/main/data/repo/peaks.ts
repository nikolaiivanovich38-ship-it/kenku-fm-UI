/**
 * Loudness peaks per track (w3-media; schema step 2, table track_peaks): about 1,000 levels across the file, one
 * byte each. Worked out from the file by PeakJobs (../peaks.ts); read whole, one track at a time, by its key.
 */
import { shapeFromPeaks } from "../../../common/domain";
import type { Store } from "../store";
import { joinRoot } from "../paths";

/** Points across a file: enough for a wave as wide as a 4K screen draws it, about 1 KB per track. */
export const PEAK_POINTS = 1000;
/** The most levels the table takes (its CHECK). */
export const MAX_PEAK_POINTS = 4096;

/** The file a track's levels are worked out from, with the facts the library holds about it. */
export type PeakSource = { trackId: string; file: string; fileSize: number | null; fileMtimeMs: number | null };

export type PeaksState =
  /**
   * Worked out from the track's current file. `lengthChecked` false (schema version 10): saved before 0.5.2 checked
   * the track's length from the whole file; the peaks job reads `source` once more for it.
   */
  | { state: "ready"; levels: Uint8Array; lengthChecked: boolean; source: PeakSource }
  /** Tried, and this file could not be read: not tried again until the file changes. */
  | { state: "unreadable" }
  /** None yet, or the file changed since: work them out from `source`. */
  | { state: "needed"; source: PeakSource }
  /** No such track, or it is a web address (no file to read). */
  | { state: "none" };

type Row = {
  root_path: string | null;
  path: string | null;
  url: string | null;
  file_size: number | null;
  file_mtime_ms: number | null;
  has_peaks: number;
  peak_size: number | null;
  peak_mtime_ms: number | null;
  length_checked: number | null;
  levels: Uint8Array | null;
};

/** One read by the track's key and the peaks' key (both primary keys). */
export const PEAKS_STATE_SQL = `
  SELECT r.path AS root_path, t.path, t.url, t.file_size, t.file_mtime_ms,
         p.track_id IS NOT NULL AS has_peaks, p.file_size AS peak_size, p.file_mtime_ms AS peak_mtime_ms, p.length_checked, p.levels
  FROM tracks t
  LEFT JOIN library_roots r ON r.id = t.root_id
  LEFT JOIN track_peaks p ON p.track_id = t.id
  WHERE t.id = ?`;

export function trackPeaks(store: Store, trackId: string): PeaksState {
  const row = store.get<Row>(PEAKS_STATE_SQL, trackId);
  if (!row || row.url !== null || row.path === null) return { state: "none" };
  const sameFile = row.has_peaks === 1 && row.peak_size === row.file_size && row.peak_mtime_ms === row.file_mtime_ms;
  const file = row.root_path === null ? row.path : joinRoot(row.root_path, row.path);
  const source = { trackId, file, fileSize: row.file_size, fileMtimeMs: row.file_mtime_ms };
  if (sameFile) return row.levels ? { state: "ready", levels: new Uint8Array(row.levels), lengthChecked: row.length_checked !== 0, source } : { state: "unreadable" };
  return { state: "needed", source };
}

/** Schema version 10: tracks whose waveform is kept but whose length was not checked from the whole file yet. */
export function tracksNeedingLengthCheck(store: Store): string[] {
  return store
    .all<{ id: string }>(
      `SELECT t.id FROM tracks t JOIN track_peaks p ON p.track_id = t.id
       WHERE p.length_checked = 0 AND p.levels IS NOT NULL AND p.file_size IS t.file_size AND p.file_mtime_ms IS t.file_mtime_ms
       ORDER BY t.added_seq`,
    )
    .map((row) => row.id);
}

/**
 * Keeps the levels worked out from `source` (null: the file could not be read), with the shape Lyre suggests from
 * them (DAT-13, shapeFromPeaks; schema v3), so filters read the shape without the levels. Saved only while the track still
 * has that file; answers false when it was deleted or its file changed meanwhile (the levels would be wrong).
 * Bookkeeping outside undo, so it keeps the undo history; throws LibraryBusyError during bulk work.
 * `lengthChecked` (schema version 10): the same read also checked the track's length (correctTrackLength).
 */
export function savePeaks(store: Store, source: PeakSource, levels: Uint8Array | null, options: { lengthChecked?: boolean } = {}): boolean {
  if (levels !== null && (levels.length === 0 || levels.length > MAX_PEAK_POINTS)) {
    throw new RangeError(`Peaks need 1 to ${MAX_PEAK_POINTS} levels, not ${levels.length}.`);
  }
  return store.changeWithoutHistory(
    () =>
      store.run(
        `INSERT INTO track_peaks (track_id, file_size, file_mtime_ms, suggested_shape, levels, worked_out_at, length_checked)
         SELECT id, file_size, file_mtime_ms, ?, ?, ?, ? FROM tracks WHERE id = ? AND file_size IS ? AND file_mtime_ms IS ?
         ON CONFLICT (track_id) DO UPDATE SET
           file_size = excluded.file_size, file_mtime_ms = excluded.file_mtime_ms, suggested_shape = excluded.suggested_shape,
           levels = excluded.levels, worked_out_at = excluded.worked_out_at, length_checked = excluded.length_checked`,
        levels === null ? null : shapeFromPeaks(Array.from(levels, (b) => b / 255)),
        levels,
        store.now(),
        // An unreadable file is not read again for its length either.
        levels === null || options.lengthChecked ? 1 : 0,
        source.trackId,
        source.fileSize,
        source.fileMtimeMs,
      ) > 0,
    { bookkeeping: true },
  );
}

/** A stored length this far from the decoded one is put right (0.5.2): tags and decoders differ by less. */
export const LENGTH_TOLERANCE_MS = 500;

/**
 * 0.5.2 (w52-play item 52, the lead's rule: one length everywhere, the library's, and it must be right): an MP3
 * whose Xing header counts fewer frames than it holds (a cut or joined file) has tags that say 3 s for a 20 s file.
 * The peaks job decodes the whole file, so when the decoded length is more than LENGTH_TOLERANCE_MS from the stored
 * one, the decoded one is stored, and a saved End at the old length (within the same tolerance) goes back to the
 * file's end (NULL); an End the game master moved elsewhere stays. Only while the track still has that file;
 * bookkeeping outside undo, as the peaks are. Answers whether the length changed.
 */
export function correctTrackLength(store: Store, source: PeakSource, durationMs: number): boolean {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
  const row = store.get<{ duration_ms: number | null }>("SELECT duration_ms FROM tracks WHERE id = ? AND file_size IS ? AND file_mtime_ms IS ?", source.trackId, source.fileSize, source.fileMtimeMs);
  if (!row) return false;
  const old = row.duration_ms;
  const length = Math.round(durationMs);
  if (old !== null && Math.abs(old - length) <= LENGTH_TOLERANCE_MS) return false;
  return store.changeWithoutHistory(
    () => {
      if (old !== null) store.run("UPDATE audio_profiles SET end_ms = NULL WHERE track_id = ? AND end_ms IS NOT NULL AND abs(end_ms - ?) <= ?", source.trackId, old, LENGTH_TOLERANCE_MS);
      return store.run("UPDATE tracks SET duration_ms = ? WHERE id = ?", length, source.trackId) > 0;
    },
    { bookkeeping: true },
  );
}
