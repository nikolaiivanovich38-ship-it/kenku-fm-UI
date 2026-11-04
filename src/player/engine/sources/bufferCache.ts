/**
 * PERF-7: decoded audio kept in memory for short effects and gapless loops,
 * with a memory cap. Decoded audio is large (about 23 MB per stereo minute at
 * 48 kHz), so the cache counts decoded bytes and, once over its cap, drops
 * the least recently used buffers first.
 *
 * A buffer that is playing is "leased" and never dropped; the cache may go
 * over its cap while leased buffers play, and settles back once they are
 * released. A buffer bigger than the whole cap is lent out but not kept.
 *
 * PLY-11 will share one memory budget between this cache and read-ahead of
 * streamed tracks; `capBytes` is that budget's share for decoded audio.
 */
import type { BufferLike } from "../audio/types";

export interface BufferLease {
  readonly buffer: BufferLike;
  /** Give the buffer back. Safe to call more than once. */
  release(): void;
}

interface Entry {
  buffer: BufferLike;
  bytes: number;
  leases: number;
}

/** Memory a decoded buffer takes: 32-bit float samples per channel. */
export function decodedBytes(buffer: BufferLike): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

export class BufferCache {
  /** Map order is recency: the first key is the least recently used. */
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<BufferLike>>();
  private readonly capBytes: number;
  usedBytes = 0;

  constructor({ capBytes }: { capBytes: number }) {
    this.capBytes = capBytes;
  }

  /** Keys from least to most recently used. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Borrow a cached buffer, marking it as just used. */
  lease(key: string): BufferLease | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return this.lend(key, entry);
  }

  /** Keep a newly decoded buffer (if it fits under the cap at all) and borrow it. */
  store(key: string, buffer: BufferLike): BufferLease {
    const bytes = decodedBytes(buffer);
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.usedBytes -= existing.bytes;
    }
    const entry: Entry = { buffer, bytes, leases: existing?.leases ?? 0 };
    if (bytes > this.capBytes) {
      return { buffer, release: () => undefined };
    }
    this.entries.set(key, entry);
    this.usedBytes += bytes;
    const lease = this.lend(key, entry);
    this.evict();
    return lease;
  }

  /** Borrow `key`, decoding it with `decode` if it is not cached; one decode at a time per key. */
  async load(key: string, decode: () => Promise<BufferLike>): Promise<BufferLease> {
    const cached = this.lease(key);
    if (cached) {
      return cached;
    }
    let pending = this.loading.get(key);
    if (!pending) {
      pending = decode().finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    const buffer = await pending;
    return this.lease(key) ?? this.store(key, buffer);
  }

  /** Drop every buffer that is not playing (Settings > Clear audio cache, PLY-11). */
  clear(): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.leases === 0) {
        this.drop(key, entry);
      }
    }
  }

  private lend(key: string, entry: Entry): BufferLease {
    entry.leases++;
    let returned = false;
    return {
      buffer: entry.buffer,
      release: () => {
        if (returned) {
          return;
        }
        returned = true;
        entry.leases--;
        this.evict();
      },
    };
  }

  private evict() {
    for (const [key, entry] of [...this.entries]) {
      if (this.usedBytes <= this.capBytes) {
        return;
      }
      if (entry.leases === 0) {
        this.drop(key, entry);
      }
    }
  }

  private drop(key: string, entry: Entry) {
    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
      this.usedBytes -= entry.bytes;
    }
  }
}
