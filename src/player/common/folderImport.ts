/**
 * Turns files and folders dropped on the player into audio file records,
 * keeping the folder structure. Pure logic with no React, so the rebuilt
 * interface can reuse it.
 *
 * - BUG-2: folder readers return entries in batches (100 in Chromium);
 *   `readAllEntries` keeps reading until the reader returns an empty batch.
 * - BUG-1: items that are not files (text, links) have no entry and are
 *   ignored instead of throwing.
 * - BUG-10: files are accepted by MIME type or extension (see fileTypes.ts).
 * - Unreadable folders and files are reported, not thrown, so one bad
 *   folder does not stop the rest of the import.
 */
import { v4 as uuid } from "uuid";

import { cleanFileName, encodeFilePath } from "../../renderer/common/drop";
import { audioFileType, FileTypeRule, isAcceptedFile, isSystemFile } from "./fileTypes";

/** A track or sound as stored by the player. */
export interface AudioFile {
  id: string;
  url: string;
  title: string;
}

/** One dropped folder (or "/" for loose files) and the audio found in it. */
export type Directory = {
  path: string;
  name: string;
  audioFiles: AudioFile[];
};

/** Folders keyed by path; "/" always exists and holds loose files. */
export type Directories = Record<string, Directory>;

/** A folder or file that could not be read. */
export type ImportProblem = {
  kind: "folder" | "file";
  name: string;
  path: string;
};

/** Everything a drop produced, for the caller to store and summarise. */
export type FolderImportResult = {
  directories: Directories;
  /** Names of files left out because they are not audio. */
  skippedFiles: string[];
  /** Folders and files that could not be read. */
  unreadable: ImportProblem[];
};

/** Dependencies of the import, injectable for tests. */
export type FolderImportOptions = {
  /** Absolute path of a dropped file on disk ("" when it has none). */
  getPathForFile: (file: File) => string;
  createId?: () => string;
  fileType?: FileTypeRule;
};

export const ROOT_PATH = "/";

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(
  entry: FileSystemEntry
): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function joinPath(parent: string, name: string): string {
  return parent === ROOT_PATH ? `${ROOT_PATH}${name}` : `${parent}/${name}`;
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

/**
 * Reads every entry of a folder. `readEntries` must be called repeatedly
 * until it returns an empty array (BUG-2).
 */
export async function readAllEntries(
  directory: FileSystemDirectoryEntry
): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readBatch(reader);
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

/**
 * Collects the file system entries of a drop. Must be called synchronously
 * inside the drop handler, because the browser empties `items` afterwards.
 * Non-file items (text, links) have no entry and are left out.
 */
export function getDroppedEntries(
  dataTransfer: Pick<DataTransfer, "items"> | null | undefined
): FileSystemEntry[] {
  if (!dataTransfer?.items) {
    return [];
  }
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const entry = item.webkitGetAsEntry();
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Walks dropped entries and returns the audio files found, grouped by
 * folder path. Never throws for unreadable folders or files; those are
 * listed in `unreadable`.
 */
export async function importDroppedEntries(
  entries: ReadonlyArray<FileSystemEntry | null | undefined>,
  options: FolderImportOptions
): Promise<FolderImportResult> {
  const createId = options.createId ?? uuid;
  const fileType = options.fileType ?? audioFileType;
  const result: FolderImportResult = {
    directories: {
      [ROOT_PATH]: { path: ROOT_PATH, name: "root", audioFiles: [] },
    },
    skippedFiles: [],
    unreadable: [],
  };

  async function addFile(entry: FileSystemFileEntry, folderPath: string) {
    const path = joinPath(folderPath, entry.name);
    let file: File;
    try {
      file = await readFile(entry);
    } catch {
      result.unreadable.push({ kind: "file", name: entry.name, path });
      return;
    }
    if (!isAcceptedFile(file, fileType)) {
      if (!isSystemFile(file.name)) {
        result.skippedFiles.push(file.name);
      }
      return;
    }
    let diskPath: string;
    try {
      diskPath = options.getPathForFile(file);
    } catch {
      diskPath = "";
    }
    if (!diskPath) {
      result.unreadable.push({ kind: "file", name: entry.name, path });
      return;
    }
    result.directories[folderPath].audioFiles.push({
      id: createId(),
      url: encodeFilePath(diskPath),
      title: cleanFileName(file.name),
    });
  }

  async function addFolder(entry: FileSystemDirectoryEntry, parentPath: string) {
    const path = joinPath(parentPath, entry.name);
    let children: FileSystemEntry[];
    try {
      children = await readAllEntries(entry);
    } catch {
      result.unreadable.push({ kind: "folder", name: entry.name, path });
      return;
    }
    result.directories[path] = { path, name: entry.name, audioFiles: [] };
    await walk(children, path);
  }

  async function walk(
    children: ReadonlyArray<FileSystemEntry | null | undefined>,
    folderPath: string
  ) {
    for (const entry of children) {
      if (!entry) {
        continue;
      }
      if (isFileEntry(entry)) {
        await addFile(entry, folderPath);
      } else if (isDirectoryEntry(entry)) {
        await addFolder(entry, folderPath);
      }
    }
  }

  await walk(entries, ROOT_PATH);
  return result;
}

/** Total number of audio files across all folders of a result. */
export function countAudioFiles(directories: Directories): number {
  return Object.values(directories).reduce(
    (total, directory) => total + directory.audioFiles.length,
    0
  );
}
