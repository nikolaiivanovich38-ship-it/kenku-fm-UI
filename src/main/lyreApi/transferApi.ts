/**
 * DAT-7 for the main-process LyreApi (libraryApi.ts `transfer`): Save to a file, Open a file and Bring in, over the
 * .lyre format (src/main/transfer). Kept apart from libraryApi.ts so the file work reads as one piece.
 */
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { parseKeyOfPlace, parsePlaceKey, type PlayOrderOverrides, type ProfileOverrides } from "../../common/domain";
import type { BringInChoices, BringInReport, OpenedFile, SavedFile, TransferEstimate, TransferScope } from "../../common/lyre/api";
import { plural } from "../../common/lyre/text";
import type { TransferContents, TransferLibrary } from "../../common/lyre/transfer";
import { ValidationError, type Store } from "../data";
import { nextTurn } from "../data/store";
import { baseName } from "../data/import/tagReader";
import type { FileProbe } from "../data/import/relink";
import { bringIn, describeFile, tracksToAdd, type FileItem } from "../transfer/bringIn";
import { LYRE_FILE_LIMITS, LyreFileError, entryExtension, readLyreFile, refusalWords, writeLyreFile, type FileTrack, type LyreFileLibrary, type OpenedLyreFile } from "../transfer/lyreFile";
import { Refused } from "./refused";

export interface TransferFiles {
  /** Where brought-in files go: a folder per file, "<this>\<file name>". */
  broughtInFolder: string;
  /** Now, for the file's date and the whole library's file name. */
  today: () => number;
  /** Free bytes on the drive of a folder (default `freeBytesAt`); tests answer for a full drive. */
  freeBytes?: (folder: string) => Promise<number | null>;
}

/** "45 MB", "40 KB" (as a file manager rounds). */
export function sizeWords(bytes: number): string {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateWords = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** A name Windows and every other system accept, from a name in a file (never a path: only its last part is kept). */
export function safeFileName(name: string, fallback = "track"): string {
  let clean = baseName(name.replace(/\\/g, "/"))
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  if (clean === "" || clean === "." || clean === "..") clean = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) clean = `_${clean}`;
  if (clean.length > 150) {
    const ext = path.extname(clean).slice(0, 10);
    clean = clean.slice(0, 150 - ext.length) + ext;
  }
  return clean;
}

/* ---------- Save to a file ---------- */

export interface SaveInput {
  target: string;
  scope: TransferScope;
  estimate: TransferEstimate;
  contents: TransferContents;
  overrides: ProfileOverrides;
  playOrders: PlayOrderOverrides;
  includeAudio: boolean;
  /** A track's file on this computer (null: a web address). */
  fileOf(trackId: string): string | null;
  probe: FileProbe & { open?(file: string): NodeJS.ReadableStream };
  savedAt: number;
}

/** The audio settings and play orders of the places inside the scope, for its tracks and playlists. */
function settingsInside(contents: TransferContents, overrides: ProfileOverrides, playOrders: PlayOrderOverrides) {
  const tracks = new Set(contents.tracks.map((t) => t.id));
  const playlists = new Set(contents.playlists.map((p) => p.id));
  const sessions = new Set<string>();
  const scenes = new Set<string>();
  const campaigns = new Set(contents.campaigns.map((c) => c.id));
  for (const c of contents.campaigns) {
    for (const s of c.sessions) {
      sessions.add(`${c.id}:${s.id}`);
      s.scenes.forEach((sc) => scenes.add(`${c.id}:${s.id}:${sc.id}`));
    }
  }
  const outOverrides: ProfileOverrides = {};
  for (const [key, byTrack] of Object.entries(overrides)) {
    const p = parsePlaceKey(key);
    const inside = p && (p.kind === "playlist" ? playlists.has(p.playlistId) : p.kind === "session" ? sessions.has(`${p.campaignId}:${p.sessionId}`) : scenes.has(`${p.campaignId}:${p.sessionId}:${p.sceneId}`));
    if (!inside) continue;
    const kept = Object.fromEntries(Object.entries(byTrack).filter(([t]) => tracks.has(t)));
    if (Object.keys(kept).length) outOverrides[key] = kept;
  }
  const outOrders: PlayOrderOverrides = {};
  for (const [key, byPlaylist] of Object.entries(playOrders)) {
    const p = parseKeyOfPlace(key);
    // Whole campaigns only: a session or scene file cuts its campaign down, so the campaign's list is not in it.
    const inside = p && (p.kind === "campaign" ? campaigns.has(p.campaignId) && contents.campaigns.some((c) => c.id === p.campaignId && c.playlistIds.length > 0) : p.kind === "session" ? sessions.has(`${p.campaignId}:${p.sessionId}`) : scenes.has(`${p.campaignId}:${p.sessionId}:${p.sceneId}`));
    if (!inside) continue;
    const kept = Object.fromEntries(Object.entries(byPlaylist).filter(([id]) => playlists.has(id)));
    if (Object.keys(kept).length) outOrders[key] = kept;
  }
  return { overrides: outOverrides, playOrders: outOrders };
}

const fileTrack = ({ url: _url, addedAt: _added, isNew: _isNew, suggestedShape: _suggested, loudness: _loudness, ...rest }: TransferContents["tracks"][number]): FileTrack => rest;

export async function saveLyreFile(input: SaveInput): Promise<SavedFile> {
  const target = /\.lyre$/i.test(input.target) ? input.target : `${input.target}.lyre`;
  const { contents, estimate } = input;
  const audio: { trackId: string; file: string; fileName: string; bytes: number }[] = [];
  let notFound = 0;
  if (input.includeAudio && !estimate.leaveAudioOutBecause) {
    for (const t of contents.tracks) {
      const file = input.fileOf(t.id);
      if (file === null) continue;
      if (!(await input.probe.exists(file))) {
        notFound++;
        continue;
      }
      audio.push({ trackId: t.id, file, fileName: t.fileName, bytes: (await input.probe.facts(file)).size });
    }
    const total = audio.reduce((n, a) => n + a.bytes, 0);
    if (total > LYRE_FILE_LIMITS.fileBytes) throw new Refused("invalid", `With the audio files this would be ${sizeWords(total)}, more than a Lyre file can hold (4 GB). Save it without the audio files, or save a smaller part.`);
  }
  const library: LyreFileLibrary = {
    tracks: contents.tracks.map(fileTrack),
    tagGroups: contents.tagGroups,
    playlists: contents.playlists,
    boards: contents.boards,
    campaigns: contents.campaigns,
    ...settingsInside(contents, input.overrides, input.playOrders),
  };
  let bytes: number;
  try {
    bytes = await writeLyreFile(target, { scope: input.scope, title: estimate.title, counts: estimate.counts, library, audio, savedAt: input.savedAt }, { openAudio: input.probe.open });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "EROFS" || code === "ENOSPC") {
      throw new Refused("invalid", code === "ENOSPC" ? "There is not enough room on that drive. Choose another place, or save without the audio files." : "Lyre cannot save there. Choose another folder.", "path");
    }
    throw error;
  }
  const name = baseName(target);
  const folder = target.slice(0, Math.max(0, target.length - name.length - 1));
  const left = notFound ? ` ${plural(notFound, "audio file")} Lyre cannot find ${notFound === 1 ? "was" : "were"} left out: Find missing files looks for ${notFound === 1 ? "it" : "them"}.` : "";
  return { path: target, bytes, summary: `Saved ${name} (${sizeWords(bytes)}) in ${folder}.${left}` };
}

/* ---------- Open a file ---------- */

export interface OpenTransfer {
  preview: OpenedFile;
  path: string;
  file: OpenedLyreFile;
  items: FileItem[];
  close(): Promise<void>;
}

/** Opens and checks a file; a file Lyre does not open is refused in plain words ("not-lyre-file"), nothing changed. */
export async function openLyreFile(file: string, mine: TransferLibrary): Promise<OpenTransfer> {
  const name = baseName(file);
  let opened: OpenedLyreFile;
  try {
    opened = await readLyreFile(file);
  } catch (error) {
    if (error instanceof LyreFileError) throw new Refused("not-lyre-file", refusalWords(name, error.problem));
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Refused("not-found", `"${name}" is not there any more.`);
    if ((error as NodeJS.ErrnoException).code === "EISDIR") throw new Refused("not-lyre-file", refusalWords(name, "not-lyre"));
    throw error;
  }
  // A track names its file, never a path: a name with a folder in it could reach outside the brought-in folder.
  if (opened.library.tracks.some((t) => /[\\/]/.test(t.fileName) || t.fileName === "." || t.fileName === "..")) {
    await opened.close();
    throw new Refused("not-lyre-file", refusalWords(name, "unsafe"));
  }
  const items = describeFile(opened.library, mine);
  const { manifest } = opened;
  return {
    path: file,
    file: opened,
    items,
    preview: {
      id: randomUUID(),
      fileName: name,
      madeWith: `${manifest.madeWith}, ${dateWords(manifest.savedAt)}`,
      includesAudio: manifest.audio.length > 0,
      items: items.map(({ key, kind, name: itemName, detail, status, yours }) => ({ key, kind, name: itemName, detail, status, yours })),
    },
    close: () => opened.close(),
  };
}

/* ---------- Bring in ---------- */

/** Free bytes on the drive that holds `folder` (or would, once made), or null when the system does not say. */
export async function freeBytesAt(folder: string): Promise<number | null> {
  let at = path.resolve(folder);
  for (;;) {
    try {
      const stats = await fs.promises.statfs(at);
      return stats.bavail * stats.bsize;
    } catch (error) {
      const up = path.dirname(at);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || up === at) return null;
      at = up;
    }
  }
}

/**
 * Unpacks the audio of the tracks that will be added, then brings the file in (one undo step). Answers the report and
 * the audio files it unpacked (removed again when the step is undone for good: libraryApi.ts `unpackedFiles`).
 */
export async function bringInLyreFile(store: Store, open: OpenTransfer, mine: TransferLibrary, choices: BringInChoices, files: TransferFiles): Promise<{ report: BringInReport; files: string[] }> {
  const { file, preview } = open;
  // Reading the library (`mine`) took the caller's turn; comparing the file with it takes the next one.
  await nextTurn();
  const folder = path.join(files.broughtInFolder, safeFileName(preview.fileName.replace(/\.lyre$/i, ""), "Brought in"));
  const adding = tracksToAdd(file.library, mine, choices).flatMap((t) => {
    const entry = file.audioOf(t.id);
    return entry ? [{ t, entry }] : [];
  });
  // Security review w4, Should 2: each part is unpacked once, so at most what the file holds (lyreFile.ts checks the
  // parts fit inside it); and not at all when the drive has no room for them.
  const need = [...new Map(adding.map((a) => [a.entry.entry, a.entry.bytes])).values()].reduce((n, b) => n + b, 0);
  if (need > 0) {
    const free = await (files.freeBytes ?? freeBytesAt)(files.broughtInFolder);
    if (free !== null && free < need) throw new Refused("invalid", `There is not enough room on the drive for the audio files in "${preview.fileName}" (${sizeWords(need)}). Make room, then bring it in again. Nothing was brought in.`);
  }
  const unpacked = new Map<string, string>();
  /** Tracks that name a part another track unpacked already: they become that track. */
  const sameAudioAs = new Map<string, string>();
  const unpackedBy = new Map<string, string>();
  const leftOut = new Set<string>();
  const made: string[] = [];
  try {
    const taken = new Set<string>();
    for (const { t, entry } of adding) {
      const first = unpackedBy.get(entry.entry);
      if (first) {
        sameAudioAs.set(t.id, first);
        continue;
      }
      if (leftOut.has(entry.entry)) continue;
      // Security review w4, Must 1: the file lands under the track's name with the entry's audio extension (the entry
      // name is Lyre's own, already checked), never the extension the track's file name gives (".exe", ".lnk").
      const ext = entryExtension(entry);
      if (!ext) {
        leftOut.add(entry.entry);
        continue;
      }
      const clean = safeFileName(t.fileName);
      const stem = clean.slice(0, clean.length - path.extname(clean).length) || "track";
      let target = "";
      for (let n = 1; ; n++) {
        target = path.join(folder, `${stem}${n === 1 ? "" : ` (${n})`}${ext}`);
        if (!taken.has(target.toLowerCase()) && !fs.existsSync(target)) break;
      }
      // Security: the target is Lyre's own name inside the brought-in folder, checked once more before writing.
      if (path.relative(folder, target).startsWith("..") || path.isAbsolute(path.relative(folder, target))) throw new LyreFileError("unsafe", "A name would leave the folder.");
      await fs.promises.mkdir(folder, { recursive: true });
      if (!(await file.unpackAudio(entry, target))) {
        leftOut.add(entry.entry);
        continue;
      }
      taken.add(target.toLowerCase());
      made.push(target);
      unpacked.set(t.id, target);
      unpackedBy.set(entry.entry, t.id);
    }
    const report = await bringIn(store, file.library, mine, choices, { fileName: preview.fileName, folder, unpacked, sameAudioAs, notAudio: leftOut.size, includesAudio: preview.includesAudio });
    return { report, files: made };
  } catch (error) {
    await Promise.all(made.map((f) => fs.promises.rm(f, { force: true })));
    if (error instanceof LyreFileError) throw new Refused("not-lyre-file", refusalWords(preview.fileName, error.problem));
    if (error instanceof ValidationError) throw new Refused("not-lyre-file", `"${preview.fileName}" holds something Lyre cannot take (${error.message}). Nothing was brought in.`);
    throw error;
  }
}
