/**
 * DAT-8: tracks whose files have gone (moved, renamed, a drive letter
 * changed), and pointing them at their new place in bulk.
 *
 * The game master chooses a folder; Lyre looks there (with subfolders) for
 * each missing file:
 * - "sure": same name, size and quick checksum, or a renamed file with the
 *   same size and checksum;
 * - "likely": same name and size (the library knew no checksum);
 * - "name": same name only: the library knew neither size nor checksum (as for
 *   files moved in from the old player that were already missing then), or the
 *   file there has another size (round 5: "Same name, different size: check
 *   it"). The screen asks, and does not tick it.
 * 0.5.2 item 14 (Nik: "It should match on file name, file checksum/hash, and
 * sound profile"): a file that sounds the same, the same length (within a
 * second, or 1 % of a long one) and loudness (within 1 LU) as Lyre measured the
 * track, counts too: with its name it is "likely" (a re-encoded copy, moved);
 * without it, "name" (renamed and re-encoded: the screen asks). Lengths are read
 * once per file and loudness measured only for a file whose length fits. Each
 * match says why (`reasons`: content, name, sound), and candidates are ranked:
 * how sure, then how many reasons, then the folders.
 * Among equally good candidates, the one whose folders match the old path most
 * closely wins ("Witcher/theme.flac" over "Other/theme.flac"); a tie is
 * reported for the game master to choose. A file another track already has is
 * never used, so a file never becomes two tracks.
 *
 * Applying the matches is one undo step ("Relink 12 files").
 * When a whole library folder moved, changing that folder (updateRoot) is one
 * row and the better fix; this is for files outside library folders or
 * scattered moves.
 */
import { ValidationError } from "../errors";
import { joinRoot } from "../paths";
import type { Store } from "../store";
import { listRoots } from "../repo/roots";
import { SHOWN_TITLE_SQL, findTrackByLocation, relocateTracks } from "../repo/tracks";
import { plural } from "../repo/common";
import * as v from "../validate";
import { collectAudioFiles, fileKey } from "./audioFiles";
import { mapLimit } from "./cancel";
import { fileExists, readFileFacts, type ReadFacts } from "./fileFacts";
import { locationsInLibrary } from "./pipeline";
import { baseName } from "./tagReader";

export type MissingTrack = {
  id: string;
  /** The name the track is shown by. */
  title: string;
  /** Where the library expects the file. */
  path: string;
  fileName: string;
  size: number | null;
  checksum: string | null;
  /** 0.5.2 item 14: its length, and the loudness Lyre measured from its file while it was there (null: unknown). */
  durationMs: number | null;
  lufs: number | null;
  /** Review I1: the whole track a part (schema v011) was split from; a part shares its whole's file. Null: a whole track. */
  partOf: string | null;
};

export type RelinkConfidence = "sure" | "likely" | "name";
/** Why a file was taken for a track: the same content (quick checksum), the same name, the same sound (length and loudness). */
export type RelinkReason = "content" | "name" | "sound";

export type RelinkMatch = { trackId: string; from: string; to: string; confidence: RelinkConfidence; reasons: RelinkReason[]; size?: number; mtimeMs?: number; checksum?: string };

/** 0.5.2 item 14: a file's length (its tags) and loudness (ffmpeg's measure), for matching by sound. */
export interface SoundProbe {
  durationMs(file: string): Promise<number | null>;
  /** Absent: loudness cannot be measured here, so nothing matches by sound. */
  lufs?(file: string): Promise<number | null>;
}

/**
 * How Lyre looks at files on the computer. The real one reads the disk; a test build of the sample library stands in
 * for the prototype's computer (src/main/lyreApi/sampleComputer.ts), whose files are not on the test machine.
 */
export interface FileProbe {
  exists(filePath: string): Promise<boolean>;
  facts(filePath: string): Promise<ReadFacts>;
  /** Every audio file under the folder and its folders, full paths. */
  audioFilesUnder(folder: string, options?: { signal?: AbortSignal }): Promise<string[]>;
}

export const diskProbe: FileProbe = {
  exists: fileExists,
  facts: readFileFacts,
  audioFilesUnder: async (folder, options = {}) => (await collectAudioFiles([folder], options)).files.map((f) => f.path),
};

export type RelinkPlan = {
  matches: RelinkMatch[];
  /** Missing tracks with several equally good files: the screen asks which (reasons: why each, in the same order). */
  ambiguous: { trackId: string; candidates: string[]; reasons: RelinkReason[][] }[];
  notFound: string[];
  summary: string;
};

/** Tracks whose files are not where the library expects them, in the order of their shown names. Web addresses are not checked. */
export async function findMissingTracks(store: Store, options: { concurrency?: number; probe?: FileProbe } = {}): Promise<MissingTrack[]> {
  const probe = options.probe ?? diskProbe;
  const roots = new Map(listRoots(store).map((root) => [root.id, root.path]));
  const rows = store.all<{ id: string; title: string; root_id: string | null; path: string; file_name: string; file_size: number | null; checksum: string | null; duration_ms: number | null; lufs: number | null; part_of: string | null }>(
    `SELECT id, ${SHOWN_TITLE_SQL} AS title, root_id, path, file_name, file_size, checksum, duration_ms, part_of,
       (SELECT lufs FROM track_loudness WHERE track_id = tracks.id) AS lufs
     FROM tracks WHERE path IS NOT NULL ORDER BY ${SHOWN_TITLE_SQL} COLLATE NOCASE, id`,
  );
  const checked = await mapLimit(rows, options.concurrency ?? 16, async (row) => {
    const full = row.root_id === null ? row.path : joinRoot(roots.get(row.root_id) as string, row.path);
    return (await probe.exists(full))
      ? null
      : { id: row.id, title: row.title, path: full, fileName: row.file_name, size: row.file_size, checksum: row.checksum, durationMs: row.duration_ms, lufs: row.lufs, partOf: row.part_of };
  });
  return checked.filter((entry): entry is MissingTrack => entry !== null);
}

/** How many folder names at the end of two paths agree (the file name included), letter case ignored. */
function sharedTail(a: string, b: string): number {
  const split = (p: string) => p.toLowerCase().split(/[\\/]+/).reverse();
  const [x, y] = [split(a), split(b)];
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}

const RANK: Record<RelinkConfidence, number> = { sure: 3, likely: 2, name: 1 };
/** Length within this much (or 1 % of a long track), and loudness within this many LU, sound the same. */
const SAME_LENGTH_MS = 1000;
const SAME_LOUDNESS_LU = 1;

type Judged = { file: string; confidence: RelinkConfidence; reasons: RelinkReason[] };

/** Looks for the missing tracks' files under `folder`. Nothing is changed until applyRelink. */
export async function planRelink(
  store: Store,
  missing: MissingTrack[],
  folder: string,
  options: { signal?: AbortSignal; probe?: FileProbe; sound?: SoundProbe } = {},
): Promise<RelinkPlan> {
  const probe = options.probe ?? diskProbe;
  const sound = options.sound;
  const known = locationsInLibrary(store);
  const files = (await probe.audioFilesUnder(folder, { signal: options.signal })).filter((p) => !known.has(fileKey(p)));
  const byName = new Map<string, string[]>();
  for (const file of files) {
    const name = baseName(file).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
  /** Each file is read at most once, whichever tracks ask. */
  const once = <T>(read: (file: string) => Promise<T>) => {
    const cache = new Map<string, Promise<T | null>>();
    return (file: string) => {
      if (!cache.has(file)) cache.set(file, read(file).catch((): null => null));
      return cache.get(file) as Promise<T | null>;
    };
  };
  const factsOf = once((file) => probe.facts(file));
  const lengthOf = once((file) => (sound ? sound.durationMs(file) : Promise.resolve(null)));
  const loudnessOf = once((file) => (sound?.lufs ? sound.lufs(file) : Promise.resolve(null)));

  /** The same length and loudness as Lyre measured the track; loudness is measured only when the length fits. */
  const soundsTheSame = async (track: MissingTrack, file: string): Promise<boolean> => {
    if (!sound?.lufs || track.durationMs === null || track.lufs === null) return false;
    const length = await lengthOf(file);
    if (length === null || Math.abs(length - track.durationMs) > Math.max(SAME_LENGTH_MS, track.durationMs * 0.01)) return false;
    const lufs = await loudnessOf(file);
    return lufs !== null && Math.abs(lufs - track.lufs) <= SAME_LOUDNESS_LU;
  };

  /** How sure a candidate is for `track` and why, or null when it is a different file. */
  const judge = async (track: MissingTrack, file: string, sameName: boolean): Promise<Judged | null> => {
    const found = track.size === null && track.checksum === null ? null : await factsOf(file);
    const sizeKnown = track.size !== null && found !== null;
    const sameSize = sizeKnown && found.size === track.size;
    const sameContent = track.checksum !== null && found !== null && sameSize && found.checksum === track.checksum;
    const reasons: RelinkReason[] = [];
    if (sameContent) reasons.push("content");
    if (sameName) reasons.push("name");
    // Sound is asked only where it can change the answer: not for the same content.
    if (!sameContent && (await soundsTheSame(track, file))) reasons.push("sound");
    const bySound = reasons.includes("sound");
    if (sameContent) return { file, confidence: "sure", reasons };
    if (sameName && bySound) return { file, confidence: "likely", reasons };
    if (sameName && sameSize && track.checksum === null) return { file, confidence: "likely", reasons };
    // The same name with another size may be a re-encoded copy: offered for the game master to check, never ticked.
    if (sameName && (!sizeKnown || !sameSize)) return { file, confidence: "name", reasons };
    // Renamed and re-encoded: only its sound says so; offered to check.
    if (bySound) return { file, confidence: "name", reasons };
    return null;
  };
  const judgeAll = async (track: MissingTrack, list: string[], sameName: boolean) =>
    (await mapLimit(list, 8, (file) => judge(track, file, sameName))).filter((c): c is Judged => c !== null);

  const used = new Set<string>();
  const plan: RelinkPlan = { matches: [], ambiguous: [], notFound: [], summary: "" };
  // Review I1: a whole track and its parts share one file, so one of them (the whole when it is missing too) is
  // looked for, and the others of that file get the same answer: the same match, the same choice, or not found.
  const sharers = new Map<string, MissingTrack[]>();
  for (const track of missing) {
    const key = fileKey(track.path);
    const list = sharers.get(key);
    if (list) list.push(track);
    else sharers.set(key, [track]);
  }
  const leaders: MissingTrack[] = [];
  const followers = new Map<string, MissingTrack[]>();
  for (const list of sharers.values()) {
    const leader = list.find((m) => !m.partOf) ?? list[0];
    leaders.push(leader);
    followers.set(leader.id, list.filter((m) => m !== leader));
  }
  const alsoFor = (leader: MissingTrack) => followers.get(leader.id) ?? [];
  for (const track of missing) {
    if (!leaders.includes(track)) continue;
    const sameName = (byName.get(track.fileName.toLowerCase()) ?? []).filter((file) => !used.has(file));
    let scored = await judgeAll(track, sameName, true);
    // Renamed: the same content, or the same sound, under another name. Each file is read once per folder.
    const canFindRenamed = (track.size !== null && track.checksum !== null) || (sound?.lufs && track.durationMs !== null && track.lufs !== null);
    if (canFindRenamed && !scored.some((c) => c.confidence === "sure")) {
      const others = files.filter((file) => !used.has(file) && baseName(file).toLowerCase() !== track.fileName.toLowerCase());
      scored = [...scored, ...(await judgeAll(track, others, false))];
    }
    if (scored.length === 0) {
      plan.notFound.push(track.id, ...alsoFor(track).map((m) => m.id));
      continue;
    }
    // Ranked: how sure, then how many reasons, then how closely its folders match the old path.
    const score = (c: Judged) => RANK[c.confidence] * 100 + c.reasons.length * 10 + Math.min(9, sharedTail(c.file, track.path));
    const bestScore = Math.max(...scored.map(score));
    const top = scored.filter((c) => score(c) === bestScore);
    if (top.length > 1) {
      const sorted = [...top].sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
      for (const one of [track, ...alsoFor(track)]) plan.ambiguous.push({ trackId: one.id, candidates: sorted.map((c) => c.file), reasons: sorted.map((c) => c.reasons) });
      continue;
    }
    const chosen = top[0];
    used.add(chosen.file);
    const found = await factsOf(chosen.file);
    for (const one of [track, ...alsoFor(track)]) {
      plan.matches.push({
        trackId: one.id,
        from: one.path,
        to: chosen.file,
        confidence: chosen.confidence,
        reasons: chosen.reasons,
        ...(found ? { size: found.size, mtimeMs: found.mtimeMs, checksum: found.checksum } : {}),
      });
    }
  }
  const parts = [`Found ${plan.matches.length} of ${plural(missing.length, "missing file")}.`];
  if (plan.notFound.length > 0) parts.push(`${plan.notFound.length} ${plan.notFound.length === 1 ? "was" : "were"} not found in that folder.`);
  if (plan.ambiguous.length > 0) {
    parts.push(`${plan.ambiguous.length} ${plan.ambiguous.length === 1 ? "has" : "have"} more than one possible file: choose which.`);
  }
  plan.summary = parts.join(" ");
  return plan;
}

/**
 * Points each track at its new file, as one undo step, in batches when there
 * are many (DB review 1: one transaction took about 65 ms per 1,000 tracks);
 * await the result. The game master confirms the matches first.
 */
export function applyRelink(store: Store, matches: Pick<RelinkMatch, "trackId" | "to" | "size" | "mtimeMs" | "checksum">[]): Promise<void> {
  if (!Array.isArray(matches)) throw new ValidationError("matches", "matches must be a list.");
  // Each new file is looked up through the unique path indexes (DB review 4), not by reading every track.
  const roots = listRoots(store);
  // Review I1: a file belongs to a whole track and its parts together. A track's "file group" is its whole's id.
  const groupOf = (trackId: string): string => store.get<{ part_of: string | null }>("SELECT part_of FROM tracks WHERE id = ?", trackId)?.part_of ?? trackId;
  const taken = new Map<string, string>();
  for (const match of matches) {
    const trackId = v.id("trackId", match.trackId);
    const to = v.requiredName("to", match.to, v.MAX_TEXT_LENGTH);
    const key = fileKey(to);
    const group = groupOf(trackId);
    const owner = taken.get(key) ?? findTrackByLocation(store, { file: to }, roots) ?? undefined;
    if (owner !== undefined && groupOf(owner) !== group) {
      throw new ValidationError("to", `Another track in your library already has ${baseName(match.to)}.`);
    }
    taken.set(key, group);
  }
  // The other tracks of a relinked track's old file (a whole and its parts) move with it, unless a match names them.
  const named = new Set(matches.map((m) => m.trackId));
  const moves = matches.flatMap((match) => {
    const file = { path: match.to, size: match.size ?? null, mtimeMs: match.mtimeMs ?? null, checksum: match.checksum ?? null };
    const group = groupOf(match.trackId);
    const along = store
      .all<{ id: string }>(
        `SELECT t.id FROM tracks t JOIN tracks me ON me.id = ?
         WHERE t.id <> me.id AND (t.id = ? OR t.part_of = ?) AND t.root_id IS me.root_id AND t.path = me.path COLLATE NOCASE`,
        match.trackId,
        group,
        group,
      )
      .filter((row) => !named.has(row.id));
    along.forEach((row) => named.add(row.id));
    return [{ trackId: match.trackId, file }, ...along.map((row) => ({ trackId: row.id, file }))];
  });
  return relocateTracks(store, `Relink ${plural(matches.length, "file")}`, moves);
}

