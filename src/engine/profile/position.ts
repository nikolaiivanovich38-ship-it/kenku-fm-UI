import type { AudioProfile } from "../../common/domain";

/**
 * Where a track would be now if it had kept playing `elapsedSeconds` from
 * `fromSeconds` (for Undo, which brings a scene's music back where it would
 * be). A loop wraps back to Loop start; anything else stays a second before
 * End, as the prototype does, so it is heard ending rather than skipped.
 */
export function positionAfter(profile: AudioProfile, fromSeconds: number, elapsedSeconds: number): number {
  const end = profile.endMs / 1000;
  const at = fromSeconds + Math.max(0, elapsedSeconds);
  if (at < end) {
    return at;
  }
  if (profile.after === "loop") {
    const loopFrom = profile.loopStartMs / 1000;
    const span = end - loopFrom;
    return span > 0 ? loopFrom + ((at - end) % span) : loopFrom;
  }
  return Math.max(profile.startMs / 1000, end - 1);
}
