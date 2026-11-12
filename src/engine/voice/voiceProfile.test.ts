/**
 * PLY-12 (playback half): a voice plays a track's audio profile. It starts at
 * Start, stops at End, shapes its fades with the design's curves, and loops
 * back to Loop start with the loop crossfade. Every gain change is written on
 * the audio timeline ahead of time, so the fake graph can check the level at
 * any moment.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AudioProfile, AudioProfileInput, DomainTrack, fadeInGain, fadeOutGain, resolveProfile } from "../../common/domain";
import { bufferSource, PlayableSource, streamSource } from "../sources/layers";
import { FakeAudioContext, FakeBuffer, FakeBufferSource, FakeGain } from "../testing/fakeAudio";
import { Voice, VoiceOptions } from "./voice";

let context: FakeAudioContext;
let bus: FakeGain;

type Kind = "buffer" | "stream";

function profileOf(input: AudioProfileInput, durationMs: number): AudioProfile {
  const track: DomainTrack = {
    id: "t",
    kind: "music",
    title: "",
    metaTitle: "",
    fileName: "t.ogg",
    durationMs,
    role: null,
    loop: null,
    energy: null,
    tags: {},
    profile: input,
  };
  return resolveProfile(track, [], {}).profile;
}

let urlCounter = 0;
function sourceOf(kind: Kind, seconds: number): PlayableSource {
  if (kind === "buffer") {
    return bufferSource(context, new FakeBuffer(seconds));
  }
  const url = `profiled-${++urlCounter}.ogg`;
  context.mediaDurations.set(url, seconds);
  return streamSource(context, url, () => context.createMediaElement());
}

async function play(kind: Kind, seconds: number, options: VoiceOptions) {
  const voice = new Voice({ context, scheduler: context.clock, destination: bus }, Promise.resolve(sourceOf(kind, seconds)), options);
  await context.flush();
  return voice;
}

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

describe.each(["buffer", "stream"] as const)("Voice with an audio profile (%s)", (kind) => {
  it("starts at Start and ends at End, before the end of the file", async () => {
    const before = held();
    const voice = await play(kind, 20, { profile: profileOf({ startMs: 2000, endMs: 8000, after: "next" }, 20_000) });
    const ended = vi.fn();
    voice.on("ended", ended);
    expect(voice.position()).toBeCloseTo(2, 1);
    await context.advance(5.9);
    expect(voice.state).toBe("playing");
    expect(voice.position()).toBeCloseTo(7.9, 1);
    expect(level()).toBeCloseTo(1);
    await context.advance(0.2);
    expect(voice.state).toBe("ended");
    expect(ended).toHaveBeenCalledTimes(1);
    expect(held()).toEqual(before);
  });

  it("fades in along the profile's curve", async () => {
    const shape = 10; // gentle
    await play(kind, 20, { profile: profileOf({ fadeIn: { ms: 2000, shape } }, 20_000) });
    await context.advance(0.5);
    expect(level()).toBeCloseTo(fadeInGain(0.25, shape), 2);
    await context.advance(0.5);
    expect(level()).toBeCloseTo(fadeInGain(0.5, shape), 2);
    await context.advance(1.5);
    expect(level()).toBeCloseTo(1);
  });

  it("fades out along the profile's curve, ending silent at End", async () => {
    const shape = 90; // sharp
    const voice = await play(kind, 20, { profile: profileOf({ endMs: 8000, fadeOut: { ms: 2000, shape }, after: "stop" }, 20_000) });
    await context.advance(6.5);
    expect(level()).toBeCloseTo(fadeOutGain(0.25, shape), 2);
    await context.advance(0.5);
    expect(level()).toBeCloseTo(fadeOutGain(0.5, shape), 2);
    await context.advance(0.95);
    expect(level()).toBeCloseTo(fadeOutGain(0.975, shape), 2);
    await context.advance(0.1);
    expect(voice.state).toBe("ended");
  });

  it("loops back to Loop start with the loop crossfade, never fading in again", async () => {
    const voice = await play(kind, 10, {
      profile: profileOf({ endMs: 8000, loopStartMs: 3000, loopCrossfadeMs: 1000, fadeIn: { ms: 1000, shape: 50 }, after: "loop" }, 10_000),
    });
    const ended = vi.fn();
    voice.on("ended", ended);
    await context.advance(1);
    let quietest = Infinity;
    let mostLayers = 0;
    for (let i = 0; i < 300; i++) {
      await context.advance(0.1);
      quietest = Math.min(quietest, level());
      mostLayers = Math.max(mostLayers, voice.layerCount());
    }
    expect(ended).not.toHaveBeenCalled();
    expect(voice.state).toBe("playing");
    expect(quietest).toBeCloseTo(1, 1);
    expect(mostLayers).toBe(2);
    // Each pass after the first runs from 3 s to 8 s and overlaps the next by 1 s: 4 s per loop.
    // The first pass handed over at 7 s; 31 s in, the current pass is 0 s into its sixth loop.
    expect(voice.position()).toBeGreaterThanOrEqual(3);
    expect(voice.position()).toBeLessThanOrEqual(8);
  });

  it("loops back to Loop start without a crossfade", async () => {
    const voice = await play(kind, 10, { profile: profileOf({ endMs: 6000, loopStartMs: 2000, after: "loop" }, 10_000) });
    await context.advance(6.5);
    expect(voice.position()).toBeCloseTo(2.5, 1);
    expect(level()).toBeCloseTo(1);
    await context.advance(4);
    expect(voice.position()).toBeCloseTo(2.5, 1);
    expect(voice.state).toBe("playing");
  });

  it("a crossfade-in fades the whole voice in, on top of the profile", async () => {
    await play(kind, 20, { profile: profileOf({}, 20_000), crossfadeInSeconds: 2 });
    await context.advance(1);
    expect(level()).toBeCloseTo(0.5, 1);
    await context.advance(1.5);
    expect(level()).toBeCloseTo(1);
  });

  it("can start somewhere else than Start, keeping End and the fades", async () => {
    const voice = await play(kind, 20, { profile: profileOf({ endMs: 10_000, fadeOut: { ms: 2000, shape: 50 }, after: "next" }, 20_000), startAt: 7 });
    await context.advance(2);
    expect(voice.position()).toBeCloseTo(9, 1);
    expect(level()).toBeCloseTo(0.5, 1);
    await context.advance(1.1);
    expect(voice.state).toBe("ended");
  });

  it("seeking moves the fade-out and End with the new position (BUG-5)", async () => {
    const voice = await play(kind, 20, { profile: profileOf({ endMs: 8000, fadeOut: { ms: 2000, shape: 50 }, after: "next" }, 20_000) });
    await context.advance(5);
    voice.seek(1); // the fade now starts at 6 s, 5 s from now
    await context.advance(4.9);
    expect(level()).toBeCloseTo(1);
    await context.advance(1);
    expect(level()).toBeCloseTo(0.5, 1);
    await context.advance(1.2);
    expect(voice.state).toBe("ended");
  });

  it("pause and resume keep End where it was in the track", async () => {
    const voice = await play(kind, 20, { profile: profileOf({ endMs: 5000, after: "next" }, 20_000) });
    await context.advance(2);
    voice.pause();
    await context.advance(10);
    expect(voice.state).toBe("paused");
    voice.resume();
    await context.advance(2.9);
    expect(voice.state).toBe("playing");
    await context.advance(0.2);
    expect(voice.state).toBe("ended");
  });

  it("200 profiled loop passes keep at most two layers and leave nothing behind", async () => {
    const before = held();
    const voice = await play(kind, 2, { profile: profileOf({ startMs: 200, endMs: 1600, loopStartMs: 400, loopCrossfadeMs: 300, after: "loop" }, 2000) });
    let most = 0;
    for (let i = 0; i < 200; i++) {
      await context.advance(1.1, 0.1);
      most = Math.max(most, voice.layerCount());
    }
    expect(most).toBeLessThanOrEqual(2);
    await voice.stop(0);
    expect(held()).toEqual(before);
  }, 60_000);
});

describe("Voice with an audio profile, decoded", () => {
  it("jumps back to Loop start on the exact sample", async () => {
    await play("buffer", 10, { profile: profileOf({ endMs: 6000, loopStartMs: 2000, after: "loop" }, 10_000) });
    await context.advance(6.5);
    const sources = context.allNodes.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);
    const second = sources[sources.length - 1];
    expect(second.startedAt).toBeCloseTo(6, 6);
    expect(second.offset).toBe(2);
  });

  it("the outgoing pass is silenced exactly at End", async () => {
    await play("buffer", 10, { profile: profileOf({ endMs: 6000, loopStartMs: 2000, after: "loop" }, 10_000) });
    await context.advance(5.9);
    await context.advance(0.15, 0.15);
    // One pass sounding at full level: the outgoing one was cut at 6 s, the next began at 6 s.
    expect(level()).toBeCloseTo(1);
  });
});
