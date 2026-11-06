/**
 * DAT-13: the loudness the prototype makes up for a track (design/prototype/src/core.js curveKind, L.levels), so the
 * sample library suggests the same shapes as the approved design ("Peaks then falls" for t02, "Builds" for the long
 * builds). The in-memory LyreApi answers these as a track's peaks, and test builds seed them into the real library;
 * a game master's library always works its peaks out from the files.
 */
import type { DomainTrack } from "../domain";

/** How many points the library keeps across a file (PEAK_POINTS in src/main/data/repo/peaks.ts). */
const POINTS = 1000;

type LevelTrack = Pick<DomainTrack, "id" | "title" | "kind" | "profile"> & { notes?: string };

/** core.js seeded(): a small random number generator started from a string, the same numbers each time. */
function seeded(text: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) {
    a ^= text.charCodeAt(i);
    a = Math.imul(a, 16777619);
  }
  return () => {
    a = Math.imul(a ^ (a >>> 15), 2246822507);
    a = Math.imul(a ^ (a >>> 13), 3266489909);
    a ^= a >>> 16;
    return (a >>> 0) / 4294967296;
  };
}

/** core.js curveKind(): from words in the title that say how it moves, else from its id. */
function curveKind(t: LevelTrack): string {
  const words = `${t.title} ${t.notes ?? ""}`.toLowerCase();
  if (t.profile?.markers?.some((m) => /peak/i.test(m.label))) return "peaksThenFalls";
  if (/build|rising|rises|ends huge|slow-burn|swells/.test(words)) return "builds";
  if (/\bfade\b|resolves|release after|dies away/.test(words)) return "fallsAway";
  if (/loops well|great loop|\(loops\)|steady|crowd|ostinato|never lets up/.test(words) || t.kind === "amb") return "steady";
  return ["steady", "builds", "peaksThenFalls", "risesAndFalls", "fallsAway", "steady"][Math.floor(seeded(t.id)() * 6)];
}

/** core.js L.levels(): 48 levels from 0.05 to 1. */
function prototypeCurve(t: LevelTrack): number[] {
  const kind = curveKind(t);
  const random = seeded(`${t.id}:lv`);
  const out: number[] = [];
  for (let i = 0; i < 48; i++) {
    const x = i / 47;
    const v =
      kind === "builds"
        ? 0.28 + 0.62 * Math.pow(x, 1.4)
        : kind === "fallsAway"
          ? 0.88 - 0.58 * Math.pow(x, 0.8)
          : kind === "peaksThenFalls"
            ? 0.3 + 0.6 * Math.sin(Math.PI * Math.pow(x, 0.85))
            : kind === "risesAndFalls"
              ? 0.52 + 0.3 * Math.sin(Math.PI * 4 * x)
              : 0.6 + 0.04 * Math.sin(x * 9);
    out.push(Math.max(0.05, Math.min(1, v + (random() - 0.5) * 0.08)));
  }
  return out;
}

/** The prototype's levels across the file at the library's density (core.js L.levelAt), rounded to three places. */
export function prototypeLevels(t: LevelTrack): number[] {
  const curve = prototypeCurve(t);
  return Array.from({ length: POINTS }, (_, i) => {
    const f = (i / (POINTS - 1)) * (curve.length - 1);
    const lo = Math.floor(f);
    const hi = Math.min(curve.length - 1, lo + 1);
    return Math.round((curve[lo] + (curve[hi] - curve[lo]) * (f - lo)) * 1000) / 1000;
  });
}
