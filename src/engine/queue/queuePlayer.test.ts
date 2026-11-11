import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlaybackEngine } from "../engine";
import { SourceLoader } from "../sources/sourceLoader";
import { FakeAudioContext, FakeGain } from "../testing/fakeAudio";
import { firstChoice } from "../testing/seededRandom";
import { createQueue, makeEntries, remove, RepeatMode } from "./queue";
import { QueuePlayer } from "./queuePlayer";

let context: FakeAudioContext;
let engine: PlaybackEngine;
let library: Map<string, { url: string; title: string }>;
let player: QueuePlayer;

const table = () => context.signalAt(engine.outputs.table as FakeGain);
const playingTracks = () => engine.voices("music").filter((v) => v.state === "playing").map((v) => v.id.split("#")[0]);

function start(trackIds: string[], options: { repeat?: RepeatMode; startAt?: string } = {}) {
  const queue = createQueue({
    entries: makeEntries(trackIds, (t) => `e-${t}`),
    startEntryId: options.startAt ? `e-${options.startAt}` : undefined,
    repeat: options.repeat ?? "all",
    shuffle: false,
    random: firstChoice,
  });
  player.setQueue(queue);
  player.play();
}

beforeEach(() => {
  context = new FakeAudioContext();
  library = new Map(
    ["a", "b", "c"].map((id) => {
      const url = `file:///${id}.ogg`;
      context.mediaDurations.set(url, 10);
      return [id, { url, title: `Track ${id.toUpperCase()}` }];
    }),
  );
  const loader = new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes: async () => null });
  engine = new PlaybackEngine({ context, scheduler: context.clock, loader });
  player = new QueuePlayer({ engine, lookup: (id) => library.get(id), random: firstChoice });
});

describe("QueuePlayer", () => {
  it("plays the current entry on the music bus, fading in over the cross-fade", async () => {
    start(["a", "b"]);
    await context.flush();
    await context.advance(0.5);
    expect(playingTracks()).toEqual(["e-a"]);
    expect(table()).toBeCloseTo(0.5, 1);
  });

  it("moves to the next track by itself when one ends (no polling)", async () => {
    const changes = vi.fn();
    player.on("change", changes);
    start(["a", "b"]);
    await context.flush();
    await context.advance(10.5);
    expect(player.currentEntry()?.trackId).toBe("b");
    expect(playingTracks()).toEqual(["e-b"]);
    expect(changes).toHaveBeenCalled();
  });

  it("next cross-fades from the old track to the new one", async () => {
    start(["a", "b"]);
    await context.flush();
    await context.advance(2);
    player.next();
    await context.flush();
    await context.advance(0.5);
    expect(engine.voices("music")).toHaveLength(2);
    expect(table()).toBeCloseTo(1, 1);
    await context.advance(1);
    expect(playingTracks()).toEqual(["e-b"]);
  });

  it("previous after 5 s restarts the track instead of changing it", async () => {
    start(["a", "b"], { startAt: "b" });
    await context.flush();
    await context.advance(6);
    player.previous();
    expect(player.currentEntry()?.trackId).toBe("b");
    expect(engine.voices("music")[0].position()).toBeCloseTo(0, 1);
  });

  it("repeat one plays the same track again when it ends", async () => {
    start(["a", "b"], { repeat: "one" });
    await context.flush();
    await context.advance(10.5);
    expect(player.currentEntry()?.trackId).toBe("a");
    expect(playingTracks()).toEqual(["e-a"]);
  });

  it("at the end with repeat off it stops and keeps the last track current", async () => {
    start(["a"], { repeat: "off" });
    await context.flush();
    await context.advance(11);
    expect(engine.voices()).toEqual([]);
    expect(player.isPlaying()).toBe(false);
    expect(player.currentEntry()?.trackId).toBe("a");
  });

  it("skips a track that was deleted from the library instead of stalling", async () => {
    library.delete("b");
    start(["a", "b", "c"]);
    await context.flush();
    player.next();
    await context.flush();
    expect(player.currentEntry()?.trackId).toBe("c");
  });

  it("says so in plain words when a track cannot be played, and stops", async () => {
    context.failingUrls.add("file:///a.ogg");
    const error = vi.fn();
    player.on("error", error);
    start(["a", "b"]);
    await context.flush();
    expect(error).toHaveBeenCalledWith("Unable to play track: Track A");
    expect(player.isPlaying()).toBe(false);
  });

  it("removing the playing entry stops it and makes the next entry current (as the old player did)", async () => {
    start(["a", "b"]);
    await context.flush();
    player.updateQueue((queue) => remove(queue, ["e-a"]));
    await context.flush();
    expect(engine.voices()).toEqual([]);
    expect(player.currentEntry()?.trackId).toBe("b");
  });

  it("pause, resume and stop act on the playing track", async () => {
    start(["a"]);
    await context.flush();
    await context.advance(2);
    player.pause();
    expect(player.isPlaying()).toBe(false);
    player.resume();
    expect(player.isPlaying()).toBe(true);
    player.stop();
    await context.flush();
    expect(engine.voices()).toEqual([]);
  });
});
