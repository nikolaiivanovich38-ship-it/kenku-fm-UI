/**
 * 28 (Nik's play test, 14 Nov): "When I apply a setting in the audio details view of a track while a track preview of
 * that track is playing, those settings should apply to the currently playing audio, so I don't have to restart the
 * track to hear them." A voice takes a new audio profile while it plays: End, the fades and the loop move at once,
 * from where it is, without opening the file again.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { resolveProfile, type AudioProfileInput, type DomainTrack } from "../../common/domain";
import { bufferSource, streamSource, type PlayableSource } from "../sources/layers";
import { FakeAudioContext, FakeBuffer, type FakeGain } from "../testing/fakeAudio";
import { Voice } from "./voice";

let context: FakeAudioContext;
let bus: FakeGain;

beforeEach(() => {
  context = new FakeAudioContext();
  bus = context.createGain();
  bus.connect(context.destination);
});

const profileOf = (input: AudioProfileInput, seconds = 30) => {
  const track: DomainTrack = { id: "t", kind: "music", title: "", metaTitle: "", fileName: "t.ogg", durationMs: seconds * 1000, role: null, loop: null, energy: null, tags: {}, profile: input };
  return resolveProfile(track, [], {}).profile;
};

function sourceOf(kind: "buffer" | "stream", seconds: number): PlayableSource {
  if (kind === "buffer") return bufferSource(context, new FakeBuffer(seconds));
  const url = `live-${Math.random()}.ogg`;
  context.mediaDurations.set(url, seconds);
  return streamSource(context, url, () => context.createMediaElement());
}

describe.each(["buffer", "stream"] as const)("a voice takes a new profile while it plays (28, %s)", (kind) => {
  async function play(input: AudioProfileInput) {
    const voice = new Voice({ context, scheduler: context.clock, destination: bus }, Promise.resolve(sourceOf(kind, 30)), { profile: profileOf(input) });
    await context.flush();
    return voice;
  }

  it("End moved earlier: it ends at the new End, from where it is, without starting again", async () => {
    const voice = await play({ after: "next" });
    await context.advance(5);
    const opened = context.elements.length;
    voice.setProfile(profileOf({ endMs: 8000, after: "next" }));
    expect(voice.position()).toBeCloseTo(5, 1);
    await context.advance(2.8);
    expect(voice.state).toBe("playing");
    await context.advance(0.5);
    expect(voice.state).toBe("ended");
    // Nothing opened again.
    expect(context.elements.length).toBe(opened);
  });

  it("a fade out set while it plays is heard on the way to End", async () => {
    const voice = await play({ endMs: 20_000, after: "next" });
    await context.advance(5);
    voice.setProfile(profileOf({ endMs: 20_000, after: "next", fadeOut: { ms: 10_000, shape: 50 } }));
    await context.advance(10);
    expect(context.signalAt(bus)).toBeLessThan(0.75);
    expect(context.signalAt(bus)).toBeGreaterThan(0.1);
  });

  it("switching the loop on makes it go back to Loop start at End; off, it ends there", async () => {
    const voice = await play({ endMs: 10_000, after: "next" });
    await context.advance(2);
    voice.setProfile(profileOf({ endMs: 10_000, loopStartMs: 4000, after: "loop" }));
    await context.advance(9);
    expect(voice.state).toBe("playing");
    expect(voice.position()).toBeGreaterThan(4);
    expect(voice.position()).toBeLessThan(6);
    voice.setProfile(profileOf({ endMs: 10_000, loopStartMs: 4000, after: "next" }));
    await context.advance(6);
    expect(voice.state).toBe("ended");
  });

  it("End moved before where it is: it goes on to what happens at End at once", async () => {
    const voice = await play({ after: "next" });
    await context.advance(12);
    voice.setProfile(profileOf({ endMs: 8000, after: "next" }));
    await context.advance(0.1);
    expect(voice.state).toBe("ended");
  });
});
