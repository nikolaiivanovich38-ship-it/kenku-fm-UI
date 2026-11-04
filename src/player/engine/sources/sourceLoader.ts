/**
 * PERF-7: decides how each item plays.
 *
 * - Tracks stream through a media element: nothing is decoded ahead, so an
 *   hour-long ambience costs no more memory than a short one.
 * - Items that ask for a buffer (`preferBuffer`: pads that must start
 *   instantly, loops that must be gapless) are decoded, if they are small:
 *   files over `maxDecodeBytes` are never read whole, and anything that
 *   decodes to more than `maxDecodeSeconds` is streamed instead (and
 *   remembered, so it is not decoded again). Decoded buffers live in the
 *   BufferCache.
 *
 * Every address goes through a MediaResolver first. The default returns the
 * address unchanged. MainMediaResolver (BUG-10: converted copies of WMA and
 * other formats the player cannot decode) and ReadAhead (PLY-11: the playing
 * and next tracks held in memory) plug in here and hand back the address of
 * a converted or buffered copy, with no engine change. A resolver may hold
 * something for the address it returns (a buffered copy); it says so with
 * `release`, which the loader calls once that address is no longer needed.
 */
import type { BufferLike, EngineContext, MediaElementLike } from "../audio/types";
import { BufferCache, BufferLease } from "./bufferCache";
import { bufferSource, PlayableSource, streamSource } from "./layers";

export interface MediaRequest {
  /** The address the library stores: file://, https://, blob:… */
  url: string;
  /** Library track id, for resolvers that cache or convert per track. */
  trackId?: string;
  /** Decode to a buffer if small enough (instant start, gapless loop). Default: stream. */
  preferBuffer?: boolean;
  /** File size if the caller knows it; saves reading a file that is too big to decode. */
  sizeBytes?: number;
  /**
   * PLY-11: keep a copy of this file on this computer's own disk (for a long
   * track too big to hold in memory, from a slow disk or network share).
   * A hint: the copy is made in the background and used once it is ready.
   */
  keepLocal?: boolean;
}

export interface ResolvedMedia {
  /** The address to actually play. */
  url: string;
  sizeBytes?: number;
  /** Give back what the resolver holds for this address. Called once, when it is no longer needed. */
  release?: () => void;
}

export interface MediaResolver {
  resolve(request: MediaRequest): Promise<ResolvedMedia>;
}

export const directResolver: MediaResolver = {
  resolve: async (request) => ({ url: request.url, sizeBytes: request.sizeBytes }),
};

/**
 * Read a whole file, or give up and return null as soon as it is over
 * `limitBytes`. See readBytes.ts for the browser version.
 */
export type FetchBytes = (url: string, limitBytes: number) => Promise<ArrayBuffer | null>;

export interface SourcePolicy {
  /** Files bigger than this are always streamed (about 30 s of 48 kHz stereo WAV). */
  maxDecodeBytes: number;
  /** Anything longer than this once decoded is streamed instead. */
  maxDecodeSeconds: number;
  /** Memory cap for decoded audio. */
  cacheBytes: number;
}

export const DEFAULT_SOURCE_POLICY: SourcePolicy = {
  maxDecodeBytes: 6_000_000,
  maxDecodeSeconds: 30,
  cacheBytes: 200_000_000,
};

/** Call `release` at most once (and accept none). */
function once(release: (() => void) | undefined): () => void {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      release?.();
    }
  };
}

/** The file is too big or too long to decode, or the decoder refused it: stream it instead. */
class NotDecodable extends Error {}

export class SourceLoader {
  private readonly context: EngineContext;
  private readonly createElement: () => MediaElementLike;
  private readonly fetchBytes: FetchBytes;
  private readonly resolver: MediaResolver;
  private readonly policy: SourcePolicy;
  readonly cache: BufferCache;
  /** Addresses found to be too long to decode, so they are streamed straight away next time. */
  private readonly streamOnly = new Set<string>();

  constructor(options: {
    context: EngineContext;
    createElement: () => MediaElementLike;
    fetchBytes: FetchBytes;
    resolver?: MediaResolver;
    policy?: Partial<SourcePolicy>;
    cache?: BufferCache;
  }) {
    this.context = options.context;
    this.createElement = options.createElement;
    this.fetchBytes = options.fetchBytes;
    this.resolver = options.resolver ?? directResolver;
    this.policy = { ...DEFAULT_SOURCE_POLICY, ...options.policy };
    this.cache = options.cache ?? new BufferCache({ capBytes: this.policy.cacheBytes });
  }

  async load(request: MediaRequest): Promise<PlayableSource> {
    const resolved = await this.resolver.resolve(request);
    const release = once(resolved.release);
    if (request.preferBuffer) {
      let buffer: PlayableSource | null;
      try {
        buffer = await this.tryBuffer(resolved);
      } catch (error) {
        release();
        throw error;
      }
      if (buffer) {
        // The decoded copy is all the voice needs from here on.
        release();
        return buffer;
      }
    }
    return streamSource(this.context, resolved.url, this.createElement, release);
  }

  /** Decode into the cache ahead of time (soundboard pads, PLY-11), without holding on to it. */
  async preload(request: MediaRequest): Promise<void> {
    const source = await this.load({ ...request, preferBuffer: true });
    source.release();
  }

  private async tryBuffer(resolved: ResolvedMedia): Promise<PlayableSource | null> {
    const { url, sizeBytes } = resolved;
    if (this.streamOnly.has(url) || (sizeBytes !== undefined && sizeBytes > this.policy.maxDecodeBytes)) {
      return null;
    }
    let lease: BufferLease;
    try {
      // One read and decode per address, even when two pads fire at once.
      lease = await this.cache.load(url, () => this.decode(url));
    } catch (error) {
      if (error instanceof NotDecodable) {
        this.streamOnly.add(url);
        return null;
      }
      throw error;
    }
    return bufferSource(this.context, lease.buffer, lease.release);
  }

  private async decode(url: string): Promise<BufferLike> {
    const bytes = await this.fetchBytes(url, this.policy.maxDecodeBytes);
    if (bytes === null) {
      throw new NotDecodable("over the size limit");
    }
    let decoded: BufferLike;
    try {
      decoded = await this.context.decodeAudioData(bytes);
    } catch {
      // The media element may still manage, or will report a clear error.
      throw new NotDecodable("the decoder refused it");
    }
    if (decoded.duration > this.policy.maxDecodeSeconds) {
      throw new NotDecodable("too long");
    }
    return decoded;
  }
}
