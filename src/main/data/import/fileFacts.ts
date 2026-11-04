/**
 * File facts recorded when a track is added (DAT-8 uses them to find moved
 * files): size, modification time and a quick checksum.
 *
 * The quick checksum hashes the size with the first and last 64 KiB of the
 * file, not the whole file: a 5,000-file import of FLAC albums would otherwise
 * read hundreds of gigabytes. Together with the size and the file name it tells
 * a moved copy from a different file; audio files differ in their headers and
 * their endings. The "q1:" prefix names the method, so a later, different
 * checksum is never compared with this one.
 */
import { createHash } from "crypto";
import fs from "fs";

export const QUICK_CHECKSUM_BYTES = 64 * 1024;
const PREFIX = "q1:";

export type ReadFacts = { path: string; size: number; mtimeMs: number; checksum: string };

async function readAt(handle: fs.promises.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Size, modification time and quick checksum of a file; rejects when it cannot be read. */
export async function readFileFacts(filePath: string): Promise<ReadFacts> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const stats = await handle.stat();
    const hash = createHash("sha256").update(`${stats.size}:`);
    hash.update(await readAt(handle, 0, Math.min(QUICK_CHECKSUM_BYTES, stats.size)));
    if (stats.size > QUICK_CHECKSUM_BYTES) {
      const tail = Math.min(QUICK_CHECKSUM_BYTES, stats.size - QUICK_CHECKSUM_BYTES);
      hash.update(await readAt(handle, stats.size - tail, tail));
    }
    return { path: filePath, size: stats.size, mtimeMs: Math.floor(stats.mtimeMs), checksum: PREFIX + hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

/** True when a file is there and is a file (folders and missing paths are false). */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
}
