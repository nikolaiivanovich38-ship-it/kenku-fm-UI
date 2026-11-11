/**
 * PLY-11: the playing track and the next one are held in memory, so a slow
 * disk or a network share can never make them stutter.
 *
 * What is held is the file as it is on disk (FLAC, MP3, …), not decoded audio:
 * a media element still decodes it a little at a time while it plays (PERF-7),
 * so a ten-minute FLAC costs about 60 MB here instead of the 230 MB it would
 * take decoded. Each held file becomes a `blob:` address the element plays.
 *
 * Memory is bounded by `capBytes`:
 * - files the host wants (`want()`: the playing track and the next) and files
 *   a voice is playing are never dropped;
 * - other files stay while there is room and go least recently used first;
 * - a file bigger than `maxItemBytes` is never read into memory. It plays from
 *   its own address, and the resolver underneath is asked to keep a copy on
 *   this computer's disk (`keepLocal`, see src/main/media), which the next
 *   play uses;
 * - a file that would not fit beside the files that must stay plays from its
 *   own address.
 *
 * Only `file:` addresses are read ahead. Web addresses stream as they are.
 */
import type { FetchBytes, MediaRequest, MediaResolver, ResolvedMedia } from "./sourceLoader";
import { directResolver } from "./sourceLoader";

export interface ReadAheadOptions {
  /** The resolver underneath, e.g. MainMediaResolver for converted copies. */
  inner?: MediaResolver;
  /** Reads a whole file, or null as soon as it is over the limit (readBytes.ts in the browser). */
  fetchBytes: FetchBytes;
  /** Turn bytes into an address a media element can play (`URL.createObjectURL`). */
  makeObjectUrl: (bytes: ArrayBuffer, sourceUrl: string) => string;
  /** Free an address made by makeObjectUrl (`URL.revokeObjectURL`). */
  revokeObjectUrl: (url: string) => void;
  capBytes?: number;
  maxItemBytes?: number;
}

/**
 * 256 MB in all, 96 MB per file: about 25 minutes of CD-quality FLAC or
 * 80 minutes of high-quality MP3 per track. Together with the decoded-audio
 * cache (DEFAULT_SOURCE_POLICY.cacheBytes, 200 MB) this bounds the player's
 * audio memory at about 460 MB.
 */
export const DEFAULT_READ_AHEAD = { capBytes: 256_000_000, maxItemBytes: 96_000_000 } as const;

interface Entry {
  key: string;
  objectUrl: string;
  bytes: number;
  leases: number;
}

const isFileAddress = (url: string) => /^file:/i.test(url);

export class ReadAhead implements MediaResolver {
  private readonly inner: MediaResolver;
  private readonly fetchBytes: FetchBytes;
  private readonly makeObjectUrl: ReadAheadOptions["makeObjectUrl"];
  private readonly revokeObjectUrl: ReadAheadOptions["revokeObjectUrl"];
  private readonly capBytes: number;
  private readonly maxItemBytes: number;
  /** Map order is recency: the first key is the least recently used. Keyed by the address asked for. */
  private readonly entries = new Map<string, Entry>();
  private readonly reading = new Map<string, Promise<Entry | null>>();
  /** Addresses whose file is bigger than maxItemBytes: never read again. */
  private readonly tooBig = new Set<string>();
  private wanted = new Set<string>();
  /** Bumped by every want(), so an older background run stops. */
  private wantGeneration = 0;
  usedBytes = 0;

  constructor(options: ReadAheadOptions) {
    this.inner = options.inner ?? directResolver;
    this.fetchBytes = options.fetchBytes;
    this.makeObjectUrl = options.makeObjectUrl;
    this.revokeObjectUrl = options.revokeObjectUrl;
    this.capBytes = options.capBytes ?? DEFAULT_READ_AHEAD.capBytes;
    this.maxItemBytes = options.maxItemBytes ?? DEFAULT_READ_AHEAD.maxItemBytes;
  }

  /** Addresses held, least recently used first. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  async resolve(request: MediaRequest): Promise<ResolvedMedia> {
    if (!isFileAddress(request.url)) {
      return this.inner.resolve(request);
    }
    const outcome = await this.obtain(request);
    if ("objectUrl" in outcome) {
      if (this.entries.get(outcome.key) === outcome) {
        this.touch(outcome);
        return { url: outcome.objectUrl, sizeBytes: outcome.bytes, release: this.lend(outcome) };
      }
      // Dropped while this call waited: play from the file itself.
      return this.direct(request);
    }
    return outcome;
  }

  /**
   * The tracks to hold: the playing one first, then the next (see upcoming.ts).
   * Anything else held may be dropped once room is needed. Reading happens in
   * the background, one file at a time so it does not compete with playback.
   */
  want(requests: readonly MediaRequest[]): void {
    const files = requests.filter((request) => isFileAddress(request.url));
    this.wanted = new Set(files.map((request) => request.url));
    this.evict();
    const generation = ++this.wantGeneration;
    void (async () => {
      for (const request of files) {
        if (generation !== this.wantGeneration) {
          return;
        }
        if (this.entries.has(request.url)) {
          continue;
        }
        try {
          const outcome = await this.obtain(request);
          if (!("objectUrl" in outcome)) {
            // Nobody plays it yet; give back whatever the resolver holds.
            outcome.release?.();
          }
        } catch {
          // Reported when the track is played; nothing to do in the background.
        }
      }
    })();
  }

  /** Drop everything not playing (Settings > Clear audio cache). */
  clear(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.leases === 0) {
        this.drop(entry);
      }
    }
    this.tooBig.clear();
  }

  /** The held entry, or the address to play straight from when the file is not held. */
  private async obtain(request: MediaRequest): Promise<Entry | ResolvedMedia> {
    const key = request.url;
    const held = this.entries.get(key);
    if (held) {
      return held;
    }
    const pending = this.reading.get(key);
    if (pending) {
      return (await pending.catch((): null => null)) ?? this.direct(request);
    }
    let direct: ResolvedMedia | undefined;
    const reading = this.read(request).then((outcome) => {
      if ("objectUrl" in outcome) {
        return outcome;
      }
      direct = outcome;
      return null;
    });
    this.reading.set(key, reading);
    try {
      return (await reading) ?? direct!;
    } finally {
      this.reading.delete(key);
    }
  }

  private async read(request: MediaRequest): Promise<Entry | ResolvedMedia> {
    const key = request.url;
    if (this.tooBig.has(key)) {
      return this.direct(request);
    }
    const resolved = await this.inner.resolve(request);
    if (!isFileAddress(resolved.url)) {
      return resolved;
    }
    const limit = Math.min(this.maxItemBytes, this.capBytes - this.lockedBytes(key));
    if (limit <= 0) {
      return resolved;
    }
    let bytes: ArrayBuffer | null;
    try {
      bytes = await this.fetchBytes(resolved.url, limit);
    } catch {
      // A missing or unreadable file: the media element tries it and reports it in plain words.
      return resolved;
    }
    if (bytes === null) {
      if (limit < this.maxItemBytes) {
        return resolved; // Might fit later, once other tracks stop.
      }
      this.tooBig.add(key);
      resolved.release?.();
      return this.direct(request);
    }
    resolved.release?.();
    return this.store(key, bytes, resolved.url);
  }

  /** The address to play from without holding the file: a disk copy when it is too big for memory. */
  private direct(request: MediaRequest): Promise<ResolvedMedia> {
    return this.inner.resolve(this.tooBig.has(request.url) ? { ...request, keepLocal: true } : request);
  }

  private store(key: string, bytes: ArrayBuffer, sourceUrl: string): Entry {
    const entry: Entry = { key, objectUrl: this.makeObjectUrl(bytes, sourceUrl), bytes: bytes.byteLength, leases: 0 };
    this.entries.set(key, entry);
    this.usedBytes += entry.bytes;
    this.evict(entry);
    return entry;
  }

  private lend(entry: Entry): () => void {
    entry.leases++;
    let returned = false;
    return () => {
      if (!returned) {
        returned = true;
        entry.leases--;
        this.evict();
      }
    };
  }

  private touch(entry: Entry) {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  /** Bytes of files that must stay: playing or wanted (other than `except`). */
  private lockedBytes(except: string): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      if (entry.key !== except && this.isLocked(entry)) {
        total += entry.bytes;
      }
    }
    return total;
  }

  private isLocked(entry: Entry) {
    return entry.leases > 0 || this.wanted.has(entry.key);
  }

  private evict(keep?: Entry) {
    for (const entry of [...this.entries.values()]) {
      if (this.usedBytes <= this.capBytes) {
        return;
      }
      if (entry !== keep && !this.isLocked(entry)) {
        this.drop(entry);
      }
    }
  }

  private drop(entry: Entry) {
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
      this.usedBytes -= entry.bytes;
      this.revokeObjectUrl(entry.objectUrl);
    }
  }
}

const AUDIO_TYPES: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  weba: "audio/webm",
};

/** The browser's object addresses, typed by the file's extension so the element knows the format at once. */
export const browserObjectUrls = {
  make: (bytes: ArrayBuffer, sourceUrl: string): string => {
    const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(sourceUrl)?.[1]?.toLowerCase() ?? "";
    return URL.createObjectURL(new Blob([bytes], { type: AUDIO_TYPES[extension] ?? "" }));
  },
  revoke: (url: string): void => URL.revokeObjectURL(url),
};
