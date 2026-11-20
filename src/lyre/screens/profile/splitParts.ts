/**
 * Round 9 (ROUND9.md §10, item 8: "Split tracks into multiple at split points in audio profile using markers"): the
 * parts a track's markers cut it into (r9track.js parts). Each marker inside the track is a split point the game master
 * can untick; a part runs from one ticked point to the next, the first from the file's start, the last to its end.
 * Each part is named after the marker that starts it ("Bridge of Death – choir enters"), the first "– opening".
 */
export interface SplitPoint {
  atMs: number;
  label: string;
  on: boolean;
}
export interface PartPlan {
  name: string;
  startMs: number;
  endMs: number;
}

/** The markers strictly inside the track, in time order, each ticked. */
export function splitPoints(markers: readonly { atMs: number; label: string }[], durationMs: number): SplitPoint[] {
  return markers
    .filter((m) => m.atMs > 0 && m.atMs < durationMs)
    .slice()
    .sort((a, b) => a.atMs - b.atMs)
    .map((m) => ({ atMs: m.atMs, label: m.label, on: true }));
}

/** The parts the ticked points make; `names` are the names typed, by part number (0 first). */
export function partsOf(points: readonly SplitPoint[], durationMs: number, base: string, names: Readonly<Record<number, string>> = {}): PartPlan[] {
  const out: PartPlan[] = [];
  let from = 0;
  let label = "opening";
  for (const p of points.filter((x) => x.on)) {
    out.push({ name: names[out.length] ?? `${base} – ${label}`, startMs: from, endMs: p.atMs });
    from = p.atMs;
    label = (p.label || "part").toLowerCase();
  }
  out.push({ name: names[out.length] ?? `${base} – ${label}`, startMs: from, endMs: durationMs });
  return out;
}
