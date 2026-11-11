/**
 * A repeatable random number source for tests (mulberry32). The engine takes
 * its randomness as a function so shuffle tests can name exact orders.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A "random" source that always picks the first candidate, so shuffled orders are predictable. */
export const firstChoice = (): number => 0;
