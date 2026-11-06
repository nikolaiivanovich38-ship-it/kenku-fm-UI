/**
 * DAT-7: the .lyre file (docs/data-model.md, "The .lyre file"): a zip holding
 *
 *   lyre.json      what the file is: format "lyre-library-file", its version, which Lyre saved it and when, the scope
 *                  and its title, and the audio files it holds (entry name, track id, size)
 *   library.json   the scope's tracks, tag groups, playlists, pad boards, campaigns (with their sessions and scenes),
 *                  audio settings per place and play orders per place, in LyreApi's own shapes
 *   audio/00001.flac …  the audio files, when "Include the audio files" was ticked (stored, not packed again)
 *
 * Reading checks the whole file before anything changes, and treats it as hostile (docs/security.md, "w4-transfer"):
 * the zip layer caps sizes and names (zip.ts); here the manifest must say it is a Lyre file of a version this Lyre
 * reads, every audio entry it lists must be one the zip holds under a name Lyre makes itself, and library.json is
 * rebuilt field by field into fresh objects (text lengths, numbers, choices from fixed lists), so nothing in it is
 * taken as it is. Nothing in a .lyre file is run.
 */
import path from "path";
import fs from "fs";

import { PAD_MODES, REPEATS, TRACK_KINDS, TRACK_ROLES, TRACK_SHAPES, type AudioProfileInput, type PlayOrder, type PlayOrderOverrides, type PlaylistRule, type ProfileOverrides, type SoundRef } from "../../common/domain";
import { CAMPAIGN_THEMES, PAD_COLORS, SESSION_STATUSES, type CampaignInfo, type LibraryTrack, type PadBoard, type Pad, type PlaylistInfo, type SceneInfo, type SessionInfo, type TagGroup, type TransferCounts, type TransferScope } from "../../common/lyre/api";
import { AUDIO_EXTENSIONS } from "../data/import/audioFiles";
import { AUDIO_HEAD_BYTES, looksLikeAudio } from "./audioBytes";
import { ZipError, openZip, writeZip, type OpenedZip } from "./zip";
import { version as LYRE_VERSION } from "../../../package.json";

export const LYRE_FILE_FORMAT = "lyre-library-file";
/** Bump when library.json changes in a way an older Lyre would read wrongly; older versions stay readable. */
export const LYRE_FILE_VERSION = 1;
export const MANIFEST_ENTRY = "lyre.json";
export const LIBRARY_ENTRY = "library.json";

export const LYRE_FILE_LIMITS = {
  manifestBytes: 8 * 1024 * 1024,
  /** About 150,000 tracks with their settings. */
  libraryBytes: 256 * 1024 * 1024,
  tracks: 200_000,
  /** Every other list (playlists, pads, scenes, a playlist's tracks …). */
  items: 200_000,
  /** One audio file: larger than any track Lyre plays. */
  audioBytes: 2 * 1024 * 1024 * 1024,
  /** The whole file: no zip64, so 4 GB less room for the lists. */
  fileBytes: 0xffffffff - 64 * 1024 * 1024,
};

/** A track in a file: what the Library knows of it, without this computer's own facts (address, when added, New). */
/** A track as a .lyre file holds it: the measured loudness is left out (Lyre measures the files again where they land). */
export type FileTrack = Omit<LibraryTrack, "url" | "addedAt" | "isNew" | "suggestedShape" | "loudness">;

export interface LyreFileLibrary {
  tracks: FileTrack[];
  tagGroups: TagGroup[];
  playlists: PlaylistInfo[];
  boards: PadBoard[];
  campaigns: CampaignInfo[];
  /** Audio settings per place (placeKey, then track id), only places inside the scope. */
  overrides: ProfileOverrides;
  /** Play orders per place (keyOfPlace, then playlist id), only places inside the scope. */
  playOrders: PlayOrderOverrides;
}

export interface LyreFileAudio {
  /** "audio/00001.flac": a name Lyre makes, never one from the game master's computer. */
  entry: string;
  trackId: string;
  bytes: number;
}

export interface LyreFileManifest {
  format: typeof LYRE_FILE_FORMAT;
  version: number;
  /** "Lyre 0.4.0". */
  madeWith: string;
  /** When it was saved (ms since 1970). */
  savedAt: number;
  scope: TransferScope;
  title: string;
  counts: TransferCounts;
  audio: LyreFileAudio[];
}

/** Why a file is refused; the words the game master sees come from `refusalWords`. */
export type LyreFileProblem = "not-lyre" | "damaged" | "changed" | "newer" | "unsafe" | "too-big";

export class LyreFileError extends Error {
  constructor(
    readonly problem: LyreFileProblem,
    detail: string,
  ) {
    super(detail);
    // The app's bundles compile classes to ES5, where a subclass of Error loses its prototype (errorsBuilt.test.ts).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "LyreFileError";
  }
}

/** The plain words for a refused file. Every one ends by saying nothing changed. */
export function refusalWords(fileName: string, problem: LyreFileProblem): string {
  const name = `"${fileName}"`;
  switch (problem) {
    case "not-lyre":
      return `${name} is not a Lyre file. Lyre opens files saved with Save to a file (they end in .lyre).`;
    case "damaged":
      return `${name} is damaged: it stops part-way, so Lyre cannot tell what is in it. Nothing was brought in. Ask for the file again.`;
    case "changed":
      return `${name} is damaged: part of it was changed or cannot be read, so Lyre cannot tell what is in it. Nothing was brought in. Ask for the file again.`;
    case "newer":
      return `${name} was saved by a newer version of Lyre. Update Lyre, then open it again. Nothing was brought in.`;
    case "unsafe":
      return `${name} holds files or names Lyre never puts in a Lyre file, so Lyre does not open it. Nothing was brought in.`;
    case "too-big":
      return `${name} holds more than Lyre can open at once. Nothing was brought in.`;
  }
}

/* ---------- writing ---------- */

export interface LyreFileToWrite {
  scope: TransferScope;
  title: string;
  counts: TransferCounts;
  library: LyreFileLibrary;
  /** The audio files to put in it: the track and its file on this computer. */
  audio: { trackId: string; file: string; fileName: string; bytes: number }[];
  savedAt: number;
}

/** Saves a .lyre file at `target` (through "<target>.part"); answers its size in bytes. */
export async function writeLyreFile(target: string, file: LyreFileToWrite, options: { openAudio?: (file: string) => NodeJS.ReadableStream } = {}): Promise<number> {
  const openAudio = options.openAudio ?? ((p: string) => fs.createReadStream(p));
  const audio: LyreFileAudio[] = file.audio.map((a, i) => ({ entry: `audio/${String(i + 1).padStart(5, "0")}${audioExtension(a.fileName)}`, trackId: a.trackId, bytes: a.bytes }));
  const manifest: LyreFileManifest = {
    format: LYRE_FILE_FORMAT,
    version: LYRE_FILE_VERSION,
    madeWith: `Lyre ${LYRE_VERSION}`,
    savedAt: file.savedAt,
    scope: file.scope,
    title: file.title,
    counts: file.counts,
    audio,
  };
  return writeZip(
    target,
    [
      { name: MANIFEST_ENTRY, bytes: Buffer.from(JSON.stringify(manifest), "utf8"), deflate: true },
      { name: LIBRARY_ENTRY, bytes: Buffer.from(JSON.stringify(file.library), "utf8"), deflate: true },
      ...file.audio.map((a, i) => ({ name: audio[i].entry, stream: () => openAudio(a.file) as unknown as import("stream").Readable })),
    ],
    { at: new Date(file.savedAt) },
  );
}

/** The file's own extension when it is audio Lyre plays, else none (the entry is still stored). */
function audioExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext) ? ext : "";
}

const AUDIO_ENTRY = new RegExp(`^audio/\\d{5,6}(${AUDIO_EXTENSIONS.map((e) => e.replace(".", "\\.")).join("|")})?$`);

/* ---------- reading ---------- */

export interface OpenedLyreFile {
  manifest: LyreFileManifest;
  library: LyreFileLibrary;
  /** The audio entry the file holds for a track, if any. */
  audioOf(trackId: string): LyreFileAudio | null;
  /**
   * Unpacks one audio entry to `target`, checking its CRC (security review w4, Must 1). Only an entry with an audio
   * extension whose first bytes are that format is written, and only under a name with that same extension; for
   * anything else nothing is written and the answer is false.
   */
  unpackAudio(entry: LyreFileAudio, target: string): Promise<boolean>;
  close(): Promise<void>;
}

/** The audio extension of an entry ("audio/00001.flac" gives ".flac"), or "" when it has none Lyre plays. */
export function entryExtension(entry: LyreFileAudio): string {
  const ext = path.posix.extname(entry.entry).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext) ? ext : "";
}

/** Opens and checks a .lyre file; throws LyreFileError when Lyre does not open it. Nothing is written. */
export async function readLyreFile(file: string): Promise<OpenedLyreFile> {
  if (path.extname(file).toLowerCase() !== ".lyre") throw new LyreFileError("not-lyre", "The name does not end in .lyre.");
  let zip: OpenedZip;
  try {
    const size = (await fs.promises.stat(file)).size;
    if (size > LYRE_FILE_LIMITS.fileBytes) throw new LyreFileError("too-big", "Larger than a Lyre file can be.");
    zip = await openZip(file, { maxEntries: LYRE_FILE_LIMITS.tracks + 2 });
  } catch (error) {
    throw asFileError(error);
  }
  try {
    if (!zip.has(MANIFEST_ENTRY)) throw new LyreFileError("not-lyre", "No lyre.json.");
    const manifest = checkManifest(parseJson(await zip.read(MANIFEST_ENTRY, LYRE_FILE_LIMITS.manifestBytes)));
    if (!zip.has(LIBRARY_ENTRY)) throw new LyreFileError("damaged", "No library.json.");
    const library = checkLibrary(parseJson(await zip.read(LIBRARY_ENTRY, LYRE_FILE_LIMITS.libraryBytes)));
    const entries = new Map(zip.entries.map((e) => [e.name, e]));
    for (const name of entries.keys()) {
      if (name !== MANIFEST_ENTRY && name !== LIBRARY_ENTRY && !AUDIO_ENTRY.test(name)) throw new LyreFileError("unsafe", `An entry Lyre does not make: ${name}`);
    }
    const byTrack = new Map<string, LyreFileAudio>();
    for (const a of manifest.audio) {
      const entry = entries.get(a.entry);
      if (!entry || entry.size !== a.bytes || entry.method !== 0) throw new LyreFileError("changed", `Audio entry ${a.entry} does not match.`);
      if (a.bytes > LYRE_FILE_LIMITS.audioBytes) throw new LyreFileError("too-big", `Audio entry ${a.entry} is too large.`);
      if (byTrack.has(a.trackId)) throw new LyreFileError("changed", "Two audio files for one track.");
      byTrack.set(a.trackId, a);
    }
    return {
      manifest,
      library,
      audioOf: (trackId) => byTrack.get(trackId) ?? null,
      unpackAudio: async (a, target) => {
        const ext = entryExtension(a);
        if (!ext || a.bytes === 0) return false;
        // The name it lands under ends in the entry's own audio extension, whatever the track's file name says.
        if (path.extname(target).toLowerCase() !== ext) throw new LyreFileError("unsafe", "An audio file would be written under another kind of name.");
        try {
          if (!looksLikeAudio(ext, await zip.head(a.entry, AUDIO_HEAD_BYTES))) return false;
          await zip.copyTo(a.entry, target);
          return true;
        } catch (error) {
          throw asFileError(error);
        }
      },
      close: () => zip.close(),
    };
  } catch (error) {
    await zip.close().catch((): void => undefined);
    throw asFileError(error);
  }
}

function asFileError(error: unknown): unknown {
  if (error instanceof LyreFileError) return error;
  if (error instanceof ZipError) {
    // A file named .lyre that is no zip at all was cut off or overwritten: "damaged" says what to do (ask again).
    const problem: LyreFileProblem = { "not-zip": "damaged", damaged: "changed", "unsafe-name": "unsafe", "too-big": "too-big", unsupported: "unsafe" }[error.code] as LyreFileProblem;
    return new LyreFileError(/stops part-way/.test(error.message) ? "damaged" : problem, error.message);
  }
  return error;
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new LyreFileError("changed", "Not JSON.");
  }
}

/* ---------- checking what a file says (every value is rebuilt; nothing is taken as it is) ---------- */

/** A value that is not what Lyre writes there: the file was changed (or made by something else). */
const bad = (at: string) => new LyreFileError("changed", `Not what Lyre wrote at ${at}.`);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown, at: string): Obj => (isObj(v) ? v : (() => { throw bad(at); })());
const str = (v: unknown, at: string, max = 20_000): string => (typeof v === "string" && v.length <= max && !v.includes("\0") ? v : (() => { throw bad(at); })());
const id = (v: unknown, at: string): string => {
  const s = str(v, at, 200);
  if (s.length === 0) throw bad(at);
  return s;
};
const num = (v: unknown, at: string, min = -1e15, max = 1e15): number => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : (() => { throw bad(at); })());
const int = (v: unknown, at: string, min = 0, max = 1e15): number => {
  const n = num(v, at, min, max);
  if (!Number.isInteger(n)) throw bad(at);
  return n;
};
const bool = (v: unknown, at: string): boolean => (typeof v === "boolean" ? v : (() => { throw bad(at); })());
const oneOf = <T extends string>(choices: readonly T[], v: unknown, at: string): T => (typeof v === "string" && (choices as readonly string[]).includes(v) ? (v as T) : (() => { throw bad(at); })());
const orNull = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === null || v === undefined ? null : read(v));
const list = <T>(v: unknown, at: string, read: (item: unknown, at: string) => T, max = LYRE_FILE_LIMITS.items): T[] => {
  if (!Array.isArray(v) || v.length > max) throw bad(at);
  return v.map((item, i) => read(item, `${at}[${i}]`));
};
/** A record keyed by ids (tag groups, places, tracks): keys checked like ids, never "__proto__"-style keys. */
const record = <T>(v: unknown, at: string, read: (item: unknown, at: string) => T): Record<string, T> => {
  const out: Record<string, T> = Object.create(null);
  const o = obj(v, at);
  const keys = Object.keys(o);
  if (keys.length > LYRE_FILE_LIMITS.items) throw bad(at);
  for (const key of keys) {
    if (key.length === 0 || key.length > 300 || key === "__proto__" || key === "constructor" || key === "prototype") throw bad(at);
    out[key] = read(o[key], `${at}.${key}`);
  }
  return { ...out };
};

function checkScope(v: unknown, at: string): TransferScope {
  const o = obj(v, at);
  const kind = oneOf(["library", "tags", "campaign", "session", "scene", "playlist", "board"] as const, o.kind, `${at}.kind`);
  switch (kind) {
    case "library":
    case "tags":
      return { kind };
    case "campaign":
      return { kind, campaignId: id(o.campaignId, `${at}.campaignId`) };
    case "session":
      return { kind, campaignId: id(o.campaignId, `${at}.campaignId`), sessionId: id(o.sessionId, `${at}.sessionId`) };
    case "scene":
      return { kind, campaignId: id(o.campaignId, `${at}.campaignId`), sessionId: id(o.sessionId, `${at}.sessionId`), sceneId: id(o.sceneId, `${at}.sceneId`) };
    case "playlist":
      return { kind, playlistId: id(o.playlistId, `${at}.playlistId`) };
    case "board":
      return { kind, boardId: id(o.boardId, `${at}.boardId`) };
  }
}

const COUNT_KEYS = ["tracks", "playlists", "boards", "campaigns", "sessions", "scenes", "tagGroups"] as const;

export function checkManifest(raw: unknown): LyreFileManifest {
  if (!isObj(raw) || raw.format !== LYRE_FILE_FORMAT) throw new LyreFileError("not-lyre", "lyre.json does not say it is a Lyre file.");
  const version = int(raw.version, "version", 1, 1_000_000);
  if (version > LYRE_FILE_VERSION) throw new LyreFileError("newer", `Format version ${version}.`);
  const counts = obj(raw.counts, "counts");
  return {
    format: LYRE_FILE_FORMAT,
    version,
    madeWith: str(raw.madeWith, "madeWith", 100),
    savedAt: num(raw.savedAt, "savedAt", 0, 32503680000000),
    scope: checkScope(raw.scope, "scope"),
    title: str(raw.title, "title", 500),
    counts: Object.fromEntries(COUNT_KEYS.map((k) => [k, int(counts[k], `counts.${k}`)])) as unknown as TransferCounts,
    audio: list(raw.audio, "audio", (a, at) => {
      const o = obj(a, at);
      const entry = str(o.entry, `${at}.entry`, 40);
      if (!AUDIO_ENTRY.test(entry)) throw new LyreFileError("unsafe", `Audio entry name ${entry}.`);
      return { entry, trackId: id(o.trackId, `${at}.trackId`), bytes: int(o.bytes, `${at}.bytes`) };
    }, LYRE_FILE_LIMITS.tracks),
  };
}

function checkProfile(v: unknown, at: string): AudioProfileInput {
  const o = obj(v, at);
  const out: AudioProfileInput = {};
  for (const key of ["startMs", "endMs", "loopStartMs", "loopCrossfadeMs"] as const) if (o[key] !== undefined) out[key] = num(o[key], `${at}.${key}`, 0, 1e9);
  if (o.after !== undefined) out.after = oneOf(["loop", "next", "stop"] as const, o.after, `${at}.after`);
  for (const key of ["fadeIn", "fadeOut"] as const) {
    if (o[key] === undefined) continue;
    const f = obj(o[key], `${at}.${key}`);
    out[key] = { ms: num(f.ms, `${at}.${key}.ms`, 0, 1e9), shape: num(f.shape, `${at}.${key}.shape`, 0, 100) };
  }
  if (o.markers !== undefined) out.markers = list(o.markers, `${at}.markers`, (m, mat) => ({ atMs: num(obj(m, mat).atMs, `${mat}.atMs`, 0, 1e9), label: str(obj(m, mat).label, `${mat}.label`, 500) }), 1000);
  return out;
}

const shapeOrNull = (v: unknown, at: string) => orNull(v, (x) => oneOf(TRACK_SHAPES, x, at));
/** PLY-15: on, off, or null (follow the playlist and the library); files made before it have none. */
const normaliseOrNull = (v: unknown, at: string) => (v === undefined ? null : orNull(v, (x) => oneOf(["on", "off"] as const, x, at)));

function checkTrack(v: unknown, at: string): FileTrack {
  const o = obj(v, at);
  return {
    id: id(o.id, `${at}.id`),
    kind: oneOf(TRACK_KINDS, o.kind, `${at}.kind`),
    title: str(o.title, `${at}.title`, 500),
    metaTitle: str(o.metaTitle, `${at}.metaTitle`, 500),
    fileName: str(o.fileName, `${at}.fileName`, 500),
    durationMs: num(o.durationMs, `${at}.durationMs`, 0, 1e9),
    role: orNull(o.role, (x) => oneOf(TRACK_ROLES, x, `${at}.role`)),
    loop: orNull(o.loop, (x) => oneOf(["yes", "crossfade", "no"] as const, x, `${at}.loop`)),
    energy: orNull(o.energy, (x) => int(x, `${at}.energy`, 1, 5)),
    tags: record(o.tags, `${at}.tags`, (values, vat) => list(values, vat, (t, tat) => str(t, tat, 500), 1000)),
    profile: orNull(o.profile, (x) => checkProfile(x, `${at}.profile`)),
    shape: shapeOrNull(o.shape, `${at}.shape`),
    normalise: normaliseOrNull(o.normalise, `${at}.normalise`),
    artist: str(o.artist ?? "", `${at}.artist`, 500),
    album: str(o.album ?? "", `${at}.album`, 500),
    folder: str(o.folder ?? "", `${at}.folder`, 4096),
    notes: str(o.notes ?? "", `${at}.notes`),
    sizeBytes: orNull(o.sizeBytes, (x) => int(x, `${at}.sizeBytes`)),
  };
}

function checkOrder(v: unknown, at: string): PlayOrder {
  const o = obj(v, at);
  return { shuffle: bool(o.shuffle, `${at}.shuffle`), repeat: oneOf(REPEATS, o.repeat, `${at}.repeat`) };
}

function checkRule(v: unknown, at: string): PlaylistRule {
  const o = obj(v, at);
  const rule: PlaylistRule = {
    conds: list(o.conds, `${at}.conds`, (c, cat) => {
      const x = obj(c, cat);
      return { group: id(x.group, `${cat}.group`), match: oneOf(["any", "all", "none"] as const, x.match, `${cat}.match`), values: list(x.values, `${cat}.values`, (s, sat) => str(s, sat, 500), 1000) };
    }, 100),
  };
  if (o.energy !== undefined) {
    const e = list(o.energy, `${at}.energy`, (n, nat) => num(n, nat, 0, 5), 2);
    if (e.length !== 2) throw bad(`${at}.energy`);
    rule.energy = [e[0], e[1]];
  }
  if (o.leaveOutStings !== undefined) rule.leaveOutStings = bool(o.leaveOutStings, `${at}.leaveOutStings`);
  if (o.shapes !== undefined) rule.shapes = list(o.shapes, `${at}.shapes`, (s, sat) => oneOf(TRACK_SHAPES, s, sat), 10);
  return rule;
}

function checkPlaylist(v: unknown, at: string): PlaylistInfo {
  const o = obj(v, at);
  const base = { id: id(o.id, `${at}.id`), name: str(o.name, `${at}.name`, 500), lane: oneOf(TRACK_KINDS, o.lane, `${at}.lane`), notes: str(o.notes ?? "", `${at}.notes`), order: orNull(o.order, (x) => checkOrder(x, `${at}.order`)), normalise: normaliseOrNull(o.normalise, `${at}.normalise`) };
  const kind = oneOf(["manual", "dynamic"] as const, o.kind, `${at}.kind`);
  return kind === "manual" ? { ...base, kind, trackIds: list(o.trackIds, `${at}.trackIds`, id) } : { ...base, kind, rule: checkRule(o.rule, `${at}.rule`) };
}

function checkPad(v: unknown, at: string): Pad {
  const o = obj(v, at);
  const s = obj(o.sound, `${at}.sound`);
  return {
    id: id(o.id, `${at}.id`),
    label: str(o.label, `${at}.label`, 500),
    icon: str(o.icon, `${at}.icon`, 100),
    color: oneOf(PAD_COLORS, o.color, `${at}.color`),
    key: str(o.key, `${at}.key`, 10),
    mode: oneOf(PAD_MODES, o.mode, `${at}.mode`),
    sound: {
      kind: oneOf(["single", "variants", "tag"] as const, s.kind, `${at}.sound.kind`),
      trackIds: list(s.trackIds, `${at}.sound.trackIds`, id, 1000),
      order: oneOf(["random", "in_turn"] as const, s.order, `${at}.sound.order`),
      tag: orNull(s.tag, (t) => ({ group: id(obj(t, `${at}.sound.tag`).group, `${at}.sound.tag.group`), value: str(obj(t, `${at}.sound.tag`).value, `${at}.sound.tag.value`, 500) })),
    },
    volume: num(o.volume, `${at}.volume`, 0, 1),
    fadeOutMs: num(o.fadeOutMs, `${at}.fadeOutMs`, 0, 1e9),
    aside: o.aside === undefined ? false : bool(o.aside, `${at}.aside`),
  };
}

function checkBoard(v: unknown, at: string): PadBoard {
  const o = obj(v, at);
  const cols = int(o.cols, `${at}.cols`, 1, 8);
  const rows = int(o.rows, `${at}.rows`, 1, 8);
  const slots = list(o.slots, `${at}.slots`, (p, pat) => orNull(p, (x) => checkPad(x, pat)), 64);
  if (slots.length !== cols * rows) throw bad(`${at}.slots`);
  return { id: id(o.id, `${at}.id`), name: str(o.name, `${at}.name`, 500), cols, rows, slots, spare: list(o.spare, `${at}.spare`, checkPad, 10_000) };
}

const soundRef = (v: unknown, at: string): SoundRef => {
  const o = obj(v, at);
  return { kind: oneOf(["track", "playlist"] as const, o.kind, `${at}.kind`), id: id(o.id, `${at}.id`) };
};

function checkScene(v: unknown, at: string): SceneInfo {
  const o = obj(v, at);
  return {
    id: id(o.id, `${at}.id`),
    name: str(o.name, `${at}.name`, 500),
    music: list(o.music, `${at}.music`, soundRef, 10_000),
    ambience: orNull(o.ambience, (x) => soundRef(x, `${at}.ambience`)),
    boardIds: list(o.boardIds, `${at}.boardIds`, id, 1000),
    startsWhen: str(o.startsWhen ?? "", `${at}.startsWhen`, 2000),
    notes: str(o.notes ?? "", `${at}.notes`),
    noteLink: str(o.noteLink ?? "", `${at}.noteLink`, 2000),
    trackNames: record(o.trackNames ?? {}, `${at}.trackNames`, (n, nat) => str(n, nat, 500)),
  };
}

function checkSession(v: unknown, at: string, campaignId: string): SessionInfo {
  const o = obj(v, at);
  return {
    id: id(o.id, `${at}.id`),
    campaignId,
    number: int(o.number, `${at}.number`, 0, 1_000_000),
    name: str(o.name, `${at}.name`, 500),
    date: orNull(o.date, (d) => {
      const s = str(d, `${at}.date`, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad(`${at}.date`);
      return s;
    }),
    status: oneOf(SESSION_STATUSES, o.status, `${at}.status`),
    noteLink: str(o.noteLink ?? "", `${at}.noteLink`, 2000),
    playlistIds: list(o.playlistIds, `${at}.playlistIds`, id, 1000),
    boardIds: list(o.boardIds, `${at}.boardIds`, id, 1000),
    trackIds: list(o.trackIds ?? [], `${at}.trackIds`, id, 10_000),
    scenes: list(o.scenes, `${at}.scenes`, checkScene, 10_000),
  };
}

function checkCampaign(v: unknown, at: string): CampaignInfo {
  const o = obj(v, at);
  const campaignId = id(o.id, `${at}.id`);
  const obs = isObj(o.obsidian) ? o.obsidian : {};
  return {
    id: campaignId,
    name: str(o.name, `${at}.name`, 500),
    system: str(o.system ?? "", `${at}.system`, 500),
    theme: oneOf(CAMPAIGN_THEMES, o.theme, `${at}.theme`),
    description: str(o.description ?? "", `${at}.description`, 2000),
    notes: str(o.notes ?? "", `${at}.notes`),
    obsidian: { vault: str(obs.vault ?? "", `${at}.obsidian.vault`, 2000), note: str(obs.note ?? "", `${at}.obsidian.note`, 2000), sessionsFolder: str(obs.sessionsFolder ?? "", `${at}.obsidian.sessionsFolder`, 2000) },
    playlistIds: list(o.playlistIds, `${at}.playlistIds`, id, 1000),
    boardIds: list(o.boardIds, `${at}.boardIds`, id, 1000),
    trackIds: list(o.trackIds ?? [], `${at}.trackIds`, id, 10_000),
    sessions: list(o.sessions, `${at}.sessions`, (s, sat) => checkSession(s, sat, campaignId), 10_000),
  };
}

export function checkLibrary(raw: unknown): LyreFileLibrary {
  const o = obj(raw, "library");
  return {
    tracks: list(o.tracks, "tracks", checkTrack, LYRE_FILE_LIMITS.tracks),
    tagGroups: list(o.tagGroups, "tagGroups", (g, at) => ({ id: id(obj(g, at).id, `${at}.id`), name: str(obj(g, at).name, `${at}.name`, 200), values: list(obj(g, at).values, `${at}.values`, (s, sat) => str(s, sat, 500), 100_000) }), 1000),
    playlists: list(o.playlists, "playlists", checkPlaylist),
    boards: list(o.boards, "boards", checkBoard),
    campaigns: list(o.campaigns, "campaigns", checkCampaign, 10_000),
    overrides: record(o.overrides ?? {}, "overrides", (byTrack, at) => record(byTrack, at, checkProfile)),
    playOrders: record(o.playOrders ?? {}, "playOrders", (byPlaylist, at) => record(byPlaylist, at, checkOrder)),
  };
}
