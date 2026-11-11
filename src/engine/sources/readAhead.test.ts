import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

import { PlaybackEngine } from "../engine";
import { FakeAudioContext, FakeNode } from "../testing/fakeAudio";
import { ReadAhead } from "./readAhead";
import { directResolver, FetchBytes, MediaRequest, MediaResolver, SourceLoader } from "./sourceLoader";

const MB = 1_000_000;
let files: Map<string, number>;
let fetchBytes: Mock<FetchBytes>;
let revoked: string[];
let made: number;

/** A disk that answers when the test says so, like a slow network share. */
function deferredFetch() {
  const waiting: (() => void)[] = [];
  fetchBytes.mockImplementation(
    (url, limit) =>
      new Promise((resolve, reject) => {
        waiting.push(() => {
          const size = files.get(url);
          if (size === undefined) reject(new Error(`File not found: ${url}`));
          else resolve(size > limit ? null : new ArrayBuffer(size));
        });
      }),
  );
  return () => waiting.splice(0).forEach((answer) => answer());
}

function readAhead(options: { capBytes?: number; maxItemBytes?: number; inner?: MediaResolver } = {}) {
  return new ReadAhead({
    inner: options.inner ?? directResolver,
    fetchBytes,
    makeObjectUrl: () => `blob:lyre/${++made}`,
    revokeObjectUrl: (url) => revoked.push(url),
    capBytes: options.capBytes ?? 100 * MB,
    maxItemBytes: options.maxItemBytes ?? 50 * MB,
  });
}

const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};
const track = (name: string): MediaRequest => ({ url: `file:///music/${name}` });

beforeEach(() => {
  files = new Map([
    ["file:///music/a.flac", 4 * MB],
    ["file:///music/b.flac", 4 * MB],
    ["file:///music/c.flac", 4 * MB],
    ["file:///music/d.flac", 4 * MB],
    ["file:///music/big.flac", 80 * MB],
    ["file:///music/six.flac", 6 * MB],
  ]);
  fetchBytes = vi.fn<FetchBytes>(async (url, limit) => {
    const size = files.get(url);
    if (size === undefined) throw new Error(`File not found: ${url}`);
    return size > limit ? null : new ArrayBuffer(size);
  });
  revoked = [];
  made = 0;
});

describe("ReadAhead (PLY-11): the playing and next tracks are held in memory", () => {
  it("plays the current track from memory once read, so a slow disk cannot interrupt it", async () => {
    const ahead = readAhead();
    const resolved = await ahead.resolve(track("a.flac"));
    expect(resolved.url).toMatch(/^blob:lyre\//);
    expect(fetchBytes).toHaveBeenCalledWith("file:///music/a.flac", 50 * MB);
    expect(ahead.usedBytes).toBe(4 * MB);
  });

  it("reads the next track in the background, so it starts from memory", async () => {
    const ahead = readAhead();
    ahead.want([track("a.flac"), track("b.flac")]);
    await settle();
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    const next = await ahead.resolve(track("b.flac"));
    expect(next.url).toMatch(/^blob:/);
    expect(fetchBytes).toHaveBeenCalledTimes(2);
  });

  it("waits for a read already under way instead of reading the file twice", async () => {
    const answer = deferredFetch();
    const ahead = readAhead();
    ahead.want([track("a.flac")]);
    const playing = ahead.resolve(track("a.flac"));
    await settle(); // both are now waiting on the disk
    answer();
    expect((await playing).url).toMatch(/^blob:/);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  it("drops tracks no longer wanted once over its memory cap, and frees their memory", async () => {
    const ahead = readAhead({ capBytes: 10 * MB });
    ahead.want([track("a.flac"), track("b.flac")]);
    await settle();
    ahead.want([track("c.flac"), track("d.flac")]);
    await settle();
    expect(ahead.keys()).toEqual(["file:///music/c.flac", "file:///music/d.flac"]);
    expect(revoked).toEqual(["blob:lyre/1", "blob:lyre/2"]);
    expect(ahead.usedBytes).toBeLessThanOrEqual(10 * MB);
  });

  it("keeps tracks it no longer needs while there is room, least recently used going first", async () => {
    const ahead = readAhead({ capBytes: 13 * MB });
    ahead.want([track("a.flac"), track("b.flac")]);
    await settle();
    (await ahead.resolve(track("a.flac"))).release?.();
    ahead.want([track("c.flac")]);
    await settle();
    expect(ahead.keys()).toEqual(["file:///music/b.flac", "file:///music/a.flac", "file:///music/c.flac"]);
    ahead.want([track("d.flac")]);
    await settle();
    // b was used longest ago.
    expect(ahead.keys()).toEqual(["file:///music/a.flac", "file:///music/c.flac", "file:///music/d.flac"]);
  });

  it("never drops a track that is playing, and frees it once it stops", async () => {
    const ahead = readAhead({ capBytes: 10 * MB });
    const playing = await ahead.resolve(track("a.flac"));
    ahead.want([track("c.flac")]);
    await settle();
    ahead.want([track("d.flac")]);
    await settle();
    expect(ahead.keys()).toContain("file:///music/a.flac");
    expect(revoked).not.toContain(playing.url);
    playing.release?.();
    playing.release?.(); // twice counts once
    ahead.want([track("b.flac"), track("c.flac")]);
    await settle();
    expect(ahead.keys()).not.toContain("file:///music/a.flac");
    expect(revoked).toContain(playing.url);
  });

  it("streams a file too big to hold from its own address and does not read it again (PERF-7)", async () => {
    const ahead = readAhead();
    const big = await ahead.resolve(track("big.flac"));
    expect(big.url).toBe("file:///music/big.flac");
    await ahead.resolve(track("big.flac"));
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(ahead.usedBytes).toBe(0);
  });

  it("asks for a copy on this computer's disk of a next track too big for memory", async () => {
    const inner: MediaResolver = { resolve: vi.fn(async (request: MediaRequest) => ({ url: request.url })) };
    const ahead = readAhead({ inner });
    ahead.want([track("a.flac"), track("big.flac")]);
    await settle();
    expect(inner.resolve).toHaveBeenCalledWith(expect.objectContaining({ url: "file:///music/big.flac", keepLocal: true }));
  });

  it("does not read what would not fit beside the tracks playing", async () => {
    const ahead = readAhead({ capBytes: 10 * MB });
    const playing = await ahead.resolve(track("six.flac"));
    const next = await ahead.resolve(track("b.flac"));
    expect(fetchBytes).toHaveBeenLastCalledWith("file:///music/b.flac", 4 * MB);
    expect(next.url).toMatch(/^blob:/);
    const third = await ahead.resolve(track("c.flac"));
    expect(third.url).toBe("file:///music/c.flac");
    playing.release?.();
    next.release?.();
  });

  it("starts the next track's preparation ahead (for example converting a WMA file)", async () => {
    const inner: MediaResolver = {
      resolve: vi.fn(async (request: MediaRequest) => ({ url: request.url.replace(".wma", ".flac") })),
    };
    files.set("file:///music/old.flac", 2 * MB);
    const ahead = readAhead({ inner });
    ahead.want([track("old.wma")]);
    await settle();
    expect(inner.resolve).toHaveBeenCalledTimes(1);
    expect(fetchBytes).toHaveBeenCalledWith("file:///music/old.flac", expect.any(Number));
    expect((await ahead.resolve(track("old.wma"))).url).toMatch(/^blob:/);
    expect(inner.resolve).toHaveBeenCalledTimes(1);
  });

  it("falls back to the address itself when the file cannot be read, so the player can report it", async () => {
    const ahead = readAhead();
    const missing = await ahead.resolve(track("gone.flac"));
    expect(missing.url).toBe("file:///music/gone.flac");
    ahead.want([track("gone.flac")]);
    await settle(); // no unhandled rejection
  });

  it("passes on a failure of the address itself (e.g. a conversion that failed)", async () => {
    const inner: MediaResolver = { resolve: async () => Promise.reject(new Error("Could not convert old.wma")) };
    const ahead = readAhead({ inner });
    await expect(ahead.resolve(track("old.wma"))).rejects.toThrow("Could not convert old.wma");
    ahead.want([track("old.wma")]);
    await settle(); // a background failure is not thrown anywhere
  });

  it("leaves web addresses to stream as they are", async () => {
    const ahead = readAhead();
    const web = await ahead.resolve({ url: "https://example.com/a.mp3" });
    expect(web.url).toBe("https://example.com/a.mp3");
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("clear() frees everything not playing", async () => {
    const ahead = readAhead();
    const playing = await ahead.resolve(track("a.flac"));
    ahead.want([track("b.flac")]);
    await settle();
    ahead.clear();
    expect(ahead.keys()).toEqual(["file:///music/a.flac"]);
    playing.release?.();
  });
});

describe("ReadAhead on the fake audio graph (PLY-11)", () => {
  it("a track plays from memory through a media element, and its memory is freed once the voice stops", async () => {
    const context = new FakeAudioContext();
    context.mediaDurations.set("blob:lyre/1", 240);
    const ahead = readAhead({ capBytes: 5 * MB });
    const loader = new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes, resolver: ahead });
    const engine = new PlaybackEngine({ context, scheduler: context.clock, loader });
    const voice = engine.play({ bus: "music", media: track("a.flac") });
    await context.flush();
    await context.advance(1);
    expect(voice.state).toBe("playing");
    expect(voice.sourceKind).toBe("stream");
    expect(context.elements[0].src).toBe("blob:lyre/1");
    expect(context.signalAt(engine.outputs.table as unknown as FakeNode)).toBeGreaterThan(0);
    await voice.stop(0);
    ahead.want([track("b.flac")]);
    await settle();
    expect(ahead.keys()).toEqual(["file:///music/b.flac"]);
    expect(revoked).toEqual(["blob:lyre/1"]);
    engine.dispose();
  });
});
