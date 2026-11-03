import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./popupRateLimiter";

describe("createRateLimiter (SEC-6 popups)", () => {
  it("allows up to the limit within the window, then refuses", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 3, windowMs: 10_000, now: () => now });
    expect(limiter.tryAcquire(1)).toBe(true);
    now = 1000;
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(false);
    now = 9_999;
    expect(limiter.tryAcquire(1)).toBe(false);
  });

  it("frees a slot once the oldest attempt leaves the window", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 3, windowMs: 10_000, now: () => now });
    limiter.tryAcquire(1);
    now = 5_000;
    limiter.tryAcquire(1);
    limiter.tryAcquire(1);
    now = 10_000;
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(false);
  });

  it("counts each key separately", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000, now: () => 0 });
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(false);
  });

  it("does not count refused attempts against the window", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    limiter.tryAcquire(1);
    now = 900;
    expect(limiter.tryAcquire(1)).toBe(false);
    now = 1_000;
    expect(limiter.tryAcquire(1)).toBe(true);
  });

  it("forgets a key", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000, now: () => 0 });
    limiter.tryAcquire(1);
    limiter.forget(1);
    expect(limiter.tryAcquire(1)).toBe(true);
  });
});
