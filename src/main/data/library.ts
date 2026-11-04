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
  latestGoodBackup,
  listBackups,
  writeBackup,
  writeDailyBackupIfDue,
  type BackupInfo,
} from "./backups";
import { checkInBackground, quickCheck } from "./integrity";
import { MIGRATIONS, migrate, schemaVersion, type Migration } from "./schema";
import { openConnection, type DatabaseSync } from "./sqlite";
import { Store } from "./store";
import { UndoHistory } from "./undo";

export const DATABASE_FILE_NAME = "library.sqlite";
export const BACKUP_FOLDER_NAME = "backups";

/** Where the library lives inside the app's data folder. */
export function libraryFolder(userDataPath: string): string {
  return path.join(userDataPath, "library");
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
  readonly store: Store;
  readonly history: UndoHistory;
  /** "Back up now". */
  backupNow(): BackupInfo;
  /** Makes today's backup unless one exists; returns it or null. */
  runDailyBackup(): BackupInfo | null;
  /** The integrity check started at open; never rejects. */
  checkIntegrity(): Promise<IntegrityReport>;
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

  let db: DatabaseSync;
  try {
    db = openConnection(databasePath);
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

  const ensureIdle = () => {
    if (store.inChange) throw new Error("Cannot back up while a change is running.");
  };

  return {
    databasePath,
    backupFolder,
    schemaVersion: schemaVersion(db),
    store,
    history,
    backupNow() {
      ensureIdle();
      return writeBackup(db, backupFolder, "manual", now());
    },
    runDailyBackup() {
      ensureIdle();
      return writeDailyBackupIfDue(db, backupFolder, now());
    },
    checkIntegrity: () => integrity,
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
 * The backup itself (VACUUM INTO) runs on the main process and holds it for
 * about half a second on a 43 MB library, once a day. Waiting keeps that out
 * of start-up, when the window and the player are loading. When this is wired
 * up (WP5), call it once the main window has been shown, never before.
 */
export function startDailyBackups(
  library: Library,
  options: { intervalMs?: number; firstRunDelayMs?: number; onError?: (error: unknown) => void } = {},
): () => void {
  const run = () => {
    try {
      library.runDailyBackup();
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
