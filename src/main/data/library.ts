/**
 * Opens the library database: the one entry point the main process uses.
 *
 * Nothing here imports Electron. The caller passes the folder, normally
 * `libraryFolder(app.getPath("userData"))`, so tests run in plain Node.
 *
 * Opening an existing library runs SQLite's quick integrity check. By default
 * the check runs on a worker thread so start-up is not held up (it takes
 * about 300 ms for 20,000 tracks); `checkIntegrity()` gives its result. A file
 * that is not a database at all, or a library about to be upgraded, is
 * checked before anything else happens. A damaged library is reported as a
 * LibraryDatabaseError ("corrupt"), and `restoreBackup()` puts a backup in
 * place (keeping the damaged file aside). The newest healthy backup is looked
 * for on the worker thread too, because each backup check reads a whole file:
 * `checkIntegrity()` names it, and for damage found while opening in the
 * default mode the caller asks `findLatestGoodBackup(backupFolder)`.
 * Before a schema upgrade a backup is taken, so an upgrade can always be
 * reversed by restoring it.
 */
import fs from "fs";
import path from "path";
import { LibraryDatabaseError } from "./errors";
import {
  backUpInBackground,
  dailyBackupDone,
  isHealthyDatabase,
  latestGoodBackup,
  listBackups,
  writeBackup,
  type BackupInfo,
} from "./backups";
import { checkInBackground, quickCheck } from "./integrity";
import { MIGRATIONS, migrate, schemaVersion, type Migration } from "./schema";
import { BUSY_TIMEOUT_MS, openConnection, type DatabaseSync } from "./sqlite";
import { Store } from "./store";
import { UndoHistory } from "./undo";

export const DATABASE_FILE_NAME = "library.sqlite";
export const BACKUP_FOLDER_NAME = "backups";

/**
 * Where the library lives (DB review 6). On Windows: under Local app data
 * (%LOCALAPPDATA%\lyre\library), not Roaming, which managed Windows may
 * redirect to a network share, where SQLite's write-ahead log cannot work and
 * a large file would be copied at every sign-in. Elsewhere: inside the app's
 * data folder. `userDataPath` is Electron's app.getPath("userData"); the app's
 * folder name is taken from it.
 */
export function libraryFolder(userDataPath: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    const base = local ? path.win32.join(local, path.win32.basename(userDataPath)) : userDataPath;
    return path.win32.join(base, "library");
  }
  return path.join(userDataPath, "library");
}

/**
 * True for a folder on a network share by its path (\\server\share, //server/share,
 * \\?\UNC\…). A mapped drive letter cannot be told from its path; there SQLite
 * itself refuses write-ahead logging and openConnection falls back to a journal.
 */
export function isNetworkPath(folder: string): boolean {
  if (/^[\\/][\\/]\?[\\/]unc[\\/]/i.test(folder)) return true;
  if (/^[\\/][\\/][?.][\\/]/.test(folder)) return false;
  return /^[\\/][\\/][^\\/]/.test(folder);
}

/**
 * Largest size the write-ahead log is cut back to once checkpointed (DB review
 * 6): after bulk work it reached 44 MB and stayed there.
 */
export const JOURNAL_SIZE_LIMIT = 8 * 1024 * 1024;

/**
 * Empties the write-ahead log into the library file after bulk work (DB review
 * 6). Commits already checkpoint every 1,000 pages (SQLite's default), and bulk
 * work commits about 500 rows at a time, so the log never grows far and this
 * copies little: tens of milliseconds at most. It does not wait for anyone: if
 * another connection is reading (a backup or the integrity check on a worker),
 * it copies what it can and leaves the rest to the next checkpoint.
 */
function truncateLog(db: DatabaseSync): void {
  db.exec("PRAGMA busy_timeout = 0");
  try {
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } catch {
    // Busy: tried again after the next bulk work; commits keep checkpointing meanwhile.
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
}

export type LibraryOptions = {
  /** Folder holding library.sqlite and its backups folder. */
  folder: string;
  /** Current time in milliseconds; injected for tests. */
  now?: () => number;
  /** Undo steps kept (default 100). */
  undoLimit?: number;
  /** Schema versions; tests pass extra ones to try upgrades. */
  migrations?: readonly Migration[];
  /**
   * "background" (default): the integrity check runs on a worker thread; see
   * `checkIntegrity()`. Damage found while opening (a file that is not a
   * database, or a library about to be upgraded) is thrown with
   * `latestBackup: null`; look for one with `findLatestGoodBackup()`.
   * "blocking": opening waits for the check and throws if the library is
   * damaged, naming the newest healthy backup (found on this thread; use
   * after restoring a backup, or in tools).
   */
  integrityCheck?: "background" | "blocking";
  /** "wal" or "delete" (a rollback journal); by default "delete" in a network folder (isNetworkPath), else "wal". */
  journal?: "wal" | "delete";
  /** Bytes the write-ahead log is cut back to (default JOURNAL_SIZE_LIMIT); tests use a small one. */
  journalSizeLimit?: number;
};

/** Result of the integrity check started when the library was opened. */
export type IntegrityReport =
  | { status: "ok" }
  /** Stop using the library and offer `error.latestBackup` (see restoreBackup). */
  | { status: "corrupt"; error: LibraryDatabaseError }
  /** The library was closed before the check finished. */
  | { status: "not-checked" };

export type Library = {
  readonly databasePath: string;
  readonly backupFolder: string;
  readonly schemaVersion: number;
  /** "wal", or "delete" when the folder is on a network share (DB review 6). */
  readonly journalMode: "wal" | "delete";
  readonly store: Store;
  readonly history: UndoHistory;
  /** "Back up now", made on a worker thread (DB review 1). Throws at once during a change or bulk work. */
  backupNow(): Promise<BackupInfo>;
  /** Makes today's backup on a worker thread unless one exists; resolves to it or null. */
  runDailyBackup(): Promise<BackupInfo | null>;
  /** The copy made before the old player's library moves in (DAT-9), on a worker thread. */
  backupBeforeImport(): Promise<BackupInfo>;
  /** The integrity check started at open; never rejects. */
  checkIntegrity(): Promise<IntegrityReport>;
  /** Empties the write-ahead log into the library file when nothing else is reading; runs by itself after bulk work. */
  checkpoint(): void;
  close(): void;
};

/** SQLite result codes that mean the file is damaged or not a database. */
const CORRUPT_CODES = new Set([11 /* SQLITE_CORRUPT */, 26 /* SQLITE_NOTADB */]);

function isCorruptionError(error: unknown): boolean {
  const code = (error as { errcode?: number }).errcode;
  return (
    (typeof code === "number" && CORRUPT_CODES.has(code & 0xff)) ||
    /malformed|not a database|corrupt/i.test(error instanceof Error ? error.message : "")
  );
}

/**
 * @param latestBackup the newest healthy backup, null when there is none, or
 * undefined when none was looked for (the caller then asks
 * `findLatestGoodBackup`, which works on a worker thread).
 */
function corrupt(cause: unknown, latestBackup: string | null | undefined): LibraryDatabaseError {
  const offer =
    latestBackup === undefined
      ? ""
      : latestBackup
        ? " Lyre can put back your latest backup; the damaged file is kept aside."
        : " No backup was found to put back.";
  return new LibraryDatabaseError("corrupt", `Your library file is damaged and cannot be opened.${offer}`, {
    cause,
    latestBackup,
  });
}

export function openLibrary(options: LibraryOptions): Library {
  const now = options.now ?? Date.now;
  const migrations = options.migrations ?? MIGRATIONS;
  const databasePath = path.join(options.folder, DATABASE_FILE_NAME);
  const backupFolder = path.join(options.folder, BACKUP_FOLDER_NAME);
  fs.mkdirSync(options.folder, { recursive: true });
  const existed = fs.existsSync(databasePath);
  const blocking = options.integrityCheck === "blocking";
  // Review 9: checking backups reads each one in full, so it happens on this
  // thread only when the caller asked to block.
  const corruptAtOpen = (cause: unknown) => corrupt(cause, blocking ? latestGoodBackup(backupFolder) : undefined);

  const journal = options.journal ?? (isNetworkPath(options.folder) ? "delete" : "wal");
  let db: DatabaseSync;
  try {
    db = openConnection(databasePath, { journal });
  } catch (error) {
    if (isCorruptionError(error)) throw corruptAtOpen(error);
    throw error;
  }

  let checkedAtOpen = !existed;
  try {
    if (existed) {
      // Reading the version also proves the file is a database at all.
      const from = schemaVersion(db);
      const upgrading = from > 0 && from < migrations.length;
      if (upgrading || blocking) {
        const result = quickCheck(db);
        if (!result.ok) throw corruptAtOpen(new Error(result.detail));
        checkedAtOpen = true;
      }
      if (upgrading) writeBackup(db, backupFolder, `upgrade-v${from}`, now());
    }
    migrate(db, migrations, now);
  } catch (error) {
    db.close();
    if (error instanceof LibraryDatabaseError) throw error;
    if (isCorruptionError(error)) throw corruptAtOpen(error);
    throw error;
  }

  const store = new Store(db, { now });
  const history = new UndoHistory(store, { limit: options.undoLimit });
  let closed = false;

  // DB review 6: a log cut back to journal_size_limit, and emptied after bulk work.
  const journalMode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode === "wal" ? "wal" : "delete";
  const checkpoint = () => {
    if (journalMode === "wal" && !closed && !store.inChange) truncateLog(db);
  };
  if (journalMode === "wal") {
    db.exec(`PRAGMA journal_size_limit = ${Math.max(0, Math.floor(options.journalSizeLimit ?? JOURNAL_SIZE_LIMIT))}`);
    store.setAfterBulkWork(checkpoint);
  }

  // The backups are listed now (a folder listing) but checked on the worker,
  // and only if the library turns out to be damaged.
  const background = checkedAtOpen
    ? null
    : checkInBackground({ library: databasePath, backups: listBackups(backupFolder).map((backup) => backup.path) });
  const integrity: Promise<IntegrityReport> = background
    ? background.result.then((result): IntegrityReport => {
        if (result === "cancelled") return { status: "not-checked" };
        const library = result.library!;
        return library.ok
          ? { status: "ok" }
          : { status: "corrupt", error: corrupt(new Error(library.detail), result.latestGoodBackup) };
      })
    : Promise.resolve({ status: "ok" });

  // A copy taken mid-change or between the batches of bulk work would hold half of it.
  const ensureIdle = () => {
    if (store.inChange) throw new Error("Cannot back up while a change is running.");
    store.refuseWhileBusy();
  };
  const backUp = (label: string) => {
    ensureIdle();
    return backUpInBackground(databasePath, backupFolder, label, now());
  };

  return {
    databasePath,
    backupFolder,
    schemaVersion: schemaVersion(db),
    journalMode,
    store,
    history,
    backupNow: () => backUp("manual"),
    runDailyBackup: () => (dailyBackupDone(backupFolder, now()) ? Promise.resolve(null) : backUp("daily")),
    backupBeforeImport: () => backUp("before-import"),
    checkIntegrity: () => integrity,
    checkpoint,
    close() {
      if (closed) return;
      closed = true;
      background?.cancel();
      try {
        // SQLite's advice: refresh the query planner's statistics when they would help (cheap; usually does nothing).
        db.exec("PRAGMA optimize");
      } catch {
        // Closing matters more than the statistics.
      }
      db.close();
    },
  };
}

/** Copies `from` to `to` and makes sure the copy has reached the disk. */
function copyToDisk(from: string, to: string) {
  fs.copyFileSync(from, to);
  const fd = fs.openSync(to, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Puts a backup in place of a damaged library. The library must be closed.
 * The damaged file (and its -wal/-shm companions) is renamed, not deleted.
 *
 * Order matters: the backup is first copied next to the library as a ".part"
 * file and written to disk. Only then is the damaged file moved aside and the
 * copy renamed into place. If the copy fails (full disk, a virus scanner
 * holding the backup), the damaged library stays where it was: without it,
 * the next start would make a new, empty library, and after 14 days of daily
 * backups of that empty library the last good backup would be pruned.
 */
export function restoreBackup(options: { folder: string; backupPath: string; now?: () => number }): {
  damagedCopy: string;
} {
  const now = (options.now ?? Date.now)();
  const databasePath = path.join(options.folder, DATABASE_FILE_NAME);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const damagedCopy = path.join(options.folder, `library-damaged-${stamp}.sqlite`);
  const known = listBackups(path.join(options.folder, BACKUP_FOLDER_NAME)).some(
    (backup) => path.resolve(backup.path) === path.resolve(options.backupPath),
  );
  if (!known) throw new Error("Only a backup from this library's backups folder can be restored.");
  // DAT-6: putting back a damaged copy would replace one damaged library with another.
  if (!isHealthyDatabase(options.backupPath)) {
    throw new Error("That backup is damaged and cannot be put back. Choose an older backup.");
  }
  const partPath = `${databasePath}.part`;
  try {
    copyToDisk(options.backupPath, partPath);
  } catch (error) {
    fs.rmSync(partPath, { force: true });
    throw error;
  }
  if (fs.existsSync(databasePath)) fs.renameSync(databasePath, damagedCopy);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(databasePath + suffix)) fs.renameSync(databasePath + suffix, damagedCopy + suffix);
  }
  fs.renameSync(partPath, databasePath);
  return { damagedCopy };
}

/** How long after `startDailyBackups` the first daily backup is made. */
export const FIRST_DAILY_BACKUP_DELAY_MS = 2 * 60 * 1000;

/**
 * Makes today's backup `firstRunDelayMs` after the call (default two minutes)
 * and then checks every `intervalMs` (default one hour) whether a new day has
 * started. Failures go to `onError` (the app logs them); the timer keeps
 * running. Returns a function that stops it (call it before `library.close()`).
 *
 * The copy is made on a worker thread (DB review 1), so it does not hold up
 * the main process; waiting still keeps its disk reads out of start-up, when
 * the window and the player are loading. Call it once the main window has
 * been shown. A backup that would fall in a bulk change or a change is
 * reported to `onError` (LibraryBusyError) and made at the next hourly check.
 */
export function startDailyBackups(
  library: Library,
  options: { intervalMs?: number; firstRunDelayMs?: number; onError?: (error: unknown) => void } = {},
): () => void {
  const run = () => {
    try {
      library.runDailyBackup().catch((error: unknown) => options.onError?.(error));
    } catch (error) {
      options.onError?.(error);
    }
  };
  // Never keep the app alive just for backups.
  const unref = (timer: unknown) => (timer as { unref?: () => void }).unref?.();
  let interval: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    run();
    interval = setInterval(run, options.intervalMs ?? 60 * 60 * 1000);
    unref(interval);
  }, options.firstRunDelayMs ?? FIRST_DAILY_BACKUP_DELAY_MS);
  unref(first);
  return () => {
    clearTimeout(first);
    if (interval !== undefined) clearInterval(interval);
  };
}
