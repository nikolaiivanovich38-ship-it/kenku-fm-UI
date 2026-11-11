/**
 * DAT-9: moving the old player's library into the database, once.
 *
 * The old player keeps its playlists and soundboards with redux-persist in
 * the app's localStorage under the key "persist:player" (the old player's redux store, gone in 0.5.1: legacyShapes.ts;
 * "persist:root" holds only settings and bookmarks). Wave 3 reads that value
 * (for example `localStorage.getItem("persist:player")` in the player window)
 * and hands it to `importLegacyLibrary` on the new interface's first start.
 *
 * What moves (docs/data-model.md, "Bringing in the current player's data"):
 * - every file or web address becomes one track, whatever number of playlists
 *   and soundboards held it, with the game master's title (the first one met;
 *   other titles go into its notes); a file that cannot be found still moves,
 *   so its playlists stay whole, and is reported for relinking (DAT-8);
 * - each playlist becomes a manual playlist with the same id, title,
 *   background and order, in the lane most of its tracks belong to;
 * - each soundboard becomes a pad board (4 columns, as the version-2 upgrade
 *   lays out soundboards) whose pads keep the id, title, loop (a toggle pad),
 *   volume and fades of each sound; what does not fit the 8-row grid waits
 *   among the board's spare pads.
 *
 * Safety: the old data is only read. A backup of the library is taken before
 * anything is written. The job records itself in `library_jobs`, saves in short
 * batches (tracks 500 at a time, each playlist and board on its own) and lets
 * the event loop run between them; after a crash it carries on where it
 * stopped, ending with the same library as an uninterrupted move. When done it
 * clears the undo history (DB review item 10) and never runs again.
 */
import { randomUUID } from "crypto";
import path from "path";
import type { Library } from "../library";
import type { Store } from "../store";
import type { PlaylistsState, SoundboardsState } from "./legacyShapes";
import type { TrackInput, TrackKind } from "../types";
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from "../validate";
import { createTracks } from "../repo/tracks";
import { addTracksToPlaylist, createPlaylist } from "../repo/playlists";
import { addPad, createBoard } from "../repo/boards";
import { fileKey } from "./audioFiles";
import { mapLimit } from "./cancel";
import { fileExists, readFileFacts } from "./fileFacts";
import { kindOfFolderName } from "./kindGuess";
import { BATCH, locationsInLibrary, nextTurn, urlKey, type ImportProgress } from "./pipeline";
import { baseName, cleanTags, type TagReader } from "./tagReader";

/** The job's name in library_jobs. */
export const LEGACY_JOB = "legacy-player";

export type LegacyPlayerState = { playlists: PlaylistsState | null; soundboards: SoundboardsState | null };

export type LegacyImportReport = {
  /** moved: done now; already-done: an earlier start did it (this is that report); nothing-to-move; unreadable: tried again next time. */
  status: "moved" | "already-done" | "nothing-to-move" | "unreadable";
  /** What happened, one plain sentence per line, for the screen. */
  lines: string[];
  summary: string;
  /** The backup taken before the move. */
  backupPath: string | null;
  /** Tracks whose files could not be found, for "Find missing files" (DAT-8). */
  missingTrackIds: string[];
  counts: { playlists: number; playlistEntries: number; boards: number; pads: number; tracks: number };
};

export type LegacyImportOptions = {
  /** Reads embedded tags of the files found (DAT-5); without it the file-tag fields stay empty. */
  tagReader?: TagReader;
  onProgress?: (progress: ImportProgress) => void;
  /** Called after each saved step (a batch of tracks, a playlist, a board). Tests throw here to simulate a crash. */
  onStepSaved?: (step: string) => void;
};

const UNREADABLE = "The old player's library could not be read, so nothing was moved. Lyre will try again next time it starts.";

// --- Reading the old data ---

function parsePart(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(UNREADABLE);
  }
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * The playlists and soundboards from the stored value of "persist:player":
 * the raw string (each slice is itself a JSON string), or that value already
 * parsed, or the slices themselves. Null or empty: nothing stored.
 */
export function parseLegacyPlayerState(raw: unknown): LegacyPlayerState {
  if (raw === null || raw === undefined || raw === "") return { playlists: null, soundboards: null };
  const root = asObject(parsePart(raw));
  if (!root) throw new Error(UNREADABLE);
  return {
    playlists: asObject(parsePart(root.playlists)) as unknown as PlaylistsState | null,
    soundboards: asObject(parsePart(root.soundboards)) as unknown as SoundboardsState | null,
  };
}

/** Decodes %xx sequences that are valid and keeps the rest as written ("100%.mp3"). */
function decodeLoosely(text: string): string {
  return text.replace(/(%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * Where an old track's audio is: a file path or a web address, or null when
 * Lyre cannot play it (blob: and data: addresses lasted only while the old
 * player ran; a relative path has no folder). The old player wrote files as
 * file://C:/… (legacyShapes.ts encodeFilePath), Kenku FM as file:///C:/…; both are read.
 */
export function legacyLocation(raw: unknown): { file: string } | { url: string } | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      new URL(text);
      return { url: text };
    } catch {
      return null;
    }
  }
  if (/^file:/i.test(text)) {
    const rest = text.slice("file:".length);
    const slashes = (/^\/*/.exec(rest) as RegExpExecArray)[0].length;
    const body = rest.slice(slashes);
    if (body === "") return null;
    const decoded = decodeLoosely(body);
    if (/^[a-zA-Z]:/.test(body)) return { file: decoded.replace(/\//g, "\\") };
    // file://server/share and file:////server/share are Windows network shares.
    if (slashes === 2 || slashes >= 4) return { file: `\\\\${decoded.replace(/\//g, "\\")}` };
    return { file: `/${decoded}` };
  }
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\") || text.startsWith("/")) return { file: text };
  return null;
}

// --- Planning the move (pure; the same plan on every run, so a resumed move ends the same) ---

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** A title as one plain line; null when nothing is left. */
function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Shortened to the library's limit at a word break, with "…". */
function shorten(text: string, max = MAX_NAME_LENGTH): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const atSpace = cut.lastIndexOf(" ");
  return `${(atSpace > max / 2 ? cut.slice(0, atSpace) : cut).trimEnd()}…`;
}

// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

/** An old id kept as it is when the library can hold it. */
const usableId = (id: unknown): id is string =>
  typeof id === "string" && id.trim() === id && id !== "" && id.length <= 200 && !HAS_CONTROL.test(id);

/** The kind the folders (or address path) of a location suggest, nearest first; null when they say nothing. */
function kindFromLocation(location: { file: string } | { url: string }): TrackKind | null {
  const parts = "url" in location ? new URL(location.url).pathname.split("/").map(decodeLoosely) : location.file.split(/[\\/]/);
  for (const folder of parts.slice(0, -1).reverse()) {
    const kind = kindOfFolderName(folder);
    if (kind) return kind;
  }
  return null;
}

type Unit = {
  key: string;
  location: { file: string } | { url: string };
  id: string;
  title: string;
  fullTitle: string | null;
  otherTitles: string[];
  kind: TrackKind;
  sources: number;
};

/** `keptId`: the old id is the container's id in the library too, so a later start can find it (FND-16 catch-up). */
type PlannedPlaylist = { id: string; keptId: boolean; title: string; background: string; lane: TrackKind; trackKeys: string[] };
type PlannedPad = { id: string; label: string; mode: "toggle" | "oneshot"; volume: number; fadeInMs: number; fadeMs: number; trackKey: string };
type PlannedBoard = { id: string; keptId: boolean; title: string; background: string; pads: PlannedPad[] };

type Plan = {
  units: Map<string, Unit>;
  playlists: PlannedPlaylist[];
  boards: PlannedBoard[];
  notMoved: { title: string; reason: string }[];
  dangling: { count: number; inPlaylists: string[]; inBoards: string[] };
};

/** Ids in the order the old player listed them, then any it held but did not list. */
function orderedIds(list: { byId?: Record<string, unknown>; allIds?: unknown } | undefined): string[] {
  const byId = list?.byId ?? {};
  const listed = Array.isArray(list?.allIds) ? list.allIds.filter((id): id is string => typeof id === "string" && id in byId) : [];
  return [...new Set([...listed, ...Object.keys(byId)])];
}

const background = (value: unknown) => (typeof value === "string" && value.length <= 4000 ? value : "");
const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

function plan(state: LegacyPlayerState): Plan {
  const units = new Map<string, Unit>();
  const usedIds = new Set<string>();
  const notMoved: Plan["notMoved"] = [];
  const dangling: Plan["dangling"] = { count: 0, inPlaylists: [], inBoards: [] };
  const seenSources = new Map<string, string | null>();

  /** The unit for one old track or sound (null when it cannot be moved). */
  const unitFor = (source: { id: string; url: unknown; title: unknown }, fallbackKind: TrackKind, isSound: boolean): string | null => {
    const sourceKey = `${isSound ? "s" : "t"}:${source.id}`;
    if (seenSources.has(sourceKey)) return seenSources.get(sourceKey) as string | null;
    const title = cleanTitle(source.title);
    const location = legacyLocation(source.url);
    if (!location) {
      notMoved.push({ title: title ?? source.id, reason: "not a file or web address Lyre can play" });
      seenSources.set(sourceKey, null);
      return null;
    }
    const key = "url" in location ? urlKey(location.url) : fileKey(location.file);
    seenSources.set(sourceKey, key);
    const existing = units.get(key);
    if (existing) {
      existing.sources++;
      if (!isSound && title && title !== existing.fullTitle && title !== existing.title && !existing.otherTitles.includes(title)) {
        existing.otherTitles.push(title);
      }
      return key;
    }
    const id = usableId(source.id) && !usedIds.has(source.id) ? source.id : randomUUID();
    usedIds.add(id);
    const shown = title ? shorten(title) : "";
    units.set(key, {
      key,
      location,
      id,
      title: shown,
      fullTitle: title && shown !== title ? title : null,
      otherTitles: [],
      kind: kindFromLocation(location) ?? fallbackKind,
      sources: 1,
    });
    return key;
  };

  const playlists: PlannedPlaylist[] = [];
  const oldTracks = state.playlists?.tracks ?? {};
  for (const id of orderedIds(state.playlists?.playlists)) {
    const old = state.playlists?.playlists.byId[id];
    if (!old) continue;
    const title = shorten(cleanTitle(old.title) ?? "Untitled playlist");
    const trackKeys: string[] = [];
    for (const trackId of Array.isArray(old.tracks) ? old.tracks : []) {
      const track = oldTracks[trackId];
      if (!track) {
        dangling.count++;
        if (!dangling.inPlaylists.includes(title)) dangling.inPlaylists.push(title);
        continue;
      }
      const key = unitFor({ id: trackId, url: track.url, title: track.title }, "music", false);
      if (key) trackKeys.push(key);
    }
    playlists.push({ id: usableId(id) ? id : randomUUID(), keptId: usableId(id), title, background: background(old.background), lane: "music", trackKeys });
  }

  const boards: PlannedBoard[] = [];
  const oldSounds = state.soundboards?.sounds ?? {};
  for (const id of orderedIds(state.soundboards?.soundboards)) {
    const old = state.soundboards?.soundboards.byId[id];
    if (!old) continue;
    const title = shorten(cleanTitle(old.title) ?? "Untitled board");
    const pads: PlannedPad[] = [];
    for (const soundId of Array.isArray(old.sounds) ? old.sounds : []) {
      const sound = oldSounds[soundId];
      if (!sound) {
        dangling.count++;
        if (!dangling.inBoards.includes(title)) dangling.inBoards.push(title);
        continue;
      }
      const key = unitFor({ id: soundId, url: sound.url, title: sound.title }, sound.loop ? "amb" : "fx", true);
      if (!key) continue;
      pads.push({
        id: soundId,
        label: shorten(cleanTitle(sound.title) ?? ""),
        mode: sound.loop ? "toggle" : "oneshot",
        volume: Math.min(1, Math.max(0, number(sound.volume, 1))),
        fadeInMs: Math.max(0, Math.round(number(sound.fadeIn, 0))),
        fadeMs: Math.max(0, Math.round(number(sound.fadeOut, 0))),
        trackKey: key,
      });
    }
    boards.push({ id: usableId(id) ? id : randomUUID(), keptId: usableId(id), title, background: background(old.background), pads });
  }

  // A playlist plays into the lane most of its tracks belong to; music when tied or empty.
  for (const playlist of playlists) {
    const tally = { music: 0, amb: 0, fx: 0 };
    for (const key of playlist.trackKeys) tally[(units.get(key) as Unit).kind]++;
    playlist.lane = tally.amb > tally.music && tally.amb >= tally.fx ? "amb" : tally.fx > tally.music && tally.fx > tally.amb ? "fx" : "music";
  }
  return { units, playlists, boards, notMoved, dangling };
}

// --- Writing ---

const exists = (store: Store, table: "playlists" | "boards" | "pads", id: string) => store.get(`SELECT 1 AS found FROM ${table} WHERE id = ?`, id) !== undefined;

/** A planned playlist as a manual playlist with its tracks (the tracks are in `trackIdOf`). One transaction. */
function savePlaylist(store: Store, playlist: PlannedPlaylist, trackIdOf: Map<string, string>): void {
  createPlaylist(store, { id: playlist.id, title: playlist.title, background: playlist.background, lane: playlist.lane });
  const trackIds = playlist.trackKeys.map((key) => trackIdOf.get(key) as string);
  if (trackIds.length > 0) addTracksToPlaylist(store, playlist.id, trackIds);
}

/** A planned soundboard as a pad board, 4 columns, what does not fit the 8 rows among its spare pads. One transaction. */
function saveBoard(store: Store, board: PlannedBoard, trackIdOf: Map<string, string>): void {
  const onGrid = Math.min(board.pads.length, GRID_COLUMNS * GRID_ROWS);
  createBoard(store, {
    id: board.id,
    title: board.title,
    background: board.background,
    cols: GRID_COLUMNS,
    rows: Math.min(GRID_ROWS, Math.max(1, Math.ceil(board.pads.length / GRID_COLUMNS))),
  });
  board.pads.forEach((pad, index) => savePad(store, board.id, pad, trackIdOf, index < onGrid ? { row: Math.floor(index / GRID_COLUMNS), col: index % GRID_COLUMNS } : "spare"));
}

/** One old sound as a pad; it keeps its old id when that is free. */
function savePad(store: Store, boardId: string, pad: PlannedPad, trackIdOf: Map<string, string>, at: { row: number; col: number } | "spare"): void {
  const padTaken = exists(store, "pads", pad.id) || !usableId(pad.id);
  addPad(store, boardId, {
    ...(padTaken ? {} : { id: pad.id }),
    label: pad.label,
    mode: pad.mode,
    volume: pad.volume,
    fadeInMs: pad.fadeInMs,
    fadeMs: pad.fadeMs,
    sound: { kind: "single", trackIds: [trackIdOf.get(pad.trackKey) as string] },
    at,
  });
}

type JobRow = { state: "running" | "done"; detail: string };

function readJob(store: Store): JobRow | undefined {
  return store.get<JobRow>("SELECT state, detail FROM library_jobs WHERE name = ?", LEGACY_JOB);
}

const GRID_COLUMNS = 4;
const GRID_ROWS = 8;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list: string[]) => (list.length <= 5 ? list.join(", ") : `${list.slice(0, 5).join(", ")} and ${list.length - 5} more`);

/**
 * Creates a track for each unit not yet in `trackIdOf` (reading the file's facts and tags; a file that is not there
 * still becomes a track, reported missing) and notes its id there. Saved in batches, letting the event loop run.
 * Answers the units whose files could not be found, already in the library or not.
 */
async function createUnitTracks(
  store: Store,
  units: Unit[],
  trackIdOf: Map<string, string>,
  takenIds: Set<string>,
  options: LegacyImportOptions,
): Promise<{ missing: Unit[] }> {
  const report = (progress: ImportProgress) => options.onProgress?.(progress);
  const missing: Unit[] = [];
  let done = 0;
  const total = units.length;
  const inputs = await mapLimit(units, 8, async (unit) => {
    let input: TrackInput | null = null;
    const notInLibrary = !trackIdOf.has(unit.key);
    if ("file" in unit.location && !(await fileExists(unit.location.file))) {
      missing.push(unit);
      if (notInLibrary) input = { file: { path: unit.location.file } };
    } else if ("file" in unit.location && notInLibrary) {
      const facts = await readFileFacts(unit.location.file).catch((): null => null);
      const tags = options.tagReader ? await options.tagReader.read(unit.location.file).then(cleanTags, (): null => null) : null;
      input = {
        file: facts ?? { path: unit.location.file },
        ...(tags ? { metaTitle: tags.title ?? "", sourceComposer: tags.artist, sourceAlbum: tags.album, durationMs: tags.durationMs } : {}),
      };
    } else if ("url" in unit.location && notInLibrary) {
      input = { url: unit.location.url };
    }
    report({ phase: "reading", done: ++done, total, message: `Reading ${unit.title || baseName("file" in unit.location ? unit.location.file : unit.location.url)}` });
    if (!input) return null;
    const notes = [
      unit.fullTitle ? `Full title in the old player: ${unit.fullTitle}` : "",
      unit.otherTitles.length > 0 ? `Also called in the old player: ${unit.otherTitles.join("; ")}` : "",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_LENGTH);
    const id = takenIds.has(unit.id) ? randomUUID() : unit.id;
    return { unit, input: { ...input, id, title: unit.title, notes, kind: unit.kind, ...(unit.kind === "fx" ? { role: "effect" as const } : {}) } };
  });
  const fresh = inputs.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  for (let start = 0; start < fresh.length; start += BATCH) {
    const batch = fresh.slice(start, start + BATCH);
    const ids = store.changeWithoutHistory(() => createTracks(store, batch.map((entry) => entry.input)).map((track) => track.id));
    batch.forEach((entry, index) => trackIdOf.set(entry.unit.key, ids[index]));
    report({ phase: "saving", done: Math.min(start + BATCH, fresh.length), total: fresh.length, message: "Saving tracks" });
    options.onStepSaved?.("tracks");
    await nextTurn();
  }
  return { missing };
}

export async function importLegacyLibrary(library: Library, raw: unknown, options: LegacyImportOptions = {}): Promise<LegacyImportReport> {
  const store = library.store;
  const report = (progress: ImportProgress) => options.onProgress?.(progress);
  const step = (name: string) => options.onStepSaved?.(name);
  const job = readJob(store);
  if (job?.state === "done") return { ...(JSON.parse(job.detail).report as LegacyImportReport), status: "already-done" };

  let state: LegacyPlayerState;
  try {
    state = parseLegacyPlayerState(raw);
  } catch {
    return finish({ status: "unreadable", lines: [UNREADABLE], backupPath: null, missingTrackIds: [], counts: emptyCounts() });
  }
  const moving = plan(state);
  if (moving.playlists.length === 0 && moving.boards.length === 0) {
    return finish({ status: "nothing-to-move", lines: ["The old player had no playlists or soundboards to move."], backupPath: null, missingTrackIds: [], counts: emptyCounts() });
  }

  // 1. A backup first, then the job's record (a resumed move keeps the first backup).
  let backupPath: string | null = job ? (JSON.parse(job.detail).backupPath ?? null) : null;
  if (!job) {
    backupPath = (await library.backupBeforeImport()).path;
    store.changeWithoutHistory(() =>
      store.run(
        "INSERT INTO library_jobs (name, state, detail, started_at) VALUES (?, 'running', ?, ?)",
        LEGACY_JOB,
        JSON.stringify({ backupPath }),
        store.now(),
      ),
    );
  }

  // 2. Tracks: those already in the library (from an earlier, interrupted run, or added in Lyre) are reused.
  const units = [...moving.units.values()];
  const known = locationsInLibrary(store);
  const takenIds = new Set(store.all<{ id: string }>("SELECT id FROM tracks").map((row) => row.id));
  const trackIdOf = new Map<string, string>();
  for (const unit of units) {
    const existing = known.get(unit.key);
    if (existing) trackIdOf.set(unit.key, existing);
  }
  const { missing } = await createUnitTracks(store, units, trackIdOf, takenIds, options);
  const total = units.length;

  // 3. Playlists and boards, each in one transaction; one already there was saved by an earlier run.
  for (const playlist of moving.playlists) {
    if (!exists(store, "playlists", playlist.id)) {
      store.changeWithoutHistory(() => savePlaylist(store, playlist, trackIdOf));
      step(`playlist ${playlist.id}`);
      await nextTurn();
    }
  }
  const spareByBoard: { title: string; count: number }[] = [];
  for (const board of moving.boards) {
    const onGrid = Math.min(board.pads.length, GRID_COLUMNS * GRID_ROWS);
    if (board.pads.length > onGrid) spareByBoard.push({ title: board.title, count: board.pads.length - onGrid });
    if (exists(store, "boards", board.id)) continue;
    store.changeWithoutHistory(() => saveBoard(store, board, trackIdOf));
    step(`board ${board.id}`);
    await nextTurn();
  }

  // 4. The report, from the plan, so a resumed move reports the same as an uninterrupted one.
  const counts = {
    playlists: moving.playlists.length,
    playlistEntries: moving.playlists.reduce((sum, p) => sum + p.trackKeys.length, 0),
    boards: moving.boards.length,
    pads: moving.boards.reduce((sum, b) => sum + b.pads.length, 0),
    tracks: units.length,
  };
  const lines: string[] = [];
  const movedParts = [
    counts.playlists > 0 ? `${count(counts.playlists, "playlist")} (${count(counts.playlistEntries, "track")})` : "",
    counts.boards > 0 ? `${count(counts.boards, "soundboard")} (${count(counts.pads, "sound")})` : "",
  ].filter(Boolean);
  lines.push(`Moved ${movedParts.join(" and ")} from the old player into your library. The old player's library was not changed.`);
  const shared = units.filter((unit) => unit.sources > 1).length;
  if (shared > 0) {
    lines.push(`${count(shared, "file")} ${shared === 1 ? "was" : "were"} in more than one playlist or soundboard; each is in your library once, and everywhere it was before.`);
  }
  const missingInOrder = units.filter((unit) => missing.includes(unit));
  if (missingInOrder.length > 0) {
    const one = missingInOrder.length === 1;
    lines.push(
      `${count(missingInOrder.length, "file")} could not be found: ${names(missingInOrder.map((unit) => baseName((unit.location as { file: string }).file)))}. ` +
        `${one ? "It is in your library and its playlists" : "They are in your library and their playlists"}; use Find missing files to show Lyre where ${one ? "it is" : "they are"} now.`,
    );
  }
  if (moving.notMoved.length > 0) {
    lines.push(`${moving.notMoved.length} could not be moved: ${names(moving.notMoved.map((item) => `${item.title} (${item.reason})`))}.`);
  }
  if (moving.dangling.count > 0) {
    const n = moving.dangling.count;
    const what = moving.dangling.inBoards.length === 0 ? count(n, "playlist entry", "playlist entries") : moving.dangling.inPlaylists.length === 0 ? count(n, "soundboard sound") : count(n, "entry", "entries");
    lines.push(`${what} pointed to a track that no longer exists and ${n === 1 ? "was" : "were"} left out (in ${names([...moving.dangling.inPlaylists, ...moving.dangling.inBoards])}).`);
  }
  for (const board of spareByBoard) {
    lines.push(`${count(board.count, "sound")} did not fit on the grid of "${board.title}" and wait among its spare pads.`);
  }
  const long = units.filter((unit) => unit.fullTitle).length;
  if (long > 0) {
    lines.push(`${count(long, "title")} ${long === 1 ? "was" : "were"} longer than ${MAX_NAME_LENGTH} characters; the full title is in the ${long === 1 ? "track's" : "tracks'"} notes.`);
  }
  const renamed = units.filter((unit) => unit.otherTitles.length > 0).length;
  if (renamed > 0) {
    lines.push(`${count(renamed, "file")} had different titles in different places; the other titles are in ${renamed === 1 ? "its" : "their"} notes.`);
  }
  if (backupPath) lines.push(`A copy of your library was saved first: ${path.basename(backupPath)}.`);

  const result = finish({
    status: "moved",
    lines,
    backupPath,
    missingTrackIds: missingInOrder.map((unit) => trackIdOf.get(unit.key) as string),
    counts,
  });
  store.changeWithoutHistory(() => {
    store.run(
      "UPDATE library_jobs SET state = 'done', detail = ?, finished_at = ? WHERE name = ?",
      JSON.stringify({ backupPath, report: result }),
      store.now(),
      LEGACY_JOB,
    );
    // FND-16: this move took everything the old player holds now, so there is nothing for a later start to catch up.
    recordCatchUp(store, catchUpReport("nothing-new", ["The first move took everything the old player held."], emptyCatchUpParts()));
  });
  store.clearHistory();
  report({ phase: "done", done: total, total, message: result.summary });
  return result;
}

function emptyCounts(): LegacyImportReport["counts"] {
  return { playlists: 0, playlistEntries: 0, boards: 0, pads: 0, tracks: 0 };
}

function finish(report: Omit<LegacyImportReport, "summary">): LegacyImportReport {
  return { ...report, summary: report.lines.join(" ") };
}

// --- FND-16 (0.5.1): what the old player gained after the first move ---

/** The catch-up's name in library_jobs. */
export const LEGACY_CATCH_UP_JOB = "legacy-player-catch-up";

export type LegacyCatchUpReport = {
  /**
   * brought-in: done now; nothing-new: the old player had nothing the library lacks (recorded, never runs again);
   * already-done: an earlier start did it (this is that report); no-first-import: the first move has not happened
   * (importLegacyLibrary does everything then); unreadable: tried again next time.
   */
  status: "brought-in" | "nothing-new" | "already-done" | "no-first-import" | "unreadable";
  /** New playlists and soundboards, by title. */
  playlists: string[];
  boards: string[];
  /** Playlists and pad boards already in the library that new files were added to, by title. */
  addedTo: string[];
  /**
   * Playlists and soundboards the old player has and the library does not, made only of files the library has: most
   * likely ones Nik took out of Lyre, so they are not brought back, only named.
   */
  notBroughtBack: string[];
  lines: string[];
  summary: string;
  backupPath: string | null;
  missingTrackIds: string[];
  /** New playlists and boards; new tracks; entries and pads added to playlists and boards the library had. */
  counts: { playlists: number; boards: number; tracks: number; playlistEntries: number; pads: number };
  /** When it ran (ms since 1970); 0 when it has not. */
  at: number;
};

type CatchUpParts = Pick<LegacyCatchUpReport, "playlists" | "boards" | "addedTo" | "notBroughtBack" | "backupPath" | "missingTrackIds" | "counts" | "at">;

function emptyCatchUpParts(): CatchUpParts {
  return { playlists: [], boards: [], addedTo: [], notBroughtBack: [], backupPath: null, missingTrackIds: [], counts: { playlists: 0, boards: 0, tracks: 0, playlistEntries: 0, pads: 0 }, at: 0 };
}

function catchUpReport(status: LegacyCatchUpReport["status"], lines: string[], parts: CatchUpParts): LegacyCatchUpReport {
  return { status, lines, summary: lines.join(" "), ...parts };
}

function recordCatchUp(store: Store, report: LegacyCatchUpReport): void {
  store.run(
    "INSERT OR REPLACE INTO library_jobs (name, state, detail, started_at, finished_at) VALUES (?, 'done', ?, ?, ?)",
    LEGACY_CATCH_UP_JOB,
    JSON.stringify({ report }),
    store.now(),
    store.now(),
  );
}

/** What the catch-up recorded, or null when it has not run. */
export function readCatchUp(store: Store): LegacyCatchUpReport | null {
  const job = store.get<{ detail: string }>("SELECT detail FROM library_jobs WHERE name = ? AND state = 'done'", LEGACY_CATCH_UP_JOB);
  return job ? (JSON.parse(job.detail).report as LegacyCatchUpReport) : null;
}

/**
 * Brings in, once, what the old player gained after the first move (Nik, 11 Nov: "bring in only what is new"):
 * - a playlist or soundboard whose old id is not in the library comes in whole, as the first move would bring it,
 *   when it has at least one file the library lacks; one made only of files the library has is most likely one Nik
 *   took out of Lyre (the library cannot tell), so it is named in the report and not brought back;
 * - a playlist or soundboard the library has gets the files that are new to the library, at its end (pads among the
 *   board's spare pads, so the grid Nik laid out stays as it is).
 * A file is in the library when a track has its old id (the first move kept old ids; Find missing files keeps a
 * track's id) or its file or address. Nothing the library has is added again, so nothing is doubled. A container whose
 * old id could not be kept cannot be matched and is left alone. A backup is taken before anything is written.
 */
export async function catchUpLegacyLibrary(library: Library, raw: unknown, options: LegacyImportOptions = {}): Promise<LegacyCatchUpReport> {
  const store = library.store;
  if (readJob(store)?.state !== "done") return catchUpReport("no-first-import", [], emptyCatchUpParts());
  const recorded = readCatchUp(store);
  if (recorded) return { ...recorded, status: "already-done" };

  let state: LegacyPlayerState;
  try {
    state = parseLegacyPlayerState(raw);
  } catch {
    return catchUpReport("unreadable", [UNREADABLE], emptyCatchUpParts());
  }
  const moving = plan(state);

  // Which old files the library has: by the old id the first move kept, else by file or address.
  const trackIds = new Set(store.all<{ id: string }>("SELECT id FROM tracks").map((row) => row.id));
  const known = locationsInLibrary(store);
  const trackIdOf = new Map<string, string>();
  for (const unit of moving.units.values()) {
    const existing = trackIds.has(unit.id) ? unit.id : known.get(unit.key);
    if (existing) trackIdOf.set(unit.key, existing);
  }
  const isNew = (key: string) => !trackIdOf.has(key);

  const absentPlaylists = moving.playlists.filter((p) => p.keptId && !exists(store, "playlists", p.id));
  const absentBoards = moving.boards.filter((b) => b.keptId && !exists(store, "boards", b.id));
  const newPlaylists = absentPlaylists.filter((p) => p.trackKeys.some(isNew));
  const newBoards = absentBoards.filter((b) => b.pads.some((pad) => isNew(pad.trackKey)));
  const notBroughtBack = [...absentPlaylists.filter((p) => !newPlaylists.includes(p)).map((p) => p.title), ...absentBoards.filter((b) => !newBoards.includes(b)).map((b) => b.title)];
  const notBackLine = notBroughtBack.length > 0
    ? [`Not brought back: ${names(notBroughtBack)}. The old player still has ${notBroughtBack.length === 1 ? "it" : "them"}, made only of tracks already in your library, so Lyre took ${notBroughtBack.length === 1 ? "it" : "them"} as removed on purpose.`]
    : [];
  const growing = moving.playlists
    .filter((p) => p.keptId && exists(store, "playlists", p.id) && isManual(store, p.id))
    .map((p) => ({ playlist: p, keys: [...new Set(p.trackKeys.filter(isNew))] }))
    .filter((g) => g.keys.length > 0);
  const growingBoards = moving.boards
    .filter((b) => b.keptId && exists(store, "boards", b.id))
    .map((b) => ({ board: b, pads: b.pads.filter((pad) => isNew(pad.trackKey) && !exists(store, "pads", pad.id)) }))
    .filter((g) => g.pads.length > 0);

  const wanted = new Set<string>([
    ...newPlaylists.flatMap((p) => p.trackKeys),
    ...newBoards.flatMap((b) => b.pads.map((pad) => pad.trackKey)),
    ...growing.flatMap((g) => g.keys),
    ...growingBoards.flatMap((g) => g.pads.map((pad) => pad.trackKey)),
  ]);
  const units = [...moving.units.values()].filter((unit) => wanted.has(unit.key));
  const toCreate = units.filter((unit) => isNew(unit.key));
  if (newPlaylists.length === 0 && newBoards.length === 0 && growing.length === 0 && growingBoards.length === 0) {
    const report = catchUpReport("nothing-new", ["The old player had nothing new since the first move.", ...notBackLine], { ...emptyCatchUpParts(), notBroughtBack, at: store.now() });
    store.changeWithoutHistory(() => recordCatchUp(store, report));
    return report;
  }

  const backupPath = (await library.backupBeforeImport()).path;
  const { missing } = await createUnitTracks(store, units, trackIdOf, trackIds, options);
  const missingNew = missing.filter((unit) => toCreate.includes(unit));
  for (const playlist of newPlaylists) {
    store.changeWithoutHistory(() => savePlaylist(store, playlist, trackIdOf));
    await nextTurn();
  }
  for (const board of newBoards) {
    store.changeWithoutHistory(() => saveBoard(store, board, trackIdOf));
    await nextTurn();
  }
  for (const { playlist, keys } of growing) {
    store.changeWithoutHistory(() => addTracksToPlaylist(store, playlist.id, keys.map((key) => trackIdOf.get(key) as string)));
  }
  for (const { board, pads } of growingBoards) {
    store.changeWithoutHistory(() => pads.forEach((pad) => savePad(store, board.id, pad, trackIdOf, "spare")));
  }

  const parts: CatchUpParts = {
    playlists: newPlaylists.map((p) => p.title),
    boards: newBoards.map((b) => b.title),
    addedTo: [...growing.map((g) => g.playlist.title), ...growingBoards.map((g) => g.board.title)],
    notBroughtBack,
    backupPath,
    missingTrackIds: missingNew.map((unit) => trackIdOf.get(unit.key) as string),
    counts: {
      playlists: newPlaylists.length,
      boards: newBoards.length,
      tracks: toCreate.length,
      playlistEntries: growing.reduce((sum, g) => sum + g.keys.length, 0),
      pads: growingBoards.reduce((sum, g) => sum + g.pads.length, 0),
    },
    at: store.now(),
  };
  const lines: string[] = [];
  if (parts.playlists.length > 0) lines.push(`Brought in ${count(parts.playlists.length, "playlist")} added in the old player since your first start: ${names(parts.playlists)}.`);
  if (parts.boards.length > 0) lines.push(`Brought in ${count(parts.boards.length, "soundboard")} added in the old player since your first start: ${names(parts.boards)}.`);
  if (parts.addedTo.length > 0) {
    lines.push(`Added the new files to ${names(parts.addedTo)}; new sounds wait among the board's spare pads.`);
  }
  if (missingNew.length > 0) {
    lines.push(`${count(missingNew.length, "file")} could not be found: ${names(missingNew.map((unit) => baseName((unit.location as { file: string }).file)))}. Use Find missing files to show Lyre where.`);
  }
  lines.push(...notBackLine);
  lines.push(`A copy of your library was saved first: ${path.basename(backupPath)}.`);
  const report = catchUpReport("brought-in", lines, parts);
  store.changeWithoutHistory(() => recordCatchUp(store, report));
  store.clearHistory();
  return report;
}

function isManual(store: Store, playlistId: string): boolean {
  return store.get<{ kind: string }>("SELECT kind FROM playlists WHERE id = ?", playlistId)?.kind === "manual";
}

/**
 * What each start does with the old player's library (the library's process, on the Lyre page's first call): the first
 * move when it has not happened (importLegacyLibrary), else the catch-up once (FND-16). The first move's report,
 * with the catch-up's when it ran or had run.
 */
export async function bringInOldPlayer(
  library: Library,
  raw: unknown,
  options: LegacyImportOptions = {},
): Promise<LegacyImportReport & { catchUp?: LegacyCatchUpReport }> {
  const report = await importLegacyLibrary(library, raw, options);
  if (report.status !== "already-done" && report.status !== "moved") return report;
  return { ...report, catchUp: await catchUpLegacyLibrary(library, raw, options) };
}
