import { describe, expect, it } from "vitest";

import { RateLimit } from "./rateLimit";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("RateLimit (SEC-4)", () => {
  it("allows up to the limit in a window, then refuses and says when to try again", () => {
    const time = clock();
    const limit = new RateLimit({ limit: 3, windowMs: 1000, now: time.now });
    expect([limit.hit("a"), limit.hit("a"), limit.hit("a")].every((answer) => answer.allowed)).toBe(true);
    time.advance(400);
    expect(limit.hit("a")).toEqual({ allowed: false, retryAfterMs: 600 });
  });

  it("counts each caller separately", () => {
    const limit = new RateLimit({ limit: 1, windowMs: 1000, now: clock().now });
    expect(limit.hit("a").allowed).toBe(true);
    expect(limit.hit("b").allowed).toBe(true);
    expect(limit.hit("a").allowed).toBe(false);
  });

  it("forgets hits older than the window", () => {
    const time = clock();
    const limit = new RateLimit({ limit: 2, windowMs: 1000, now: time.now });
    limit.hit("a");
    time.advance(600);
    limit.hit("a");
    time.advance(500);
    expect(limit.hit("a").allowed).toBe(true);
    expect(limit.hit("a").allowed).toBe(false);
  });

  it("can count without spending (checking a caller already locked out)", () => {
    const limit = new RateLimit({ limit: 1, windowMs: 1000, now: clock().now });
    expect(limit.check("a").allowed).toBe(true);
    limit.hit("a");
    expect(limit.check("a").allowed).toBe(false);
  });

  it("keeps at most maxCallers callers, forgetting the oldest, so it cannot fill memory", () => {
    const limit = new RateLimit({ limit: 1, windowMs: 60_000, now: clock().now, maxCallers: 100 });
    for (let i = 0; i < 1000; i++) limit.hit(`caller-${i}`);
    expect(limit.callerCount()).toBe(100);
    expect(limit.hit("caller-0").allowed).toBe(true);
  });
});
