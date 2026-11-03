/**
 * Plain-language summary of a drag-and-drop import, so the user knows what
 * was added, what was skipped and what to do if something went wrong.
 * Pure functions; the containers pass the result to `notify`.
 */
import { AUDIO_FORMATS_LABEL } from "./fileTypes";
import {
  Directories,
  Directory,
  FolderImportResult,
  ImportProblem,
  ROOT_PATH,
} from "./folderImport";
import type { Notification } from "./notifications";

/**
 * Where the files were dropped:
 * - "playlists" / "soundboards": each folder becomes a new collection;
 *   loose files are not added.
 * - "playlist" / "soundboard": every audio file joins the open collection.
 */
export type ImportTarget = "playlists" | "playlist" | "soundboards" | "soundboard";

const ITEM_WORDS: Record<ImportTarget, [string, string]> = {
  playlists: ["track", "tracks"],
  playlist: ["track", "tracks"],
  soundboards: ["sound", "sounds"],
  soundboard: ["sound", "sounds"],
};

const COLLECTION_WORDS: Record<ImportTarget, [string, string]> = {
  playlists: ["playlist", "playlists"],
  playlist: ["playlist", "playlists"],
  soundboards: ["soundboard", "soundboards"],
  soundboard: ["soundboard", "soundboards"],
};

const RETRY_HINT = "Try adding the files with the + button instead.";

function plural(count: number, [one, many]: [string, string]): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Dropped folders (not the loose-file root) that contain audio. */
export function foldersWithAudio(directories: Directories): Directory[] {
  return Object.values(directories).filter(
    (directory) => directory.path !== ROOT_PATH && directory.audioFiles.length > 0
  );
}

function skippedSentence(skipped: string[]): string | null {
  if (skipped.length === 0) {
    return null;
  }
  if (skipped.length === 1) {
    return `Skipped 1 file that isn't audio (${skipped[0]}).`;
  }
  return `Skipped ${skipped.length} files that aren't audio (e.g. ${skipped[0]}).`;
}

function unreadableSentence(problems: ImportProblem[]): string | null {
  if (problems.length === 0) {
    return null;
  }
  const folders = problems.filter((problem) => problem.kind === "folder");
  const group = folders.length > 0 ? folders : problems;
  const kind = folders.length > 0 ? "folder" : "file";
  const first = group[0].name;
  const what =
    group.length === 1
      ? `the ${kind} '${first}'`
      : `${group.length} ${kind}s (e.g. '${first}')`;
  return `Couldn't read ${what}. ${RETRY_HINT}`;
}

/** Builds the message shown after files or folders are dropped. */
export function summariseImport(
  result: FolderImportResult,
  target: ImportTarget
): Notification {
  const itemWords = ITEM_WORDS[target];
  const collectionWords = COLLECTION_WORDS[target];
  const createsCollections = target === "playlists" || target === "soundboards";

  const folders = createsCollections
    ? foldersWithAudio(result.directories)
    : Object.values(result.directories);
  const added = folders.reduce((total, folder) => total + folder.audioFiles.length, 0);
  const looseFiles = result.directories[ROOT_PATH]?.audioFiles.length ?? 0;

  const sentences: string[] = [];
  if (added > 0) {
    sentences.push(
      createsCollections
        ? `Added ${plural(added, itemWords)} to ${plural(folders.length, collectionWords)}.`
        : `Added ${plural(added, itemWords)} to the ${collectionWords[0]}.`
    );
  } else if (createsCollections && looseFiles > 0) {
    sentences.push(
      `No ${collectionWords[1]} were added. To make a ${collectionWords[0]}, drop a folder of audio files here. ` +
        `To add single ${itemWords[1]}, open a ${collectionWords[0]} and drop them there.`
    );
  } else if (result.unreadable.length === 0) {
    sentences.push("No audio files were found, so nothing was added.");
  }

  const skipped = skippedSentence(result.skippedFiles);
  if (skipped) {
    sentences.push(skipped);
  }
  const unreadable = unreadableSentence(result.unreadable);
  if (unreadable) {
    sentences.push(unreadable);
  }
  if (added === 0 && looseFiles === 0 && result.unreadable.length === 0) {
    sentences.push(`Cue Desk can play ${AUDIO_FORMATS_LABEL} files.`);
  }

  let severity: Notification["severity"];
  if (added === 0) {
    severity = result.unreadable.length > 0 ? "error" : "info";
  } else {
    const hasProblems =
      result.skippedFiles.length > 0 || result.unreadable.length > 0;
    severity = hasProblems ? "warning" : "success";
  }

  return { severity, message: sentences.join(" ") };
}

/** Message for an unexpected failure during a drop. */
export const IMPORT_FAILED_MESSAGE =
  "Something went wrong while adding the files. Try again, or add them with the + button instead.";
