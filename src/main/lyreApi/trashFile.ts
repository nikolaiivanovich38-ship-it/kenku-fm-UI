/**
 * 0.5.2 item 1: Delete file from disk… sends a track's file to the Recycle Bin (shell.trashItem), never deletes it
 * outright. The library's process names the file from its own record of the track (the page sends track ids only,
 * checked by argChecks.ts); this is the main process's own check before it acts (docs/security.md "w52-lib"): a full
 * path to one regular audio file that is there, not a folder, a link or another kind of file.
 */
import fs from "fs";
import path from "path";
import { isAudioFile } from "../data/import/audioFiles";

/** Moves `file` to the Recycle Bin with `trash` (shell.trashItem in the app), or throws in plain words. */
export async function trashAudioFile(file: unknown, trash: (file: string) => Promise<void>): Promise<void> {
  if (typeof file !== "string" || file.includes("\0") || !path.isAbsolute(file)) throw new Error("Lyre only sends a file to the Recycle Bin by its full path.");
  const name = path.basename(file);
  if (!isAudioFile(name)) throw new Error(`Lyre only sends audio files to the Recycle Bin, and ${name} is not one.`);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(file);
  } catch {
    throw new Error(`${name} is not there any more.`);
  }
  if (!stat.isFile()) throw new Error(`Lyre only sends a single audio file to the Recycle Bin, and ${name} is not one.`);
  try {
    await trash(file);
  } catch {
    throw new Error(`Lyre could not move ${name} to the Recycle Bin.`);
  }
}
