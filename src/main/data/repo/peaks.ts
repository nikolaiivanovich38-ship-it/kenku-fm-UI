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
  /** Worked out from the track's current file. */
  | { state: "ready"; levels: Uint8Array }
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
  levels: Uint8Array | null;
};

/** One read by the track's key and the peaks' key (both primary keys). */
export const PEAKS_STATE_SQL = `
  SELECT r.path AS root_path, t.path, t.url, t.file_size, t.file_mtime_ms,
         p.track_id IS NOT NULL AS has_peaks, p.file_size AS peak_size, p.file_mtime_ms AS peak_mtime_ms, p.levels
  FROM tracks t
  LEFT JOIN library_roots r ON r.id = t.root_id
  LEFT JOIN track_peaks p ON p.track_id = t.id
  WHERE t.id = ?`;

export function trackPeaks(store: Store, trackId: string): PeaksState {
  const row = store.get<Row>(PEAKS_STATE_SQL, trackId);
  if (!row || row.url !== null || row.path === null) return { state: "none" };
  const sameFile = row.has_peaks === 1 && row.peak_size === row.file_size && row.peak_mtime_ms === row.file_mtime_ms;
  if (sameFile) return row.levels ? { state: "ready", levels: new Uint8Array(row.levels) } : { state: "unreadable" };
  const file = row.root_path === null ? row.path : joinRoot(row.root_path, row.path);
  return { state: "needed", source: { trackId, file, fileSize: row.file_size, fileMtimeMs: row.file_mtime_ms } };
}

/**
 * Keeps the levels worked out from `source` (null: the file could not be read), with the shape Lyre suggests from
 * them (DAT-13, shapeFromPeaks; schema v3), so filters read the shape without the levels. Saved only while the track still
 * has that file; answers false when it was deleted or its file changed meanwhile (the levels would be wrong).
 * Bookkeeping outside undo, so it keeps the undo history; throws LibraryBusyError during bulk work.
 */
export function savePeaks(store: Store, source: PeakSource, levels: Uint8Array | null): boolean {
  if (levels !== null && (levels.length === 0 || levels.length > MAX_PEAK_POINTS)) {
    throw new RangeError(`Peaks need 1 to ${MAX_PEAK_POINTS} levels, not ${levels.length}.`);
  }
  return store.changeWithoutHistory(
    () =>
      store.run(
        `INSERT INTO track_peaks (track_id, file_size, file_mtime_ms, suggested_shape, levels, worked_out_at)
         SELECT id, file_size, file_mtime_ms, ?, ?, ? FROM tracks WHERE id = ? AND file_size IS ? AND file_mtime_ms IS ?
         ON CONFLICT (track_id) DO UPDATE SET
           file_size = excluded.file_size, file_mtime_ms = excluded.file_mtime_ms, suggested_shape = excluded.suggested_shape,
           levels = excluded.levels, worked_out_at = excluded.worked_out_at`,
        levels === null ? null : shapeFromPeaks(Array.from(levels, (b) => b / 255)),
        levels,
        store.now(),
        source.trackId,
        source.fileSize,
        source.fileMtimeMs,
      ) > 0,
    { bookkeeping: true },
  );
}
