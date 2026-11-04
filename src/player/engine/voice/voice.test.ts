import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAudioContext, FakeBuffer, FakeGain } from "../testing/fakeAudio";
import { bufferSource, PlayableSource, streamSource } from "../sources/layers";
import { Voice, VoiceOptions, VoiceState } from "./voice";

let context: FakeAudioContext;
let bus: FakeGain;

type Kind = "buffer" | "stream";

function sourceOf(kind: Kind, seconds: number, url = `sound-${seconds}.ogg`): PlayableSource {
  if (kind === "buffer") {
    return bufferSource(context, new FakeBuffer(seconds));
  }
  context.mediaDurations.set(url, seconds);
  return streamSource(context, url, () => context.createMediaElement());
}

async function play(kind: Kind, seconds: number, options: VoiceOptions = {}) {
  const voice = new Voice({ context, scheduler: context.clock, destination: bus }, Promise.resolve(sourceOf(kind, seconds)), options);
  await context.flush();
  return voice;
}

/** Everything a voice may hold: wired nodes besides the bus, running sources, media, listeners, timers. */
function held() {
  return {
    nodes: context.connectedNodeCount(),
    sources: context.runningSourceCount(),
    media: context.elementsHoldingMedia(),
    listeners: context.listenersOnElements(),
    timers: context.clock.pendingTimers(),
  };
}

const level = () => context.signalAt(bus);

beforeEach(() => {
  context = new FakeAudioContext();
  bus = context.createGain();
  bus.connect(context.destination);
});

describe.each(["buffer", "stream"] as const)("Voice (%s)", (kind) => {
  it("loads, reports its length and plays at its volume", async () => {
    const states: VoiceState[] = [];
    const voice = new Voice({ context, scheduler: context.clock, destination: bus }, Promise.resolve(sourceOf(kind, 10)), { volume: 0.5 });
    voice.on("state", (state) => states.push(state));
    const loaded = vi.fn();
    voice.on("loaded", loaded);
    expect(voice.state).toBe("loading");
    await context.flush();
    await context.advance(0.1);
    expect(loaded).toHaveBeenCalledWith(10);
    expect(voice.duration).toBe(10);
    expect(states).toEqual(["playing"]);
    expect(level()).toBeCloseTo(0.5);
  });

  it("fades in from silence", async () => {
    await play(kind, 10, { fadeInSeconds: 2 });
    await context.advance(1);
    expect(level()).toBeCloseTo(0.5, 1);
    await context.advance(1.5);
    expect(level()).toBeCloseTo(1);
  });

  it("starts from a given position", async () => {
    const voice = await play(kind, 10, { startAt: 4 });
    await context.advance(1);
    expect(voice.position()).toBeCloseTo(5, 1);
  });

  it("fades out before its end, then ends, says so once and releases everything", async () => {
    const before = held();
    const voice = await play(kind, 4, { fadeOutSeconds: 1 });
    const ended = vi.fn();
    voice.on("ended", ended);
    await context.advance(3.5);
    expect(level()).toBeCloseTo(0.5, 1);
    await context.advance(1);
    expect(voice.state).toBe("ended");
    expect(ended).toHaveBeenCalledTimes(1);
    expect(held()).toEqual(before);
  });

  it("a cross-faded loop keeps playing, overlapping each pass with the next and never going silent", async () => {
    const voice = await play(kind, 3, { loop: true, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 });
    const ended = vi.fn();
    voice.on("ended", ended);
    let quietest = Infinity;
    let mostLayers = 0;
    await context.advance(0.5); // past the first fade-in
    for (let i = 0; i < 200; i++) {
      await context.advance(0.1);
      quietest = Math.min(quietest, level());
      mostLayers = Math.max(mostLayers, voice.layerCount());
    }
    expect(ended).not.toHaveBeenCalled();
    expect(voice.state).toBe("playing");
    // Equal fade-in and fade-out lengths overlap to a constant level.
    expect(quietest).toBeCloseTo(1);
    expect(mostLayers).toBe(2);
  });

  it("a loop without a fade-out loops by itself in one layer", async () => {
    const voice = await play(kind, 2, { loop: true });
    await context.advance(9);
    expect(voice.layerCount()).toBe(1);
    expect(voice.state).toBe("playing");
    expect(level()).toBeCloseTo(1);
  });

  it("switching the loop off lets the current pass finish and end", async () => {
    const voice = await play(kind, 2, { loop: true });
    await context.advance(3);
    voice.setLoop(false);
    await context.advance(1.5);
    expect(voice.state).toBe("ended");
  });

  it("seeking moves the fade-out to match the new position (BUG-5)", async () => {
    const voice = await play(kind, 10, { fadeOutSeconds: 1 });
    await context.advance(2);
    voice.seek(5); // 5 s left: the fade starts 4 s from now, at t = 6.
    await context.advance(3.8);
    expect(level()).toBeCloseTo(1);
    await context.advance(0.7);
    expect(level()).toBeCloseTo(0.5, 1);
  });

  it("seeking backwards in a cross-faded loop delays the next pass", async () => {
    const voice = await play(kind, 6, { loop: true, fadeOutSeconds: 1 });
    await context.advance(4);
    voice.seek(0); // the next cross-fade is now 5 s away instead of 1 s.
    await context.advance(3);
    expect(voice.layerCount()).toBe(1);
    await context.advance(2.5);
    expect(voice.layerCount()).toBe(2);
  });

  it("seeking during a cross-fade drops the outgoing pass", async () => {
    const voice = await play(kind, 4, { loop: true, fadeOutSeconds: 1 });
    await context.advance(3.5);
    expect(voice.layerCount()).toBe(2);
    voice.seek(1);
    expect(voice.layerCount()).toBe(1);
  });

  it("pause silences it and keeps its place; time spent paused does not count towards the fade-out", async () => {
    const voice = await play(kind, 10, { fadeOutSeconds: 1 });
    await context.advance(3);
    voice.pause();
    expect(voice.state).toBe("paused");
    await context.advance(20);
    expect(level()).toBe(0);
    expect(voice.position()).toBeCloseTo(3, 1);
    voice.resume();
    await context.advance(5.5); // position 8.5: before the fade at 9
    expect(level()).toBeCloseTo(1);
    await context.advance(2);
    expect(voice.state).toBe("ended");
  });

  it("stop with a fade ramps to silence, then releases everything", async () => {
    const before = held();
    const voice = await play(kind, 30, { volume: 0.8 });
    await context.advance(1);
    const stopped = voice.stop(2);
    expect(voice.state).toBe("stopping");
    await context.advance(1);
    expect(level()).toBeCloseTo(0.4, 1);
    await context.advance(1.5);
    await stopped;
    expect(voice.state).toBe("stopped");
    expect(held()).toEqual(before);
  });

  it("stop without a fade releases at once", async () => {
    const before = held();
    const voice = await play(kind, 30, { loop: true, fadeOutSeconds: 1 });
    await context.advance(29.5);
    await voice.stop(0);
    expect(voice.state).toBe("stopped");
    expect(held()).toEqual(before);
  });

  it("stop while still loading releases the sound as soon as it arrives", async () => {
    const before = held();
    let resolveSource: (source: PlayableSource) => void = () => undefined;
    const voice = new Voice(
      { context, scheduler: context.clock, destination: bus },
      new Promise((resolve) => (resolveSource = resolve)),
      {},
    );
    const stopped = voice.stop(1);
    resolveSource(sourceOf(kind, 5));
    await context.flush();
    await stopped;
    expect(voice.state).toBe("stopped");
    expect(held()).toEqual(before);
  });

  it("volume changes are smoothed and do not fight a fade-out", async () => {
    const voice = await play(kind, 30, { volume: 1 });
    voice.setVolume(0.25);
    await context.advance(0.1);
    expect(level()).toBeCloseTo(0.25);
    const stopped = voice.stop(2);
    await context.advance(1);
    voice.setVolume(1);
    await context.advance(0.1);
    expect(level()).toBeCloseTo(0.45, 1);
    await context.advance(1);
    await stopped;
  });

  it("calls after the end change nothing", async () => {
    const voice = await play(kind, 1);
    await context.advance(1.5);
    expect(voice.state).toBe("ended");
    voice.seek(0);
    voice.resume();
    voice.setLoop(true);
    await voice.stop(1);
    expect(voice.state).toBe("ended");
  });
});

describe("Voice errors", () => {
  it("a stream that cannot be opened fails, says why and holds nothing", async () => {
    const before = held();
    context.failingUrls.add("broken.mp3");
    context.mediaDurations.set("broken.mp3", 10);
    const voice = new Voice(
      { context, scheduler: context.clock, destination: bus },
      Promise.resolve(streamSource(context, "broken.mp3", () => context.createMediaElement())),
      {},
    );
    const error = vi.fn();
    voice.on("error", error);
    await context.flush();
    expect(voice.state).toBe("failed");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not be opened/));
    expect(held()).toEqual(before);
  });

  it("a source that fails to load fails the voice", async () => {
    const voice = new Voice({ context, scheduler: context.clock, destination: bus }, Promise.reject(new Error("File not found")), {});
    const error = vi.fn();
    voice.on("error", error);
    await context.flush();
    expect(voice.state).toBe("failed");
    expect(error).toHaveBeenCalledWith("File not found");
  });

  it("a stream that fails on a later loop pass fails the voice and releases both passes", async () => {
    const before = held();
    const url = "flaky.ogg";
    context.mediaDurations.set(url, 3);
    const voice = new Voice(
      { context, scheduler: context.clock, destination: bus },
      Promise.resolve(streamSource(context, url, () => context.createMediaElement())),
      { loop: true, fadeOutSeconds: 0.5 },
    );
    await context.flush();
    await context.advance(1);
    context.failingUrls.add(url);
    await context.advance(3);
    expect(voice.state).toBe("failed");
    expect(held()).toEqual(before);
  });

  it("gives the source back when it is done with it", async () => {
    const release = vi.fn();
    const voice = new Voice(
      { context, scheduler: context.clock, destination: bus },
      Promise.resolve(bufferSource(context, new FakeBuffer(1), release)),
      {},
    );
    await context.flush();
    await voice.stop(0);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

/**
 * BUG-4: nothing may keep playing or hold memory after it stops. With the
 * fake graph, everything a voice creates must be gone after each cycle.
 */
describe("Voice releases everything (BUG-4)", () => {
  it("1,000 play/stop cycles of every kind leave the graph as it started", async () => {
    const before = held();
    const shapes: VoiceOptions[] = [
      {},
      { fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
      { loop: true },
      { loop: true, fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
    ];
    for (let cycle = 0; cycle < 1000; cycle++) {
      const kind: Kind = cycle % 2 === 0 ? "buffer" : "stream";
      const voice = await play(kind, 0.5, shapes[cycle % shapes.length]);
      await context.advance(0.3 + (cycle % 5) * 0.1, 0.1);
      const stopped = voice.stop(cycle % 3 === 0 ? 0 : 0.05);
      // The clock only moves when the test moves it, so let the stop fade run.
      await context.advance(0.1, 0.1);
      await stopped;
    }
    expect(held()).toEqual(before);
    // Sanity: the stream cycles did create media elements, so the check above means something.
    expect(context.elements.length).toBeGreaterThanOrEqual(500);
  }, 120_000);

  it("500 cross-faded loop passes keep at most two layers and leave nothing behind", async () => {
    const before = held();
    const voice = await play("stream", 1, { loop: true, fadeInSeconds: 0.2, fadeOutSeconds: 0.2 });
    let most = 0;
    for (let i = 0; i < 500; i++) {
      await context.advance(0.8, 0.1);
      most = Math.max(most, voice.layerCount());
    }
    expect(most).toBeLessThanOrEqual(2);
    expect(context.elementsHoldingMedia()).toBeLessThanOrEqual(2);
    await voice.stop(0);
    expect(held()).toEqual(before);
  }, 60_000);
});
