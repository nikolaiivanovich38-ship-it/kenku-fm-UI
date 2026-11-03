/**
 * Data carry-over from upstream Kenku FM (FND-1).
 *
 * The first time the fork starts, it copies the old app's library (the
 * browser storage holding playlists, soundboards, bookmarks and settings) and
 * its window position file into the fork's own data folder. The old folder is
 * only read, never changed. Nothing that already exists is overwritten, and a
 * marker file makes sure the copy runs once.
 *
 * This module only uses `fs` and `path`, so it can be tested without Electron.
 */
import fs from "fs";
import path from "path";

/** Items copied from the old data folder, in order. */
export const CARRY_OVER_ITEMS = ["Local Storage", "Session Storage", "config.json"] as const;

/** Written into the destination folder once the carry-over has been decided. */
export const MARKER_FILE_NAME = "data-carry-over.json";

/** LevelDB lock files belong to the running app that owns them; never copy them. */
const SKIPPED_FILE_NAMES = new Set(["LOCK"]);

/** Per-process staging folder, so two app windows started at once cannot clash. */
const STAGING_DIR_NAME = `.data-carry-over-staging-${process.pid}`;

export type CarryOverStatus =
  /** At least one item was copied. */
  | "copied"
  /** The marker file shows the carry-over was already done on an earlier start. */
  | "already-done"
  /** No old Kenku FM data folder was found. */
  | "no-old-data"
  /** This app already has its own library, so nothing was copied. */
  | "destination-has-data"
  /** Something went wrong; see `errors`. Items that failed were not installed. */
  | "failed";

export type CarryOverResult = {
  status: CarryOverStatus;
  sourceDir: string;
  destDir: string;
  /** Top-level items copied (for example "Local Storage"). */
  copiedItems: string[];
  /** Top-level items left alone, with the reason. */
  skippedItems: { item: string; reason: string }[];
  /** Number of files copied across all items. */
  fileCount: number;
  errors: { item: string; message: string }[];
};

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

/** Write the marker once; if another start already wrote it, keep that one. */
function writeMarker(result: CarryOverResult): void {
  const marker = { ...result, decidedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(path.join(result.destDir, MARKER_FILE_NAME), JSON.stringify(marker, null, 2), {
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/**
 * Copy the old app's data from `sourceDir` into `destDir` once.
 *
 * Each item is copied into a staging folder first and moved into place only
 * when the whole item copied cleanly, so a read error never leaves a
 * half-copied database behind. Never throws: problems are reported in the
 * result's `errors`.
 */
export function carryOverLegacyData(sourceDir: string, destDir: string): CarryOverResult {
  const result: CarryOverResult = {
    status: "no-old-data",
    sourceDir,
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
    if (path.resolve(sourceDir) === path.resolve(destDir)) {
      result.status = "no-old-data";
      return result;
    }

    fs.mkdirSync(destDir, { recursive: true });

    if (exists(path.join(destDir, "Local Storage"))) {
      result.status = "destination-has-data";
      writeMarker(result);
      return result;
    }
    if (!isDirectory(sourceDir)) {
      result.status = "no-old-data";
      writeMarker(result);
      return result;
    }

    const stagingDir = path.join(destDir, STAGING_DIR_NAME);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir);
    try {
      for (const item of CARRY_OVER_ITEMS) {
        const source = path.join(sourceDir, item);
        const dest = path.join(destDir, item);
        if (!exists(source)) {
          result.skippedItems.push({ item, reason: "not in the old data folder" });
          continue;
        }
        if (exists(dest)) {
          result.skippedItems.push({ item, reason: "already exists here; left unchanged" });
          continue;
        }
        const staged = path.join(stagingDir, item);
        try {
          const count = copyTree(source, staged);
          fs.renameSync(staged, dest);
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
      result.status = "failed";
    } else if (result.copiedItems.length > 0) {
      result.status = "copied";
    } else {
      result.status = "no-old-data";
    }
    writeMarker(result);
  } catch (error) {
    result.status = "failed";
    result.errors.push({ item: "(setup)", message: (error as Error).message });
  }
  return result;
}

/** One plain-language sentence describing the result, for logs and later for the UI. */
export function describeCarryOver(result: CarryOverResult): string {
  switch (result.status) {
    case "copied":
      return `Your Kenku FM library was copied into this app (${result.copiedItems.join(", ")}; ${result.fileCount} files). Kenku FM itself was not changed.`;
    case "already-done":
      return "Kenku FM library carry-over already happened on an earlier start.";
    case "no-old-data":
      return "No Kenku FM library was found on this computer, so the app started empty.";
    case "destination-has-data":
      return "This app already has its own library, so nothing was copied from Kenku FM.";
    case "failed":
      return `Part of your Kenku FM library could not be copied (${result.errors
        .map((error) => `${error.item}: ${error.message}`)
        .join("; ")}). Kenku FM itself was not changed. See the README section "Bringing your Kenku FM library across".`;
  }
}
