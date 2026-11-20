/**
 * Round 9 (Split into parts, r10-tracks): the checks the library and its fake both make before splitting a track, so
 * a refusal reads the same in both.
 */
import type { SplitRequest } from "./api";

/** Delete file from disk… keeps a part, and a track with parts: the file plays for the others too. */
export const SHARED_FILE = "Its file is shared with its parts or the track it is part of. Remove it from the library instead.";

/** Why a split cannot be made, in the game master's words; null when it can. `durationMs`: the whole file's length. */
export function splitProblem(request: SplitRequest, durationMs: number): string | null {
  const parts = request.parts;
  if (parts.length < 2) return "Tick at least one marker to split it at.";
  let end = 0;
  for (const p of parts) {
    if (!p.name.trim()) return "Each part needs a name.";
    if (p.startMs < end || p.endMs <= p.startMs || p.endMs > durationMs) return "The parts must follow one another inside the track.";
    end = p.endMs;
  }
  return null;
}

/** The profile a part starts with: Start, End and Loop start at its cut, and the whole's markers inside it. */
export function partProfile(part: { startMs: number; endMs: number }, markers: readonly { atMs: number; label: string; mix?: boolean }[] = []) {
  return {
    startMs: part.startMs,
    endMs: part.endMs,
    loopStartMs: part.startMs,
    markers: markers.filter((m) => m.atMs > part.startMs && m.atMs < part.endMs).map((m) => ({ ...m })),
  };
}
