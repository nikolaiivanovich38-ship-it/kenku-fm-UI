/**
 * DAT-8: tracks whose files have gone (moved, renamed, a drive letter
 * changed), and pointing them at their new place in bulk.
 *
 * The game master chooses a folder; Lyre looks there (with subfolders) for
 * each missing file:
 * - "sure": same name, size and quick checksum, or a renamed file with the
 *   same size and checksum;
 * - "likely": same name and size (the library knew no checksum);
 * - "name": same name only (the library knew neither, as for files moved in
 *   from the old player that were already missing then). The screen asks.
 * Among several candidates, the one whose folders match the old path most
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
};

export type RelinkConfidence = "sure" | "likely" | "name";

export type RelinkMatch = { trackId: string; from: string; to: string; confidence: RelinkConfidence; size?: number; mtimeMs?: number; checksum?: string };

export type RelinkPlan = {
  matches: RelinkMatch[];
  /** Missing tracks with several equally good files: the screen asks which. */
  ambiguous: { trackId: string; candidates: string[] }[];
  notFound: string[];
  summary: string;
};

/** Tracks whose files are not where the library expects them, in the order of their shown names. Web addresses are not checked. */
export async function findMissingTracks(store: Store, options: { concurrency?: number } = {}): Promise<MissingTrack[]> {
  const roots = new Map(listRoots(store).map((root) => [root.id, root.path]));
  const rows = store.all<{ id: string; title: string; root_id: string | null; path: string; file_name: string; file_size: number | null; checksum: string | null }>(
    `SELECT id, ${SHOWN_TITLE_SQL} AS title, root_id, path, file_name, file_size, checksum FROM tracks
     WHERE path IS NOT NULL ORDER BY ${SHOWN_TITLE_SQL} COLLATE NOCASE, id`,
  );
  const checked = await mapLimit(rows, options.concurrency ?? 16, async (row) => {
    const full = row.root_id === null ? row.path : joinRoot(roots.get(row.root_id) as string, row.path);
    return (await fileExists(full))
      ? null
      : { id: row.id, title: row.title, path: full, fileName: row.file_name, size: row.file_size, checksum: row.checksum };
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

/** Looks for the missing tracks' files under `folder`. Nothing is changed until applyRelink. */
export async function planRelink(store: Store, missing: MissingTrack[], folder: string, options: { signal?: AbortSignal } = {}): Promise<RelinkPlan> {
  const known = locationsInLibrary(store);
  const files = (await collectAudioFiles([folder], options)).files.map((f) => f.path).filter((p) => !known.has(fileKey(p)));
  const byName = new Map<string, string[]>();
  for (const file of files) {
    const name = baseName(file).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
  const facts = new Map<string, Promise<ReadFacts | null>>();
  const factsOf = (file: string) => {
    if (!facts.has(file)) facts.set(file, readFileFacts(file).catch((): null => null));
    return facts.get(file) as Promise<ReadFacts | null>;
  };

  /** How sure a candidate is for `track`, or null when it is a different file. */
  const judge = async (track: MissingTrack, file: string, sameName: boolean): Promise<RelinkConfidence | null> => {
    if (track.size === null && track.checksum === null) return sameName ? "name" : null;
    const found = await factsOf(file);
    if (!found || (track.size !== null && found.size !== track.size)) return null;
    if (track.checksum !== null) return found.checksum === track.checksum ? "sure" : null;
    return sameName ? "likely" : null;
  };

  const used = new Set<string>();
  const plan: RelinkPlan = { matches: [], ambiguous: [], notFound: [], summary: "" };
  for (const track of missing) {
    const sameName = (byName.get(track.fileName.toLowerCase()) ?? []).filter((file) => !used.has(file));
    let scored = (await Promise.all(sameName.map(async (file) => ({ file, confidence: await judge(track, file, true) })))).filter(
      (c): c is { file: string; confidence: RelinkConfidence } => c.confidence !== null,
    );
    if (scored.length === 0 && track.size !== null && track.checksum !== null) {
      // Renamed: same size and content under another name. Sizes are read once per folder.
      const others = files.filter((file) => !used.has(file));
      scored = (await Promise.all(others.map(async (file) => ({ file, confidence: await judge(track, file, false) })))).filter(
        (c): c is { file: string; confidence: RelinkConfidence } => c.confidence !== null,
      );
    }
    if (scored.length === 0) {
      plan.notFound.push(track.id);
      continue;
    }
    const bestRank = Math.max(...scored.map((c) => RANK[c.confidence]));
    const best = scored.filter((c) => RANK[c.confidence] === bestRank);
    const closest = Math.max(...best.map((c) => sharedTail(c.file, track.path)));
    const top = best.filter((c) => sharedTail(c.file, track.path) === closest);
    if (top.length > 1) {
      plan.ambiguous.push({ trackId: track.id, candidates: top.map((c) => c.file).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) });
      continue;
    }
    const chosen = top[0];
    used.add(chosen.file);
    const found = await factsOf(chosen.file);
    plan.matches.push({
      trackId: track.id,
      from: track.path,
      to: chosen.file,
      confidence: chosen.confidence,
      ...(found ? { size: found.size, mtimeMs: found.mtimeMs, checksum: found.checksum } : {}),
    });
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
  const taken = new Map<string, string>();
  for (const match of matches) {
    const trackId = v.id("trackId", match.trackId);
    const to = v.requiredName("to", match.to, v.MAX_TEXT_LENGTH);
    const key = fileKey(to);
    const owner = taken.get(key) ?? findTrackByLocation(store, { file: to }, roots) ?? undefined;
    if (owner !== undefined && owner !== trackId) {
      throw new ValidationError("to", `Another track in your library already has ${baseName(match.to)}.`);
    }
    taken.set(key, trackId);
  }
  return relocateTracks(
    store,
    `Relink ${plural(matches.length, "file")}`,
    matches.map((match) => ({
      trackId: match.trackId,
      file: { path: match.to, size: match.size ?? null, mtimeMs: match.mtimeMs ?? null, checksum: match.checksum ?? null },
    })),
  );
}

