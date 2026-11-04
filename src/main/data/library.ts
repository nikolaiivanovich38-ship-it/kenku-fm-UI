/**
 * Opens the library database: the one entry point the main process uses.
 *
 * Nothing here imports Electron. The caller passes the folder, normally
 * `libraryFolder(app.getPath("userData"))`, so tests run in plain Node.
 *
 * Opening an existing library first runs SQLite's quick integrity check. A
 * damaged file is not touched: opening fails with a LibraryDatabaseError
 * ("corrupt") that names the newest healthy backup, and `restoreBackup()`
 * puts that backup in place (keeping the damaged file aside).
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
};

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

function corrupt(backupFolder: string, cause: unknown): LibraryDatabaseError {
  const latestBackup = latestGoodBackup(backupFolder);
  return new LibraryDatabaseError(
    "corrupt",
    "Your library file is damaged and cannot be opened. " +
      (latestBackup
        ? "Cue Desk can put back your latest backup; the damaged file is kept aside."
        : "No backup was found to put back."),
    { cause, latestBackup },
  );
}

function checkIntegrity(db: DatabaseSync) {
  const rows = db.prepare("PRAGMA quick_check(1)").all() as { quick_check: string }[];
  if (rows.length !== 1 || rows[0].quick_check !== "ok") {
    throw new Error(`Integrity check failed: ${rows.map((row) => row.quick_check).join("; ")}`);
  }
}

export function openLibrary(options: LibraryOptions): Library {
  const now = options.now ?? Date.now;
  const migrations = options.migrations ?? MIGRATIONS;
  const databasePath = path.join(options.folder, DATABASE_FILE_NAME);
  const backupFolder = path.join(options.folder, BACKUP_FOLDER_NAME);
  fs.mkdirSync(options.folder, { recursive: true });
  const existed = fs.existsSync(databasePath);

  let db: DatabaseSync;
  try {
    db = openConnection(databasePath);
  } catch (error) {
    if (isCorruptionError(error)) throw corrupt(backupFolder, error);
    throw error;
  }

  try {
    if (existed) {
      try {
        checkIntegrity(db);
      } catch (error) {
        throw corrupt(backupFolder, error);
      }
      const from = schemaVersion(db);
      if (from > 0 && from < migrations.length) writeBackup(db, backupFolder, `upgrade-v${from}`, now());
    }
    migrate(db, migrations, now);
  } catch (error) {
    db.close();
    if (error instanceof LibraryDatabaseError) throw error;
    if (isCorruptionError(error)) throw corrupt(backupFolder, error);
    throw error;
  }

  const store = new Store(db, { now });
  const history = new UndoHistory(store, { limit: options.undoLimit });
  let closed = false;

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
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

/**
 * Puts a backup in place of a damaged library. The library must be closed.
 * The damaged file (and its -wal/-shm companions) is renamed, not deleted.
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
  if (fs.existsSync(databasePath)) fs.renameSync(databasePath, damagedCopy);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(databasePath + suffix)) fs.renameSync(databasePath + suffix, damagedCopy + suffix);
  }
  const partPath = `${databasePath}.part`;
  fs.copyFileSync(options.backupPath, partPath);
  fs.renameSync(partPath, databasePath);
  return { damagedCopy };
}

/**
 * Makes today's backup now and then checks every `intervalMs` (default one
 * hour) whether a new day has started. Failures go to `onError` (the app logs
 * them); the timer keeps running. Returns a function that stops it.
 */
export function startDailyBackups(
  library: Library,
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): () => void {
  const run = () => {
    try {
      library.runDailyBackup();
    } catch (error) {
      options.onError?.(error);
    }
  };
  run();
  const timer = setInterval(run, options.intervalMs ?? 60 * 60 * 1000);
  // Never keep the app alive just for backups.
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}
