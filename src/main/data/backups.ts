/**
 * Library backups (DAT-6).
 *
 * Copies are made with SQLite's VACUUM INTO, which writes a complete,
 * compact copy of the open library while the app keeps working. Each copy is
 * written under a temporary ".part" name, checked (PRAGMA quick_check), then
 * renamed, so a half-written copy never looks like a backup.
 *
 * Kinds, each keeping its newest 14 copies:
 * - daily: at most one per calendar day (local time);
 * - manual: "Back up now";
 * - upgrade: taken just before the library is upgraded to a new schema version.
 *
 * File names say the kind and the local time, for example
 * library-daily-2026-11-04T12-00-00-000.sqlite. Other files in the folder are
 * left alone.
 */
import fs from "fs";
import path from "path";
import { LibraryDatabaseError } from "./errors";
import { openConnection, type DatabaseSync } from "./sqlite";

export const BACKUPS_TO_KEEP = 14;

export type BackupKind = "daily" | "manual" | "upgrade";

export type BackupInfo = {
  path: string;
  kind: BackupKind;
  /** When the copy was made (from its name), in milliseconds. */
  createdAt: number;
};

const NAME = /^library-(daily|manual|upgrade-v\d+)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})\.sqlite$/;

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
      kind: kind.startsWith("upgrade") ? "upgrade" : (kind as BackupKind),
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

/** The newest backup that passes a quick check, or null. */
export function latestGoodBackup(folder: string): string | null {
  return listBackups(folder).find((backup) => isHealthyDatabase(backup.path))?.path ?? null;
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
 * @param label "daily", "manual" or "upgrade-v<from>"
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
  const kind: BackupKind = label.startsWith("upgrade") ? "upgrade" : (label as BackupKind);
  pruneBackups(folder, kind);
  return { path: finalPath, kind, createdAt: listBackups(folder).find((b) => b.path === finalPath)?.createdAt ?? now };
}

/** Makes today's daily backup unless there already is one; returns it, or null. */
export function writeDailyBackupIfDue(db: DatabaseSync, folder: string, now: number): BackupInfo | null {
  const today = localDate(now);
  const done = listBackups(folder).some((backup) => backup.kind === "daily" && localDate(backup.createdAt) === today);
  return done ? null : writeBackup(db, folder, "daily", now);
}
