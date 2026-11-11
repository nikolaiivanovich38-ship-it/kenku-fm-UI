/**
 * PLY-4 "Pick up where it stopped": where each such track was last stopped, shared by every room. The lead's
 * decision (b6 notes, w7-contracts question 2): it is remembered across restarts, so a long underscore picks up
 * where it stopped last session too. Kept on this computer (like the preview's device), not in the library.
 */
const KEY = "lyre-resume-positions";
/** More than this many tracks: the oldest positions are dropped (a game master's library has a few dozen). */
const KEEP = 500;

/** A Map of seconds by track id that saves itself to `storage` on every change; unreadable entries are ignored. */
export function storedResumePositions(storage: Pick<Storage, "getItem" | "setItem">, key = KEY): Map<string, number> {
  const positions = new Map<string, number>();
  try {
    const saved: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (saved && typeof saved === "object") {
      for (const [id, at] of Object.entries(saved as Record<string, unknown>)) if (typeof at === "number" && Number.isFinite(at) && at >= 0) positions.set(id, at);
    }
  } catch {
    /* unreadable: start with none */
  }
  const persist = () => {
    try {
      const entries = [...positions.entries()].slice(-KEEP);
      storage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* storage full or refused: the positions last for this evening only */
    }
  };
  const set = positions.set.bind(positions);
  const remove = positions.delete.bind(positions);
  positions.set = (id: string, at: number) => {
    remove(id); // the newest last, so the oldest go first when there are too many
    set(id, at);
    persist();
    return positions;
  };
  positions.delete = (id: string) => {
    const had = remove(id);
    if (had) persist();
    return had;
  };
  return positions;
}
