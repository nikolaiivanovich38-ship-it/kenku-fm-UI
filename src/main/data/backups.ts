/**
 * Library backups (DAT-6).
 *
 * Copies are made with SQLite's VACUUM INTO, which writes a complete,
 * compact copy of the open library while the app keeps working. Each copy is
 * written under a temporary ".part" name, checked (PRAGMA quick_check), then
 * renamed, so a half-written copy never looks like a backup.
 *
 * Daily, "Back up now" and before-import copies are made on a worker thread
 * (`backUpInBackground`), from its own read-only connection: a copy of a large
 * library takes about 0.3 s, longer than the 200 ms of sound Discord's queue
 * holds on the main process (DB review 1). The copy before a schema upgrade is
 * made while opening (`writeBackup`), before anything plays.
 *
 * Kinds, each keeping its newest 14 copies:
 * - daily: at most one per calendar day (local time);
 * - manual: "Back up now";
 * - upgrade: taken just before the library is upgraded to a new schema version;
 * - import: taken just before the old player's library is moved in (DAT-9).
 *
 * File names say the kind and the local time, for example
 * library-daily-2026-11-04T12-00-00-000.sqlite. Other files in the folder are
 * left alone.
 */
import fs from "fs";
import path from "path";
import { LibraryDatabaseError } from "./errors";
import { checkInBackground, runInWorker } from "./integrity";
import { openConnection, type DatabaseSync } from "./sqlite";

export const BACKUPS_TO_KEEP = 14;

export type BackupKind = "daily" | "manual" | "upgrade" | "import";

export type BackupInfo = {
  path: string;
  kind: BackupKind;
  /** When the copy was made (from its name), in milliseconds. */
  createdAt: number;
};

const NAME = /^library-(daily|manual|upgrade-v\d+|before-import)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})\.sqlite$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Local calendar date, YYYY-MM-DD. */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${localDate(ms)}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

/** The kind a backup's label names: "upgrade-v2" is an upgrade backup, "before-import" an import one. */
function kindOfLabel(label: string): BackupKind {
  if (label.startsWith("upgrade")) return "upgrade";
  if (label === "before-import") return "import";
  return label as BackupKind;
}

/** Backups in `folder`, newest first. */
export function listBackups(folder: string): BackupInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const backups: BackupInfo[] = [];
  for (const name of names) {
    const match = NAME.exec(name);
    if (!match) continue;
    const [, kind, year, month, day, hour, minute, second, ms] = match;
    backups.push({
      path: path.join(folder, name),
      kind: kindOfLabel(kind),
      createdAt: new Date(+year, +month - 1, +day, +hour, +minute, +second, +ms).getTime(),
    });
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt || b.path.localeCompare(a.path));
}

/** True when the file opens as a SQLite database and passes a quick check. */
export function isHealthyDatabase(file: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = openConnection(file, { readOnly: true });
    const rows = db.prepare("PRAGMA quick_check(1)").all() as { quick_check: string }[];
    return rows.length === 1 && rows[0].quick_check === "ok";
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/**
 * The newest backup that passes a quick check, or null. Checks run on the
 * calling thread, one backup after another (each reads the whole file), so
 * the main process uses `findLatestGoodBackup` instead.
 */
export function latestGoodBackup(folder: string): string | null {
  return listBackups(folder).find((backup) => isHealthyDatabase(backup.path))?.path ?? null;
}

/** Like `latestGoodBackup`, with the checks on a worker thread; never rejects. */
export async function findLatestGoodBackup(folder: string): Promise<string | null> {
  const backups = listBackups(folder).map((backup) => backup.path);
  if (backups.length === 0) return null;
  const found = await checkInBackground({ backups }).result;
  return found === "cancelled" ? null : found.latestGoodBackup;
}

/** Deletes the oldest backups of `kind` beyond `keep`. */
export function pruneBackups(folder: string, kind: BackupKind, keep = BACKUPS_TO_KEEP): void {
  for (const old of listBackups(folder)
    .filter((backup) => backup.kind === kind)
    .slice(keep)) {
    fs.rmSync(old.path, { force: true });
  }
}

/**
 * Writes a checked copy of the open library into `folder`.
 * @param label "daily", "manual", "upgrade-v<from>" or "before-import"
 */
export function writeBackup(db: DatabaseSync, folder: string, label: string, now: number): BackupInfo {
  const finalPath = path.join(folder, `library-${label}-${localStamp(now)}.sqlite`);
  const partPath = `${finalPath}.part`;
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.rmSync(partPath, { force: true });
    db.prepare("VACUUM INTO ?").run(partPath);
    if (!isHealthyDatabase(partPath)) throw new Error("The new backup did not pass its check.");
    fs.renameSync(partPath, finalPath);
  } catch (error) {
    try {
      fs.rmSync(partPath, { force: true });
    } catch {
      // The folder itself may be unusable; the error below says so.
    }
    throw new LibraryDatabaseError(
      "backup-failed",
      `Lyre could not back up your library to ${folder}. ` + (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
  const kind = kindOfLabel(label);
  pruneBackups(folder, kind);
  return { path: finalPath, kind, createdAt: listBackups(folder).find((b) => b.path === finalPath)?.createdAt ?? now };
}

/** Copies the library and checks the copy, on the worker thread: { ok, detail }. */
const BACKUP_WORKER = `
let ok = false;
let detail = "";
let db;
try {
  db = new DatabaseSync(workerData.library, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("VACUUM INTO ?").run(workerData.part);
  db.close();
  db = new DatabaseSync(workerData.part, { readOnly: true });
  const rows = db.prepare("PRAGMA quick_check(1)").all();
  ok = rows.length === 1 && rows[0].quick_check === "ok";
  if (!ok) detail = "The new backup did not pass its check.";
} catch (error) {
  detail = String((error && error.message) || error);
} finally {
  if (db && db.isOpen) db.close();
}
parentPort.postMessage({ ok, detail });
`;

/**
 * Writes a checked copy of the library file at `databasePath` into `folder`
 * on a worker thread (DB review 1); the main process only names, renames and
 * prunes files. The library may be in use meanwhile: the copy is of the
 * moment the worker starts reading.
 * @param label "daily", "manual" or "before-import"
 */
export async function backUpInBackground(databasePath: string, folder: string, label: string, now: number): Promise<BackupInfo> {
  const finalPath = path.join(folder, `library-${label}-${localStamp(now)}.sqlite`);
  const partPath = `${finalPath}.part`;
  const failed = (error: unknown) => {
    try {
      fs.rmSync(partPath, { force: true });
    } catch {
      // The folder itself may be unusable; the error below says so.
    }
    return new LibraryDatabaseError(
      "backup-failed",
      `Lyre could not back up your library to ${folder}. ` + (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  };
  try {
    if (!fs.existsSync(databasePath)) throw new Error("The library file was not found.");
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.rm(partPath, { force: true });
    const result = await runInWorker<{ ok: boolean; detail: string }>(BACKUP_WORKER, { library: databasePath, part: partPath });
    if (!result.ok) throw new Error(result.detail);
    await fs.promises.rename(partPath, finalPath);
  } catch (error) {
    throw failed(error);
  }
  const kind = kindOfLabel(label);
  pruneBackups(folder, kind);
  return { path: finalPath, kind, createdAt: listBackups(folder).find((b) => b.path === finalPath)?.createdAt ?? now };
}

/** True when there is already a daily backup for the local day of `now`. */
export function dailyBackupDone(folder: string, now: number): boolean {
  const today = localDate(now);
  return listBackups(folder).some((backup) => backup.kind === "daily" && localDate(backup.createdAt) === today);
}
