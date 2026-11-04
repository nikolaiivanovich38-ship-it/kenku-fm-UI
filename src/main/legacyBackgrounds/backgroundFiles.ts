/**
 * Kenku FM backgrounds: copying the pictures into Cue Desk's data folder
 * (`<userData>/backgrounds/<name>.<ext>`) and listing that folder for the
 * player. Uses Node's file functions only, so it is tested with temporary
 * folders; in the app, Electron's versions of the same functions also read
 * inside `app.asar` archives.
 */
import { constants as fsConstants, promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
  type BackgroundEntry,
  PLAYER_BUNDLE,
  findRendererFolders,
  hasPictureExtension,
  isSafeBackgroundName,
  isSafePictureFile,
  parseBackgroundMap,
} from "./kenkuInstall";
import { AsarArchive, type RawFs } from "./asarArchive";

/** Largest picture copied. Kenku FM's are under 1 MB each. */
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

/**
 * Most copied in one start, all pictures together. Kenku FM's 23 come to a
 * few MB; the limit stops a fake install from filling the disk (0.1.1 review).
 */
export const MAX_TOTAL_BACKGROUND_BYTES = 200 * 1024 * 1024;

/** Largest player bundle read. Kenku FM 1.5.5's is a few MB. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

export type SkippedBackground = { name: string; reason: string };

export type CopyResult = {
  copied: string[];
  alreadyPresent: string[];
  skipped: SkippedBackground[];
};

export type BackgroundImportResult =
  /** Not on Windows, or no LocalAppData folder: nothing was looked at. */
  | { status: "not-looked" }
  | { status: "no-install" }
  | ({ status: "done"; source: string; found: number } & CopyResult)
  | { status: "failed"; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function baseName(file: string): string {
  return file.replace(/\.[^.]*$/, "");
}

/** Names (lower case) of pictures already in the folder, whatever their extension. */
async function namesInFolder(dir: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const entry of await fs.readdir(dir)) {
    names.add(baseName(entry).toLowerCase());
  }
  return names;
}

/**
 * Copy each picture from Kenku FM's renderer folder into `destDir` as
 * `<name>.<ext>`, unless a picture with that name is already there (from an
 * earlier start, or the user's own): nothing is overwritten or deleted. Each
 * file is written under a hidden temporary name first and renamed when
 * complete, so an interrupted copy never leaves a broken picture that later
 * starts would keep.
 */
export async function copyMissingBackgrounds(
  sourceDir: string | PictureSource,
  entries: readonly BackgroundEntry[],
  destDir: string,
): Promise<CopyResult> {
  const pictures = typeof sourceDir === "string" ? folderSource(sourceDir) : sourceDir;
  await fs.mkdir(destDir, { recursive: true });
  const present = await namesInFolder(destDir);
  const result: CopyResult = { copied: [], alreadyPresent: [], skipped: [] };
  let totalBytes = 0;

  for (const { name, file } of entries) {
    if (!isSafeBackgroundName(name) || !isSafePictureFile(file)) {
      result.skipped.push({ name, reason: "not allowed" });
      continue;
    }
    if (present.has(name.toLowerCase())) {
      result.alreadyPresent.push(name);
      continue;
    }
    const target = path.join(destDir, `${name}${path.extname(file).toLowerCase()}`);
    const temporary = path.join(destDir, `.${name}${path.extname(file)}.part`);
    try {
      const picture = await pictures.readPicture(file);
      if ("skip" in picture) {
        result.skipped.push({ name, reason: picture.skip });
      } else if (totalBytes + picture.content.length > MAX_TOTAL_BACKGROUND_BYTES) {
        result.skipped.push({ name, reason: "over the total size limit for one start" });
      } else {
        totalBytes += picture.content.length;
        // "wx" refuses an existing file or link at the temporary name, and
        // COPYFILE_EXCL refuses a picture that appeared since the folder was
        // listed: nothing is ever overwritten.
        await fs.writeFile(temporary, picture.content, { flag: "wx" });
        await fs.copyFile(temporary, target, fsConstants.COPYFILE_EXCL);
        await fs.rm(temporary, { force: true });
        present.add(name.toLowerCase());
        result.copied.push(name);
      }
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch((): void => undefined);
      result.skipped.push({ name, reason: errorText(error) });
    }
  }
  return result;
}

/** The player bundle's text, or null when it is missing or too large. */
/** Where the pictures and the player bundle are read from. */
export interface PictureSource {
  readBundle(): Promise<string | null>;
  readPicture(file: string): Promise<{ content: Buffer } | { skip: string }>;
}

function checkSize(size: number): string | null {
  if (size === 0) return "empty file";
  if (size > MAX_BACKGROUND_BYTES) return "larger than 20 MB";
  return null;
}

/** An unpacked install: `resources/app/.webpack/renderer`. */
export function folderSource(rendererDir: string): PictureSource {
  return {
    async readBundle() {
      try {
        const bundle = path.join(rendererDir, PLAYER_BUNDLE);
        const stats = await fs.lstat(bundle);
        if (!stats.isFile() || stats.size > MAX_BUNDLE_BYTES) return null;
        return (await readAtMost(bundle, MAX_BUNDLE_BYTES)).toString("utf8");
      } catch {
        return null;
      }
    },
    async readPicture(file) {
      const source = path.join(rendererDir, file);
      // lstat: a picture that is a link to some other file is not copied.
      const stats = await fs.lstat(source).catch((): null => null);
      if (stats === null) return { skip: "not found" };
      if (!stats.isFile()) return { skip: "not a file" };
      const tooBig = checkSize(stats.size);
      if (tooBig) return { skip: tooBig };
      return { content: await readAtMost(source, MAX_BACKGROUND_BYTES) };
    },
  };
}

/**
 * An install packed in `resources/app.asar`, read with plain file reads so
 * the archive is never kept open (see asarArchive.ts).
 */
export async function asarSource(rawFs: RawFs, archive: string, innerDir: string): Promise<PictureSource> {
  const asar = await AsarArchive.open(rawFs, archive);
  const inner = (file: string) => path.posix.join(innerDir.split(path.sep).join("/"), file.split(path.sep).join("/"));
  const folder = folderSource(path.join(`${archive}.unpacked`, innerDir));
  return {
    async readBundle() {
      const found = asar.locate(inner(PLAYER_BUNDLE));
      if (found.kind === "unpacked") return folder.readBundle();
      if (found.kind !== "packed" || found.size > MAX_BUNDLE_BYTES) return null;
      return (await asar.read(found, MAX_BUNDLE_BYTES)).toString("utf8");
    },
    async readPicture(file) {
      const found = asar.locate(inner(file));
      if (found.kind === "unpacked") return folder.readPicture(file);
      if (found.kind === "missing") return { skip: "not found" };
      const tooBig = checkSize(found.size);
      if (tooBig) return { skip: tooBig };
      return { content: await asar.read(found, MAX_BACKGROUND_BYTES) };
    },
  };
}

/** The plain file functions for reading archives: Electron's original-fs in the app, Node's fs elsewhere. */
function defaultRawFs(): RawFs {
  if (process.versions.electron) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("original-fs") as RawFs;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("fs") as RawFs;
}

/** The source for a renderer folder found by `findRendererFolders`. */
async function sourceFor(rendererDir: string, rawFs: RawFs): Promise<PictureSource> {
  const parts = rendererDir.split(path.sep);
  const at = parts.lastIndexOf("app.asar");
  if (at === -1) return folderSource(rendererDir);
  return asarSource(rawFs, parts.slice(0, at + 1).join(path.sep), parts.slice(at + 1).join(path.sep));
}

/**
 * Find the newest Kenku FM install under `localAppData` whose player bundle
 * names background pictures, and copy the pictures that are not yet in
 * `destDir`. Never throws.
 */
export async function importKenkuBackgrounds(
  localAppData: string | null,
  destDir: string,
  { rawFs = defaultRawFs() }: { rawFs?: RawFs } = {},
): Promise<BackgroundImportResult> {
  if (localAppData === null) {
    return { status: "not-looked" };
  }
  try {
    const candidates = await findRendererFolders(localAppData, (dir) => fs.readdir(dir));
    for (const rendererDir of candidates) {
      const source = await sourceFor(rendererDir, rawFs).catch((): null => null);
      const bundle = source === null ? null : await source.readBundle();
      const entries = bundle === null ? [] : parseBackgroundMap(bundle);
      if (source === null || entries.length === 0) continue;
      const copy = await copyMissingBackgrounds(source, entries, destDir);
      return { status: "done", source: rendererDir, found: entries.length, ...copy };
    }
    return { status: "no-install" };
  } catch (error) {
    return { status: "failed", error: errorText(error) };
  }
}

/** One plain line for the log. */
export function describeBackgroundImport(result: BackgroundImportResult): string {
  switch (result.status) {
    case "not-looked":
      return "Not looked for Kenku FM's background pictures (only on Windows).";
    case "no-install":
      return "No Kenku FM install found; no background pictures copied.";
    case "failed":
      return `Could not copy Kenku FM's background pictures: ${result.error}`;
    case "done": {
      const { found, source, copied, alreadyPresent, skipped } = result;
      if (copied.length === 0 && skipped.length === 0) {
        return `All ${found} background pictures from ${source} were already copied.`;
      }
      const parts = [`Copied ${copied.length} of ${found} background pictures from ${source}`];
      if (alreadyPresent.length > 0) parts.push(`${alreadyPresent.length} already there`);
      if (skipped.length > 0) {
        parts.push(`skipped ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`);
      }
      return `${parts.join("; ")}.`;
    }
  }
}

/** Read a file, but never more than `limit` bytes, even if it grows meanwhile. */
async function readAtMost(file: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The pictures in Cue Desk's backgrounds folder: name (file name without
 * extension) to full path, sorted by name. Hidden files (unfinished copies),
 * folders and other file types are left out; of two pictures with the same
 * name, the first in sort order wins.
 */
export async function listBackgroundFiles(dir: string): Promise<Record<string, string>> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return {};
  }
  const files = entries
    .filter((entry) => entry.isFile() && hasPictureExtension(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
  const pictures: Record<string, string> = {};
  for (const file of files) {
    const name = baseName(file);
    if (isSafeBackgroundName(name) && !Object.prototype.hasOwnProperty.call(pictures, name)) {
      pictures[name] = path.join(dir, file);
    }
  }
  return pictures;
}

/**
 * What the player gets: each picture as a file:// address. The player page's
 * Content-Security-Policy already allows `img-src file:` (custom backgrounds
 * picked from disk use the same kind of address), and `pathToFileURL`
 * percent-encodes spaces, quotes and other characters, so the address is
 * safe inside CSS `url("…")`.
 */
export async function backgroundUrls(dir: string): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (const [name, file] of Object.entries(await listBackgroundFiles(dir))) {
    urls[name] = pathToFileURL(file).href;
  }
  return urls;
}

/** Wait for `promise` to settle, but no longer than `ms`. Never rejects. */
export function waitAtMost(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
