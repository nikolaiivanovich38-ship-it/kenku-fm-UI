/**
 * EDT-6: which files are audio, and finding them in the files and folders the
 * game master chose (Add files…, Add a folder…, or dropped on the Library).
 * Folders are walked with their subfolders; links are not followed (a folder
 * linking to itself would never end), and hidden and Windows system folders
 * are left alone.
 */
import fs from "fs";
import path from "path";
import { throwIfCancelled } from "./cancel";

/**
 * Extensions Lyre adds: the prototype's list (core.js isAudioName) and every
 * format the player converts before playing (src/main/media/formats.ts).
 */
export const AUDIO_EXTENSIONS: readonly string[] = [
  ".flac", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wma", ".aif", ".aiff",
  ".aifc", ".asf", ".mka", ".ape", ".wv", ".tta", ".ac3", ".mpc",
];

const AUDIO = new Set(AUDIO_EXTENSIONS);

/** Folders never walked: Windows' own and any hidden folder (name starting with "."). */
const SKIPPED_FOLDERS = new Set(["$recycle.bin", "system volume information"]);

/** Why a file is not added: its name or (UX review 3) its content is not audio. */
export const NOT_AUDIO = "not an audio file Lyre can play";

export function isAudioFile(name: string): boolean {
  return AUDIO.has(path.extname(name).toLowerCase());
}

/** An audio file found, with the folder the game master chose it through (its kind is guessed from there down). */
export type FoundFile = { path: string; chosenFolder: string };

/** Something given that could not be used, in plain words. */
export type ImportProblem = { path: string; reason: string };

/** Natural order: "2 Khazad-dum" before "10 Numenor", letter case ignored. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The same file whichever way its full path was written. Letter case is
 * ignored for every path (as Windows does, and as the library's unique path
 * indexes will, with COLLATE NOCASE: DB review item 4), so a file is never
 * offered to the database twice; a Windows path (drive letter or \\server)
 * also ignores slash direction. Decided by the path's own style, as in
 * ../paths.ts, so it works the same on every computer.
 */
export function fileKey(filePath: string): string {
  const windows = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
  return (windows ? path.win32 : path.posix).normalize(filePath).toLowerCase();
}

async function walk(folder: string, chosenFolder: string, out: FoundFile[], problems: ImportProblem[], signal?: AbortSignal) {
  throwIfCancelled(signal);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch (error) {
    problems.push({ path: folder, reason: `this folder could not be read (${(error as NodeJS.ErrnoException).code ?? "error"})` });
    return;
  }
  entries.sort((a, b) => collator.compare(a.name, b.name));
  // Files of a folder first, then its subfolders, as a file manager lists an album with its discs.
  for (const entry of entries) {
    if (entry.isFile() && isAudioFile(entry.name)) out.push({ path: path.join(folder, entry.name), chosenFolder });
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name.toLowerCase())) continue;
    await walk(path.join(folder, entry.name), chosenFolder, out, problems, signal);
  }
}

/**
 * The audio files in `paths` (files and folders, full paths), each once, in
 * the order given (a folder's files in natural order). Files that are not
 * audio, or not there, are listed as problems; inside a folder, other files
 * are simply passed over.
 */
export async function collectAudioFiles(
  paths: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<{ files: FoundFile[]; problems: ImportProblem[] }> {
  const found: FoundFile[] = [];
  const problems: ImportProblem[] = [];
  for (const given of paths) {
    throwIfCancelled(options.signal);
    let stats: fs.Stats;
    try {
      stats = await fs.promises.lstat(given);
    } catch {
      problems.push({ path: given, reason: "not found" });
      continue;
    }
    if (stats.isDirectory()) {
      await walk(given, given, found, problems, options.signal);
    } else if (stats.isFile() && isAudioFile(given)) {
      found.push({ path: given, chosenFolder: path.dirname(given) });
    } else {
      problems.push({ path: given, reason: NOT_AUDIO });
    }
  }
  const seen = new Set<string>();
  const files = found.filter((file) => {
    const key = fileKey(file.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { files, problems };
}

