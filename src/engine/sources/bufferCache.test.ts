import { describe, expect, it, vi } from "vitest";

import { FakeBuffer } from "../testing/fakeAudio";
import { BufferCache, decodedBytes } from "./bufferCache";

/** A stereo buffer of `mb` megabytes once decoded (4 bytes per sample per channel). */
const ofMegabytes = (mb: number) => new FakeBuffer((mb * 1_000_000) / (2 * 4 * 1000), 2, 1000);
const MB = 1_000_000;

describe("BufferCache (PERF-7)", () => {
  it("counts decoded memory as samples x channels x 4 bytes", () => {
    expect(decodedBytes(new FakeBuffer(10, 2, 48_000))).toBe(10 * 48_000 * 2 * 4);
  });

  it("returns what was stored and counts its memory", () => {
    const cache = new BufferCache({ capBytes: 10 * MB });
    const buffer = ofMegabytes(2);
    cache.store("a", buffer).release();
    const lease = cache.lease("a");
    expect(lease?.buffer).toBe(buffer);
    expect(cache.usedBytes).toBe(2 * MB);
    expect(cache.lease("missing")).toBeUndefined();
  });

  it("evicts the least recently used buffers once over its memory cap", () => {
    const cache = new BufferCache({ capBytes: 5 * MB });
    cache.store("a", ofMegabytes(2)).release();
    cache.store("b", ofMegabytes(2)).release();
    cache.lease("a")!.release(); // "a" is now more recent than "b"
    cache.store("c", ofMegabytes(2)).release();
    expect(cache.keys()).toEqual(["a", "c"]);
    expect(cache.usedBytes).toBe(4 * MB);
  });

  it("never evicts a buffer that is playing; it goes once released if still over the cap", () => {
    const cache = new BufferCache({ capBytes: 3 * MB });
    const playing = cache.store("a", ofMegabytes(2));
    cache.store("b", ofMegabytes(2)).release();
    expect(cache.keys()).toEqual(["a"]);
    const second = cache.store("c", ofMegabytes(2));
    expect(cache.keys()).toEqual(["a", "c"]); // over the cap while both play
    playing.release();
    expect(cache.keys()).toEqual(["c"]);
    second.release();
    expect(cache.usedBytes).toBe(2 * MB);
  });

  it("does not keep a buffer larger than the whole cap, but still lends it out", () => {
    const cache = new BufferCache({ capBytes: 1 * MB });
    const lease = cache.store("big", ofMegabytes(3));
    expect(lease.buffer).toBeDefined();
    lease.release();
    expect(cache.keys()).toEqual([]);
    expect(cache.usedBytes).toBe(0);
  });

  it("releasing a lease twice counts once", () => {
    const cache = new BufferCache({ capBytes: 3 * MB });
    const a = cache.store("a", ofMegabytes(2));
    const again = cache.lease("a")!;
    a.release();
    a.release();
    cache.store("b", ofMegabytes(2)).release();
    // "a" is still leased by `again`, so it stays.
    expect(cache.keys()).toContain("a");
    again.release();
  });

  it("load() decodes once even when asked twice at the same time", async () => {
    const cache = new BufferCache({ capBytes: 10 * MB });
    const decode = vi.fn(async () => ofMegabytes(1));
    const [x, y] = await Promise.all([cache.load("a", decode), cache.load("a", decode)]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(x.buffer).toBe(y.buffer);
  });

  it("load() passes a failure on and does not remember it", async () => {
    const cache = new BufferCache({ capBytes: 10 * MB });
    await expect(cache.load("a", async () => Promise.reject(new Error("bad file")))).rejects.toThrow("bad file");
    const lease = await cache.load("a", async () => ofMegabytes(1));
    expect(lease.buffer).toBeDefined();
  });

  it("storing again over a buffer that is playing leaves the new copy free to go once released (review 8)", () => {
    const cache = new BufferCache({ capBytes: 10 * MB });
    const oldLease = cache.store("a", ofMegabytes(1));
    const newLease = cache.store("a", ofMegabytes(1));
    oldLease.release();
    newLease.release();
    // Before: the new copy inherited the old copy's lease, which the old
    // release() never gave back, so it stayed "playing" for ever.
    cache.clear();
    expect(cache.keys()).toEqual([]);
    expect(cache.usedBytes).toBe(0);
  });

  it("clear() drops everything not playing", () => {
    const cache = new BufferCache({ capBytes: 10 * MB });
    const playing = cache.store("a", ofMegabytes(1));
    cache.store("b", ofMegabytes(1)).release();
    cache.clear();
    expect(cache.keys()).toEqual(["a"]);
    playing.release();
  });
});
