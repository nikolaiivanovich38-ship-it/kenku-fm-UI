import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

import { encodeFakeAudio, FakeAudioContext } from "../testing/fakeAudio";
import { BufferCache } from "./bufferCache";
import { DEFAULT_SOURCE_POLICY, FetchBytes, MediaResolver, SourceLoader } from "./sourceLoader";

const MB = 1_000_000;
let context: FakeAudioContext;
let files: Map<string, ArrayBuffer>;
let fetchBytes: Mock<FetchBytes>;
let cache: BufferCache;

function loader(resolver?: MediaResolver) {
  return new SourceLoader({
    context,
    createElement: () => context.createMediaElement(),
    fetchBytes,
    cache,
    resolver,
  });
}

beforeEach(() => {
  context = new FakeAudioContext();
  files = new Map([
    ["file:///sting.wav", encodeFakeAudio(3, 500_000)],
    ["file:///rain-loop.ogg", encodeFakeAudio(20, 300_000)],
    ["file:///long-ambience.ogg", encodeFakeAudio(600, 2 * MB)],
    ["file:///huge.wav", encodeFakeAudio(1200, 200 * MB)],
    ["file:///not-audio.txt", new ArrayBuffer(100)],
  ]);
  // Like the real reader: gives up (null) as soon as a file is over the limit.
  fetchBytes = vi.fn<FetchBytes>(async (url, limit) => {
    const bytes = files.get(url);
    if (!bytes) {
      throw new Error(`File not found: ${url}`);
    }
    return bytes.byteLength > limit ? null : bytes;
  });
  cache = new BufferCache({ capBytes: DEFAULT_SOURCE_POLICY.cacheBytes });
});

describe("SourceLoader: stream or decode (PERF-7)", () => {
  it("streams tracks unless asked for a buffer, without reading the file", async () => {
    const source = await loader().load({ url: "file:///long-ambience.ogg" });
    expect(source.kind).toBe("stream");
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("decodes a short effect or gapless loop to a buffer and caches it", async () => {
    const first = await loader().load({ url: "file:///sting.wav", preferBuffer: true });
    expect(first.kind).toBe("buffer");
    first.release();
    const again = await loader().load({ url: "file:///rain-loop.ogg", preferBuffer: true });
    expect(again.kind).toBe("buffer");
    await loader().load({ url: "file:///sting.wav", preferBuffer: true });
    expect(context.decodeCalls).toBe(2);
    // Least recently used first: the sting was just played again.
    expect(cache.keys()).toEqual(["file:///rain-loop.ogg", "file:///sting.wav"]);
  });

  it("streams a file over the size limit instead of reading it whole", async () => {
    const source = await loader().load({ url: "file:///huge.wav", preferBuffer: true });
    expect(source.kind).toBe("stream");
    expect(fetchBytes).toHaveBeenCalledWith("file:///huge.wav", DEFAULT_SOURCE_POLICY.maxDecodeBytes);
    expect(context.decodeCalls).toBe(0);
  });

  it("skips reading when the size is known to be over the limit", async () => {
    const source = await loader().load({ url: "file:///huge.wav", preferBuffer: true, sizeBytes: 200 * MB });
    expect(source.kind).toBe("stream");
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("streams a small file that decodes to more than the length limit, and remembers not to decode it again", async () => {
    const first = await loader().load({ url: "file:///long-ambience.ogg", preferBuffer: true });
    expect(first.kind).toBe("stream");
    expect(cache.keys()).toEqual([]);
    const l = loader();
    await l.load({ url: "file:///long-ambience.ogg", preferBuffer: true });
    await l.load({ url: "file:///long-ambience.ogg", preferBuffer: true });
    expect(context.decodeCalls).toBe(2); // once per loader, then remembered
  });

  it("falls back to streaming when the bytes cannot be decoded, so the media element can still try", async () => {
    const source = await loader().load({ url: "file:///not-audio.txt", preferBuffer: true });
    expect(source.kind).toBe("stream");
  });

  it("passes on a missing file", async () => {
    await expect(loader().load({ url: "file:///gone.wav", preferBuffer: true })).rejects.toThrow(/File not found/);
  });

  it("the buffer is lent to the voice and given back when the voice releases the source", async () => {
    const small = new BufferCache({ capBytes: 1 });
    const l = new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes, cache: small });
    const source = await l.load({ url: "file:///sting.wav", preferBuffer: true });
    expect(source.kind).toBe("buffer");
    source.release();
    expect(small.keys()).toEqual([]);
  });

  it("two pads firing the same sound at once read and decode it once", async () => {
    const l = loader();
    const [a, b] = await Promise.all([
      l.load({ url: "file:///sting.wav", preferBuffer: true }),
      l.load({ url: "file:///sting.wav", preferBuffer: true }),
    ]);
    expect([a.kind, b.kind]).toEqual(["buffer", "buffer"]);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(context.decodeCalls).toBe(1);
  });

  it("preload() decodes into the cache without holding on to it", async () => {
    await loader().preload({ url: "file:///sting.wav" });
    expect(cache.keys()).toEqual(["file:///sting.wav"]);
    expect(context.decodeCalls).toBe(1);
  });
});

describe("SourceLoader: resolver (for the file cache PLY-11 and conversion BUG-10)", () => {
  it("plays whatever address the resolver gives, and caches by that address", async () => {
    const resolver: MediaResolver = {
      resolve: vi.fn(async (request) => ({ url: request.url.replace(".wma", ".converted.wav"), sizeBytes: 500_000 })),
    };
    files.set("file:///old.converted.wav", encodeFakeAudio(2, 500_000));
    const source = await loader(resolver).load({ url: "file:///old.wma", preferBuffer: true, trackId: "t1" });
    expect(source.kind).toBe("buffer");
    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({ url: "file:///old.wma", trackId: "t1" }));
    expect(fetchBytes).toHaveBeenCalledWith("file:///old.converted.wav", expect.any(Number));
    expect(cache.keys()).toEqual(["file:///old.converted.wav"]);
  });

  it("a resolver failure (e.g. conversion failed) is passed on", async () => {
    const resolver: MediaResolver = { resolve: async () => Promise.reject(new Error("Could not convert old.wma")) };
    await expect(loader(resolver).load({ url: "file:///old.wma" })).rejects.toThrow("Could not convert old.wma");
  });

  it("streams through a media element from the resolved address", async () => {
    const resolver: MediaResolver = { resolve: async () => ({ url: "file:///cached/track.ogg" }) };
    context.mediaDurations.set("file:///cached/track.ogg", 100);
    const source = await loader(resolver).load({ url: "https://example.com/track.ogg" });
    const layer = await Promise.all([source.openLayer(context.createGain(), { onEnded: vi.fn(), onError: vi.fn() }), context.flush()]);
    expect(layer[0].duration).toBe(100);
    expect(context.elements[0].src).toBe("file:///cached/track.ogg");
    layer[0].release();
  });
});
