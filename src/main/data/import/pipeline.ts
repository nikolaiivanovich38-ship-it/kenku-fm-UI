/**
 * EDT-6 (backend) and DAT-5: adding audio files to the library.
 *
 * The game master adds files, a whole folder (with its subfolders) or drops
 * them on the Library. Each audio file becomes one track, marked New, with its
 * kind guessed from its folder (kindGuess.ts), its file facts (fileFacts.ts)
 * and its embedded tags (tagReader.ts) in the file-tag title, artist, album
 * and length. A file already in the library is reused, never added twice.
 *
 * Speed: files are read a few at a time and saved in batches (500 tracks per
 * transaction by default), so 5,000 files import in a few seconds plus the
 * time the tag reader needs (budget and measurement: pipeline.perf.test.ts).
 * Between batches the main process is free for other work, and a progress
 * report goes out for the progress bar. Stopping keeps what was saved.
 *
 * An import is not an undo step (Ctrl+Z should not walk back through 5,000
 * tracks in batches), and it clears the undo history, since older steps
 * replayed over it could conflict (DB review item 10). The result lists the
 * ids added, so the screen can offer "Remove these tracks" (deleteTracks, one
 * undo step). Each batch is one short transaction (the review's limit: no
 * synchronous call over 200 ms, which would drop Discord voice packets).
 */
import path from "path";
import type { Store } from "../store";
import type { TrackInput } from "../types";
import { createTracks } from "../repo/tracks";
import { listRoots } from "../repo/roots";
import { joinRoot } from "../paths";
import { NOT_AUDIO, collectAudioFiles, fileKey, type FoundFile, type ImportProblem } from "./audioFiles";
import { cancelled, mapLimit, throwIfCancelled } from "./cancel";
import { fileExists, readFileFacts } from "./fileFacts";
import { guessKind } from "./kindGuess";
import { baseName, cleanTags, noTagReader, titleFromFileName, type CleanTags, type TagReader } from "./tagReader";

export type ImportProgress = {
  /** finding: walking folders; reading: file facts and tags; saving: a batch was saved; done: finished or stopped. */
  phase: "finding" | "reading" | "saving" | "done";
  /** Files dealt with so far, out of `total` (0 while finding). */
  done: number;
  total: number;
  /** One line for the progress bar. */
  message: string;
};

export type ImportOptions = {
  /** Reads embedded tags (DAT-5); without one, tracks are named after their files. */
  tagReader?: TagReader;
  onProgress?: (progress: ImportProgress) => void;
  /** Stops the import after the batch being read; batches already saved stay. */
  signal?: AbortSignal;
  /** Tracks saved per transaction (default 500). */
  batchSize?: number;
  /** Files read at the same time (default 8). */
  concurrency?: number;
  /**
   * UX review 3: a second opinion (ffmpeg) on a file the tag reader found no audio in: its length in milliseconds,
   * or null when it is not audio either. Without it, such a file is refused.
   */
  lengthProbe?: (filePath: string) => Promise<number | null>;
};

export type ImportResult = {
  /** Tracks created, in the order of `trackIds`. */
  added: string[];
  /** Tracks that were already in the library for files given. */
  alreadyInLibrary: string[];
  /** Every track for the files given, added or already there: folder by folder, an album in disc and track order. */
  trackIds: string[];
  /** Files that could not be added, or were added without their tags, in plain words. */
  problems: ImportProblem[];
  /** Mood and genre tags found in the files, by track id: hints for tag suggestions (DAT-4), never applied by themselves. */
  tagHints: Record<string, string[]>;
  cancelled: boolean;
  /** What happened, in plain words, for the screen. */
  summary: string;
};

/** Rows written per transaction: about 500 keeps each well under 200 ms (DB review item 1). */
export const BATCH = 500;

const TAGS_UNREADABLE = "its tags could not be read (added without them)";
const NO_TAGS: CleanTags = cleanTags({});

/** The key of a web address in `locationsInLibrary` (addresses are compared exactly). */
export const urlKey = (url: string) => `url:${url}`;

/**
 * Every track's location, by fileKey of its full path (or urlKey of its
 * address): one read of the tracks table, so looking up thousands of files
 * costs nothing more per file.
 */
export function locationsInLibrary(store: Store): Map<string, string> {
  const roots = new Map(listRoots(store).map((root) => [root.id, root.path]));
  const map = new Map<string, string>();
  for (const row of store.all<{ id: string; root_id: string | null; path: string | null; url: string | null }>(
    "SELECT id, root_id, path, url FROM tracks",
  )) {
    const key =
      row.url !== null
        ? urlKey(row.url)
        : fileKey(row.root_id === null ? (row.path as string) : joinRoot(roots.get(row.root_id) as string, row.path as string));
    if (!map.has(key)) map.set(key, row.id);
  }
  return map;
}

/** "1 track" / "3 tracks". */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** At most five names, then "and N more". */
function nameList(problems: ImportProblem[]): string {
  const shown = problems.slice(0, 5).map((p) => `${baseName(p.path)} (${p.reason})`);
  const more = problems.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, and ${more} more` : "");
}

export function describeImport(result: Pick<ImportResult, "added" | "alreadyInLibrary" | "problems" | "cancelled">): string {
  const parts: string[] = [];
  const added = result.added.length;
  if (result.cancelled) parts.push(`Stopped. Added ${count(added, "track")} before stopping.`);
  else parts.push(added > 0 ? `Added ${count(added, "track")}.` : "No new tracks were added.");
  const existing = result.alreadyInLibrary.length;
  if (existing > 0) parts.push(`${existing} ${existing === 1 ? "was" : "were"} already in your library.`);
  const withoutTags = result.problems.filter((p) => p.reason === TAGS_UNREADABLE);
  const notAdded = result.problems.filter((p) => p.reason !== TAGS_UNREADABLE);
  if (notAdded.length > 0) parts.push(`${notAdded.length} could not be added: ${nameList(notAdded)}.`);
  if (withoutTags.length > 0) {
    parts.push(`${count(withoutTags.length, "track")} ${withoutTags.length === 1 ? "was" : "were"} added without tags, which could not be read: ${withoutTags.map((p) => baseName(p.path)).slice(0, 5).join(", ")}.`);
  }
  return parts.join(" ");
}

type Processed = { file: FoundFile; id: string; tags: CleanTags };

/** Folder by folder in the order found; inside a folder where every file has a track number, disc then track order. */
function inAlbumOrder(processed: Processed[]): string[] {
  const folders = new Map<string, Processed[]>();
  for (const entry of processed) {
    const folder = fileKey(path.dirname(entry.file.path));
    const list = folders.get(folder) ?? [];
    list.push(entry);
    folders.set(folder, list);
  }
  const ids = new Set<string>();
  for (const list of folders.values()) {
    const numbered = list.every((entry) => entry.tags.trackNumber !== null);
    const ordered = numbered
      ? [...list].sort((a, b) => (a.tags.discNumber ?? 1) - (b.tags.discNumber ?? 1) || (a.tags.trackNumber as number) - (b.tags.trackNumber as number))
      : list;
    for (const entry of ordered) ids.add(entry.id);
  }
  return [...ids];
}

/** Lets the event loop run (Discord audio, IPC) between batches. */
export const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Adds the audio files in `request.paths` (files and folders, full paths) to the library. */
export async function importAudio(store: Store, request: { paths: string[] }, options: ImportOptions = {}): Promise<ImportResult> {
  const tagReader = options.tagReader ?? noTagReader;
  const batchSize = Math.max(1, options.batchSize ?? BATCH);
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const report = (progress: ImportProgress) => options.onProgress?.(progress);
  const result: ImportResult = { added: [], alreadyInLibrary: [], trackIds: [], problems: [], tagHints: {}, cancelled: false, summary: "" };
  const processed: Processed[] = [];
  const reused = new Set<string>();
  let total = 0;
  let done = 0;

  try {
    report({ phase: "finding", done: 0, total: 0, message: "Looking for audio files…" });
    const found = await collectAudioFiles(request.paths, { signal: options.signal });
    result.problems.push(...found.problems);
    total = found.files.length;
    const known = locationsInLibrary(store);

    for (let start = 0; start < found.files.length; start += batchSize) {
      throwIfCancelled(options.signal);
      const batch = found.files.slice(start, start + batchSize);
      const read = await mapLimit(batch, concurrency, async (file) => {
        throwIfCancelled(options.signal);
        const existing = known.get(fileKey(file.path));
        let entry: { file: FoundFile; existing?: string; input?: TrackInput; tags: CleanTags } | null;
        if (existing !== undefined) {
          entry = { file, existing, tags: NO_TAGS };
        } else {
          entry = await describeFile(file, tagReader, result.problems, options.lengthProbe);
        }
        done++;
        report({ phase: "reading", done, total, message: `Reading ${baseName(file.path)}` });
        return entry;
      });
      throwIfCancelled(options.signal);

      const fresh = read.filter((entry): entry is NonNullable<typeof entry> & { input: TrackInput } => entry?.input !== undefined);
      const ids = store.changeWithoutHistory(() => createTracks(store, fresh.map((entry) => entry.input)).map((track) => track.id));
      fresh.forEach((entry, index) => {
        const id = ids[index];
        known.set(fileKey(entry.file.path), id);
        result.added.push(id);
        const hints = [...entry.tags.moods, ...entry.tags.genres];
        if (hints.length > 0) result.tagHints[id] = hints;
      });
      for (const entry of read) {
        if (!entry) continue;
        if (entry.existing !== undefined && !reused.has(entry.existing)) {
          reused.add(entry.existing);
          result.alreadyInLibrary.push(entry.existing);
        }
        processed.push({ file: entry.file, id: entry.existing ?? (known.get(fileKey(entry.file.path)) as string), tags: entry.tags });
      }
      report({ phase: "saving", done: Math.min(start + batch.length, total), total, message: `Saved ${count(result.added.length, "track")}` });
      await nextTurn();
    }
  } catch (error) {
    if (!cancelled(error)) throw error;
    result.cancelled = true;
  }

  if (result.added.length > 0) store.clearHistory();
  const order = inAlbumOrder(processed);
  result.trackIds = order;
  const added = new Set(result.added);
  result.added = order.filter((id) => added.has(id));
  result.summary = describeImport(result);
  report({ phase: "done", done: result.cancelled ? done : total, total, message: result.summary });
  return result;
}

/** File facts and tags of one new file as a track to create; null (with a problem noted) when it cannot be read. */
async function describeFile(
  file: FoundFile,
  tagReader: TagReader,
  problems: ImportProblem[],
  lengthProbe?: (filePath: string) => Promise<number | null>,
): Promise<{ file: FoundFile; input: TrackInput; tags: CleanTags } | null> {
  let facts;
  try {
    facts = await readFileFacts(file.path);
  } catch {
    problems.push({ path: file.path, reason: "it could not be read (moved, deleted or in use)" });
    return null;
  }
  let tags = NO_TAGS;
  // UX review 3: a file is added only when it is audio. The tag reader says so (a format and a length); when it
  // cannot read the file or finds no length, ffmpeg is asked; when neither finds audio, it is refused.
  let audio: boolean | undefined;
  let tagsUnreadable = false;
  try {
    const read = await tagReader.read(file.path);
    tags = cleanTags(read);
    audio = read.audio;
  } catch {
    tagsUnreadable = true;
    audio = false;
  }
  if (audio === false) {
    const length = lengthProbe ? await lengthProbe(file.path).catch((): null => null) : null;
    if (!length || length <= 0) {
      problems.push({ path: file.path, reason: NOT_AUDIO });
      return null;
    }
    tags = { ...tags, durationMs: Math.round(length) };
  }
  if (tagsUnreadable) problems.push({ path: file.path, reason: TAGS_UNREADABLE });
  const kind = guessKind(file.path, file.chosenFolder);
  const input: TrackInput = {
    kind,
    ...(kind === "fx" ? { role: "effect" as const } : {}),
    metaTitle: tags.title ?? titleFromFileName(baseName(file.path)),
    sourceComposer: tags.artist,
    sourceAlbum: tags.album,
    durationMs: tags.durationMs,
    isNew: true,
    file: facts,
  };
  return { file, input, tags };
}

/**
 * DAT-5 for tracks already in the library (for example those moved in from
 * the old player): fills the file-tag title and length from each file's tags,
 * and artist and album only where they are empty (the game master may have
 * typed them). Never the game master's title. Bookkeeping, not an undo step.
 */
export async function refreshEmbeddedTags(
  store: Store,
  trackIds: string[],
  tagReader: TagReader,
  options: { concurrency?: number } = {},
): Promise<{ updated: number; unreadable: string[]; missing: string[] }> {
  const roots = new Map(listRoots(store).map((root) => [root.id, root.path]));
  const rows = trackIds
    .map((id) => store.get<{ id: string; root_id: string | null; path: string | null }>("SELECT id, root_id, path FROM tracks WHERE id = ?", id))
    .filter((row): row is { id: string; root_id: string | null; path: string } => row !== undefined && row.path !== null);
  const outcome = { updated: 0, unreadable: [] as string[], missing: [] as string[] };
  const read = await mapLimit(rows, options.concurrency ?? 8, async (row) => {
    const full = row.root_id === null ? row.path : joinRoot(roots.get(row.root_id) as string, row.path);
    if (!(await fileExists(full))) {
      outcome.missing.push(row.id);
      return null;
    }
    try {
      return { id: row.id, tags: cleanTags(await tagReader.read(full)) };
    } catch {
      outcome.unreadable.push(full);
      return null;
    }
  });
  const found = read.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  for (let start = 0; start < found.length; start += BATCH) {
    store.changeWithoutHistory(() => {
      for (const { id, tags } of found.slice(start, start + BATCH)) {
        store.run(
          `UPDATE tracks SET meta_title = coalesce(?, meta_title), duration_ms = coalesce(?, duration_ms),
             source_composer = coalesce(source_composer, ?), source_album = coalesce(source_album, ?) WHERE id = ?`,
          tags.title,
          tags.durationMs,
          tags.artist,
          tags.album,
          id,
        );
        outcome.updated++;
      }
    });
    await nextTurn();
  }
  if (outcome.updated > 0) store.clearHistory();
  return outcome;
}
