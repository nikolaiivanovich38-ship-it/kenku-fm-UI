/**
 * Data carry-over from earlier apps (FND-1): Cue Desk (Lyre's working name in
 * the 0.1 drafts) and upstream Kenku FM.
 *
 * The first time Lyre starts, it copies an earlier app's library (the browser
 * storage holding playlists, soundboards, bookmarks and settings) and its
 * window position file into Lyre's own data folder. The earlier apps are tried
 * newest first; the first whose folder holds a library is the one copied. The
 * old folder is only read, never changed. Nothing that already exists is
 * overwritten, and a marker file makes sure the copy runs once. The marker is
 * not written when the copy failed or that app was still running, so the next
 * start tries again (and never falls back to an older app's library meanwhile).
 *
 * This module only uses `fs` and `path`, so it can be tested without Electron.
 */
import fs from "fs";
import path from "path";
import packageJson from "../../../package.json";

/** This app's display name, for messages. */
const APP_NAME: string = packageJson.productName;

/** Items copied from Kenku FM's data folder, in order. */
export const CARRY_OVER_ITEMS = ["Local Storage", "Session Storage", "config.json"] as const;

/**
 * Items copied from Cue Desk's data folder: Kenku FM's, plus the files Cue
 * Desk added. `Local State` holds the key that decrypts the saved bot tokens
 * in `discord-bots.json` on Windows, so the two travel together.
 */
export const CUE_DESK_ITEMS = [
  ...CARRY_OVER_ITEMS,
  "Local State",
  "discord-bots.json",
  "local-files.json",
  "library",
] as const;

/** An earlier app whose library Lyre may copy. */
export type EarlierApp = {
  /** Display name, used in messages ("Kenku FM"). */
  name: string;
  /** Its data folder. */
  dir: string;
  /** Top-level items to copy, in order. Defaults to `CARRY_OVER_ITEMS`. */
  items?: readonly string[];
};

/** Written into the destination folder once the carry-over has been decided. */
export const MARKER_FILE_NAME = "data-carry-over.json";

/** LevelDB lock files belong to the running app that owns them; never copy them. */
const SKIPPED_FILE_NAMES = new Set(["LOCK"]);

/** The folder that holds an app's library; an earlier app without it has nothing to copy. */
const LIBRARY_ITEM = "Local Storage";

/** LevelDB holds this file open while the app that owns it runs. */
const LEGACY_LOCK_FILE = path.join(LIBRARY_ITEM, "leveldb", "LOCK");

/** Shown when an earlier app is still running, so its library cannot be copied safely. */
export function appRunningMessage(appName: string): string {
  return `${appName} is still running. Close it and restart ${APP_NAME} to bring your library across.`;
}

/** Error codes Windows returns when another program holds a file. */
const FILE_IN_USE_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/** Per-process staging folder, so two app windows started at once cannot clash. */
const STAGING_DIR_NAME = `.data-carry-over-staging-${process.pid}`;

export type CarryOverStatus =
  /** At least one item was copied. */
  | "copied"
  /** The marker file shows the carry-over was already done on an earlier start. */
  | "already-done"
  /** No earlier app's library was found. */
  | "no-old-data"
  /** This app already has its own library, so nothing was copied. */
  | "destination-has-data"
  /** The earlier app is still running; nothing was copied. Tried again next start. */
  | "legacy-app-running"
  /** Something went wrong; see `errors`. Items that failed were not installed. Tried again next start. */
  | "failed";

export type CarryOverResult = {
  status: CarryOverStatus;
  /** The earlier app whose library was chosen ("Cue Desk", "Kenku FM"), once one was. */
  sourceApp?: string;
  /** Its data folder, or "" when none was chosen. */
  sourceDir: string;
  destDir: string;
  /** Top-level items copied (for example "Local Storage"). */
  copiedItems: string[];
  /** Top-level items left alone, with the reason. */
  skippedItems: { item: string; reason: string }[];
  /** Number of files copied across all items. */
  fileCount: number;
  errors: { item: string; message: string }[];
  /** Plain-language reason when nothing could be copied yet (for example Kenku FM is running). */
  reason?: string;
};

/** The file operations `isLockFileHeld` needs; replaced by fakes in tests. */
export type LockFileIo = Pick<typeof fs, "openSync" | "readSync" | "closeSync">;

export type CarryOverOptions = {
  /** True when the app that owns the given data folder is running. Defaults to `isLegacyAppRunning`. */
  isLegacyAppRunning?: (sourceDir: string) => boolean;
};

/**
 * FND-1: true when another program holds `lockFile`. Chromium's LevelDB keeps
 * the LOCK file open and locked while the app runs, so on Windows opening it
 * for writing (or reading it) fails with EBUSY, EPERM or EACCES. Nothing is
 * written. A missing file, or any other error, counts as not held. On macOS
 * and Linux the lock is advisory and cannot be seen this way, so this returns
 * false there.
 */
export function isLockFileHeld(lockFile: string, io: LockFileIo = fs): boolean {
  const isInUse = (error: unknown) => FILE_IN_USE_CODES.has((error as NodeJS.ErrnoException).code ?? "");
  let fd: number;
  try {
    fd = io.openSync(lockFile, "r+");
  } catch (error) {
    return isInUse(error);
  }
  try {
    io.readSync(fd, Buffer.alloc(1), 0, 1, 0);
    return false;
  } catch (error) {
    return isInUse(error);
  } finally {
    io.closeSync(fd);
  }
}

/** FND-1: true when the app owning `sourceDir` is running, judged by its Local Storage lock file. */
export function isLegacyAppRunning(sourceDir: string): boolean {
  return isLockFileHeld(path.join(sourceDir, LEGACY_LOCK_FILE));
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function exists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `source` to `dest` (file or directory tree), skipping LevelDB LOCK
 * files and anything that is not a plain file or folder (symbolic links are
 * not followed). Throws on the first read or write error.
 * Returns the number of files copied.
 */
function copyTree(source: string, dest: string): number {
  const stats = fs.lstatSync(source);
  if (stats.isFile()) {
    fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
    return 1;
  }
  if (!stats.isDirectory()) {
    return 0;
  }
  fs.mkdirSync(dest);
  let count = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isFile() && SKIPPED_FILE_NAMES.has(entry.name)) {
      continue;
    }
    count += copyTree(path.join(source, entry.name), path.join(dest, entry.name));
  }
  return count;
}

/**
 * Write the marker once; if another start already wrote it, keep that one.
 * It holds folder and item names only: full paths contain the user's name.
 */
function writeMarker(result: CarryOverResult): void {
  const marker = {
    status: result.status,
    sourceFolder: path.basename(result.sourceDir),
    destFolder: path.basename(result.destDir),
    copiedItems: result.copiedItems,
    skippedItems: result.skippedItems,
    fileCount: result.fileCount,
    decidedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(result.destDir, MARKER_FILE_NAME), JSON.stringify(marker, null, 2), {
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/**
 * Copy the library of the first earlier app in `earlierApps` (newest first)
 * whose folder holds one into `destDir`, once.
 *
 * Each item is copied into a staging folder first and moved into place only
 * when the whole item copied cleanly, so a read error never leaves a
 * half-copied database behind. Never throws: problems are reported in the
 * result's `errors`. Nothing is copied while the chosen app is running.
 */
export function carryOverEarlierData(
  earlierApps: readonly EarlierApp[],
  destDir: string,
  { isLegacyAppRunning: isRunning = isLegacyAppRunning }: CarryOverOptions = {},
): CarryOverResult {
  const result: CarryOverResult = {
    status: "no-old-data",
    sourceDir: "",
    destDir,
    copiedItems: [],
    skippedItems: [],
    fileCount: 0,
    errors: [],
  };

  try {
    if (exists(path.join(destDir, MARKER_FILE_NAME))) {
      result.status = "already-done";
      return result;
    }

    fs.mkdirSync(destDir, { recursive: true });

    if (exists(path.join(destDir, LIBRARY_ITEM))) {
      result.status = "destination-has-data";
      writeMarker(result);
      return result;
    }
    const source = earlierApps.find(
      (earlier) => path.resolve(earlier.dir) !== path.resolve(destDir) && isDirectory(path.join(earlier.dir, LIBRARY_ITEM)),
    );
    if (!source) {
      result.status = "no-old-data";
      writeMarker(result);
      return result;
    }
    result.sourceApp = source.name;
    result.sourceDir = source.dir;
    if (isRunning(source.dir)) {
      result.status = "legacy-app-running";
      result.reason = appRunningMessage(source.name);
      return result;
    }

    const stagingDir = path.join(destDir, STAGING_DIR_NAME);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir);
    try {
      for (const item of source.items ?? CARRY_OVER_ITEMS) {
        const from = path.join(source.dir, item);
        const to = path.join(destDir, item);
        if (!exists(from)) {
          result.skippedItems.push({ item, reason: "not in the old data folder" });
          continue;
        }
        if (exists(to)) {
          result.skippedItems.push({ item, reason: "already exists here; left unchanged" });
          continue;
        }
        const staged = path.join(stagingDir, item);
        try {
          const count = copyTree(from, staged);
          fs.renameSync(staged, to);
          result.copiedItems.push(item);
          result.fileCount += count;
        } catch (error) {
          fs.rmSync(staged, { recursive: true, force: true });
          result.errors.push({ item, message: (error as Error).message });
        }
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }

    if (result.errors.length > 0) {
      // No marker: the next start retries the items that failed.
      result.status = "failed";
      return result;
    }
    result.status = result.copiedItems.length > 0 ? "copied" : "no-old-data";
    writeMarker(result);
  } catch (error) {
    result.status = "failed";
    result.errors.push({ item: "(setup)", message: (error as Error).message });
  }
  return result;
}

/** One plain-language sentence describing the result, for logs and later for the UI. */
export function describeCarryOver(result: CarryOverResult): string {
  const source = result.sourceApp ?? "the earlier app";
  switch (result.status) {
    case "copied":
      return `Your ${source} library was copied into ${APP_NAME} (${result.copiedItems.join(", ")}; ${result.fileCount} files). ${source} itself was not changed.`;
    case "already-done":
      return "The library carry-over already happened on an earlier start.";
    case "no-old-data":
      return `No Cue Desk or Kenku FM library was found on this computer, so ${APP_NAME} started empty.`;
    case "destination-has-data":
      return `${APP_NAME} already has its own library, so nothing was copied from Cue Desk or Kenku FM.`;
    case "legacy-app-running":
      return appRunningMessage(source);
    case "failed":
      return `Part of your ${source} library could not be copied (${result.errors
        .map((error) => `${error.item}: ${error.message}`)
        .join("; ")}). ${source} itself was not changed. Close ${source} and start ${APP_NAME} again to retry.`;
  }
}
