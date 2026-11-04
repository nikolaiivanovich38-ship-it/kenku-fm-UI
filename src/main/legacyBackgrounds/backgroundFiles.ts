/**
 * Kenku FM backgrounds: copying the pictures into Cue Desk's data folder
 * (`<userData>/backgrounds/<name>.<ext>`) and listing that folder for the
 * player. Uses Node's file functions only, so it is tested with temporary
 * folders; in the app, Electron's versions of the same functions also read
 * inside `app.asar` archives.
 */
import { promises as fs } from "fs";
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

/** Largest picture copied. Kenku FM's are under 1 MB each. */
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

/** Largest player bundle read. Kenku FM 1.5.5's is a few MB. */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

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
  sourceDir: string,
  entries: readonly BackgroundEntry[],
  destDir: string,
): Promise<CopyResult> {
  await fs.mkdir(destDir, { recursive: true });
  const present = await namesInFolder(destDir);
  const result: CopyResult = { copied: [], alreadyPresent: [], skipped: [] };

  for (const { name, file } of entries) {
    if (!isSafeBackgroundName(name) || !isSafePictureFile(file)) {
      result.skipped.push({ name, reason: "not allowed" });
      continue;
    }
    if (present.has(name.toLowerCase())) {
      result.alreadyPresent.push(name);
      continue;
    }
    const source = path.join(sourceDir, file);
    const target = path.join(destDir, `${name}${path.extname(file).toLowerCase()}`);
    const temporary = path.join(destDir, `.${name}${path.extname(file)}.part`);
    try {
      const stats = await fs.stat(source).catch((): null => null);
      if (stats === null) {
        result.skipped.push({ name, reason: "not found" });
      } else if (!stats.isFile()) {
        result.skipped.push({ name, reason: "not a file" });
      } else if (stats.size === 0) {
        result.skipped.push({ name, reason: "empty file" });
      } else if (stats.size > MAX_BACKGROUND_BYTES) {
        result.skipped.push({ name, reason: "larger than 20 MB" });
      } else {
        await fs.writeFile(temporary, await fs.readFile(source));
        await fs.rename(temporary, target);
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
async function readBundle(rendererDir: string): Promise<string | null> {
  const bundle = path.join(rendererDir, PLAYER_BUNDLE);
  try {
    const stats = await fs.stat(bundle);
    if (!stats.isFile() || stats.size > MAX_BUNDLE_BYTES) return null;
    return await fs.readFile(bundle, "utf8");
  } catch {
    return null;
  }
}

/**
 * Find the newest Kenku FM install under `localAppData` whose player bundle
 * names background pictures, and copy the pictures that are not yet in
 * `destDir`. Never throws.
 */
export async function importKenkuBackgrounds(
  localAppData: string | null,
  destDir: string,
): Promise<BackgroundImportResult> {
  if (localAppData === null) {
    return { status: "not-looked" };
  }
  try {
    const candidates = await findRendererFolders(localAppData, (dir) => fs.readdir(dir));
    for (const rendererDir of candidates) {
      const bundle = await readBundle(rendererDir);
      const entries = bundle === null ? [] : parseBackgroundMap(bundle);
      if (entries.length === 0) continue;
      const copy = await copyMissingBackgrounds(rendererDir, entries, destDir);
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
    if (isSafeBackgroundName(name) && !(name in pictures)) {
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
