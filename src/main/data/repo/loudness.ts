/**
 * DAT-15 measured loudness per track (schema step 4, table track_loudness): integrated loudness (LUFS) and true peak
 * (dBTP), kept with the file's size and modified time they were measured from, as the loudness peaks are
 * (repo/peaks.ts). Measured in the background by PeakJobs with a LoudnessReader (media/ffmpegLoudness.ts).
 * Figures count only for the file they came from: a changed or relinked file is "needed" again, and plays as it is
 * until measured.
 */
import type { TrackLoudness } from "../../../common/domain";
import type { Store } from "../store";
import { joinRoot } from "../paths";

/** The file a track's loudness is measured from, with the facts the library holds about it. */
export type LoudnessSource = { trackId: string; file: string; fileSize: number | null; fileMtimeMs: number | null };

export type LoudnessState =
  /** Measured from the track's current file. */
  | { state: "ready"; loudness: TrackLoudness }
  /** Tried, and this file could not be measured (unreadable or silent): not tried again until it changes. */
  | { state: "unmeasurable" }
  /** Not measured yet, or the file changed since: measure `source`. */
  | { state: "needed"; source: LoudnessSource }
  /** No such track, or it is a web address (no file to measure). */
  | { state: "none" };

type Row = {
  root_path: string | null;
  path: string | null;
  url: string | null;
  file_size: number | null;
  file_mtime_ms: number | null;
  measured: number;
  measured_size: number | null;
  measured_mtime_ms: number | null;
  lufs: number | null;
  true_peak_db: number | null;
};

/** One read by the track's key and the loudness row's key (both primary keys). */
const STATE_SQL = `
  SELECT r.path AS root_path, t.path, t.url, t.file_size, t.file_mtime_ms,
         l.track_id IS NOT NULL AS measured, l.file_size AS measured_size, l.file_mtime_ms AS measured_mtime_ms, l.lufs, l.true_peak_db
  FROM tracks t
  LEFT JOIN library_roots r ON r.id = t.root_id
  LEFT JOIN track_loudness l ON l.track_id = t.id
  WHERE t.id = ?`;

/**
 * A track's figures from its current file only, for a SELECT over `tracks` (repo/domain.ts): the columns, and the
 * join they need after `FROM tracks`. NULL when not measured, not measurable, or measured from another file. One
 * join by the primary key rather than a subquery per column: reading the whole library stays as fast as before.
 */
export const LOUDNESS_COLUMNS = "track_loudness.lufs AS loudness_lufs, track_loudness.true_peak_db AS loudness_peak";
export const LOUDNESS_JOIN = `LEFT JOIN track_loudness ON track_loudness.track_id = tracks.id
  AND track_loudness.file_size IS tracks.file_size AND track_loudness.file_mtime_ms IS tracks.file_mtime_ms`;

export function trackLoudness(store: Store, trackId: string): LoudnessState {
  const row = store.get<Row>(STATE_SQL, trackId);
  if (!row || row.url !== null || row.path === null) return { state: "none" };
  const sameFile = row.measured === 1 && row.measured_size === row.file_size && row.measured_mtime_ms === row.file_mtime_ms;
  if (sameFile) {
    return row.lufs === null || row.true_peak_db === null ? { state: "unmeasurable" } : { state: "ready", loudness: { lufs: row.lufs, truePeakDb: row.true_peak_db } };
  }
  const file = row.root_path === null ? row.path : joinRoot(row.root_path, row.path);
  return { state: "needed", source: { trackId, file, fileSize: row.file_size, fileMtimeMs: row.file_mtime_ms } };
}

/** Tracks with a file and no figures from that file yet, in library order (the background job after an upgrade). */
export function tracksNeedingLoudness(store: Store): string[] {
  return store
    .all<{ id: string }>(
      `SELECT id FROM tracks WHERE path IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM track_loudness l WHERE l.track_id = tracks.id AND l.file_size IS tracks.file_size AND l.file_mtime_ms IS tracks.file_mtime_ms)
       ORDER BY added_seq`,
    )
    .map((row) => row.id);
}

/** Every track measured from its current file, by id. */
export function allLoudness(store: Store): Map<string, TrackLoudness> {
  const rows = store.all<{ id: string; loudness_lufs: number | null; loudness_peak: number | null }>(`SELECT id, ${LOUDNESS_COLUMNS} FROM tracks ${LOUDNESS_JOIN}`);
  const out = new Map<string, TrackLoudness>();
  for (const row of rows) if (row.loudness_lufs !== null && row.loudness_peak !== null) out.set(row.id, { lufs: row.loudness_lufs, truePeakDb: row.loudness_peak });
  return out;
}

/**
 * Keeps what was measured from `source` (null: it could not be measured). Saved only while the track still has
 * that file; answers false when it was deleted or its file changed meanwhile. Bookkeeping outside undo, so it keeps
 * the undo history; throws LibraryBusyError during bulk work.
 */
export function saveLoudness(store: Store, source: LoudnessSource, loudness: TrackLoudness | null): boolean {
  if (loudness !== null) {
    const { lufs, truePeakDb } = loudness;
    if (!Number.isFinite(lufs) || !Number.isFinite(truePeakDb) || lufs < -70 || lufs > 0 || truePeakDb < -100 || truePeakDb > 12) {
      throw new RangeError(`Loudness must be -70 to 0 LUFS with a true peak of -100 to 12 dB, not ${lufs} LUFS and ${truePeakDb} dB.`);
    }
  }
  return store.changeWithoutHistory(
    () =>
      store.run(
        `INSERT INTO track_loudness (track_id, file_size, file_mtime_ms, lufs, true_peak_db, measured_at)
         SELECT id, file_size, file_mtime_ms, ?, ?, ? FROM tracks WHERE id = ? AND file_size IS ? AND file_mtime_ms IS ?
         ON CONFLICT (track_id) DO UPDATE SET
           file_size = excluded.file_size, file_mtime_ms = excluded.file_mtime_ms, lufs = excluded.lufs,
           true_peak_db = excluded.true_peak_db, measured_at = excluded.measured_at`,
        loudness?.lufs ?? null,
        loudness?.truePeakDb ?? null,
        store.now(),
        source.trackId,
        source.fileSize,
        source.fileMtimeMs,
      ) > 0,
    { bookkeeping: true },
  );
}
