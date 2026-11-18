/**
 * 46 (Nik's play test, 14 Nov): "Make sure that random/shuffle is properly random." shuffledOrder is a Fisher–Yates
 * shuffle driven by a seeded generator (the same seed gives the same order, so Up next and Live's lists agree with what
 * plays), and the seeds come from the browser's cryptographic random numbers (cryptoRandom). Every order must be
 * equally likely: a chi-squared test over many seeds, and each track equally likely in each place.
 */
import { describe, expect, it, vi } from "vitest";

import { cryptoRandom, shuffledOrder } from "./round5";

/** The chi-squared statistic of counts against an even spread. */
function chiSquared(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
}

describe("46: shuffles are properly random", () => {
  it("every order of five tracks is equally likely (120 orders, 60,000 deals, chi-squared under the 0.1% limit)", () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 60_000; seed++) {
      const key = shuffledOrder(["a", "b", "c", "d", "e"], seed * 2654435761).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(120);
    // 119 degrees of freedom: 173.6 is exceeded by chance one time in a thousand.
    expect(chiSquared([...counts.values()])).toBeLessThan(173.6);
  });

  it("each of ten tracks is equally likely in each place, with seeds from the cryptographic source", () => {
    const tracks = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const at = tracks.map(() => tracks.map(() => 0));
    for (let n = 0; n < 20_000; n++) {
      const order = shuffledOrder(tracks, Math.floor(cryptoRandom() * 2 ** 32));
      order.forEach((t, place) => at[place][tracks.indexOf(t)]++);
    }
    // 9 degrees of freedom per place: 27.9 is exceeded by chance one time in a thousand; ten places, so allow 33.7 (1 in 100,000).
    for (const place of at) expect(chiSquared(place)).toBeLessThan(33.7);
  });

  it("the same seed gives the same order (so Up next agrees with what plays), and a deal keeps every track once", () => {
    const tracks = ["a", "b", "c", "d", "e", "f"];
    expect(shuffledOrder(tracks, 42)).toEqual(shuffledOrder(tracks, 42));
    expect([...shuffledOrder(tracks, 42)].sort()).toEqual(tracks);
    expect(tracks).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("cryptoRandom uses the browser's cryptographic random numbers, from 0 up to (not including) 1", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const values = Array.from({ length: 1000 }, () => cryptoRandom());
    expect(spy).toHaveBeenCalled();
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    spy.mockRestore();
  });
});
