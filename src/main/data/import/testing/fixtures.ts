/**
 * Test-only helpers for the import stream: small stand-in audio files on disk
 * and a tag reader that answers from a table instead of parsing files.
 * Never imported by app code.
 */
import fs from "fs";
import path from "path";
import type { EmbeddedTags, TagReader } from "../tagReader";

/**
 * Writes a stand-in audio file (its bytes only need to differ per file, so the
 * quick checksum tells them apart) and returns its full path.
 */
export function writeAudio(root: string, relative: string, content: string | Buffer = relative): string {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/**
 * Answers with the tags listed for a file name (the last part of the path);
 * a file name listed as "throw" fails as a damaged file would. Counts reads.
 */
export function fakeTagReader(byFileName: Record<string, EmbeddedTags | "throw"> = {}): TagReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(filePath: string) {
      reads.push(filePath);
      const tags = byFileName[path.basename(filePath)];
      if (tags === "throw") throw new Error("Unexpected end of file");
      return tags ?? {};
    },
  };
}
