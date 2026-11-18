/**
 * 52 (Nik's play test, 14 Nov: "12 - Monster Books / Boggarts! only plays a few seconds"). An MP3 whose Xing header
 * counts fewer frames than the file holds (a file that was cut or joined) is read by music-metadata as a few seconds
 * long; the library keeps that length, a track's End is its length unless the game master moves it, and the voice
 * stopped at that End. Chromium itself plays such a file to its real end: it guesses the length from the bit rate at
 * first and finds the real one near the end ("durationchange").
 *
 * An End at the track's length in the library means "the end of the file": the voice plays until the file ends.
 * An End the game master moved inside the track still stops there.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { resolveProfile, type AudioProfileInput, type DomainTrack } from "../../common/domain";
import { bufferSource, streamSource, type PlayableSource } from "../sources/layers";
import { FakeAudioContext, FakeBuffer, type FakeGain } from "../testing/fakeAudio";
import { Voice, type VoiceOptions } from "./voice";

let context: FakeAudioContext;
let bus: FakeGain;

beforeEach(() => {
  context = new FakeAudioContext();
  bus = context.createGain();
  bus.connect(context.destination);
});

/** A track the library thinks is `storedSeconds` long, with these settings. */
function profileOf(storedSeconds: number, input: AudioProfileInput = {}) {
  const track: DomainTrack = { id: "t", kind: "music", title: "", metaTitle: "", fileName: "t.mp3", durationMs: storedSeconds * 1000, role: null, loop: null, energy: null, tags: {}, profile: input };
  return resolveProfile(track, [], {}).profile;
}

let urls = 0;
/** A streamed file `realSeconds` long; `guess`: the length the element reports until it finds the real one. */
function stream(realSeconds: number, guess?: number): PlayableSource {
  const url = `file-end-${++urls}.mp3`;
  context.mediaDurations.set(url, realSeconds);
  if (guess !== undefined) context.mediaEstimates.set(url, guess);
  return streamSource(context, url, () => context.createMediaElement());
}

async function play(source: PlayableSource, options: VoiceOptions) {
  const voice = new Voice({ context, scheduler: context.clock, destination: bus }, Promise.resolve(source), options);
  await context.flush();
  return voice;
}

describe("52: a track plays to the end of its file when its End is the length the library has", () => {
  it("a 20 s file the library thinks is 3 s long plays all 20 s (streamed, with the bit-rate guess of 18.4 s)", async () => {
    const voice = await play(stream(20, 18.4), { profile: profileOf(3), endAtFileEnd: true });
    await context.advance(5);
    expect(voice.state).toBe("playing");
    expect(context.signalAt(bus)).toBeCloseTo(1);
    await context.advance(14);
    expect(voice.state).toBe("playing");
    expect(voice.position()).toBeCloseTo(19, 0);
    await context.advance(1.5);
    expect(voice.state).toBe("ended");
  });

  it("the same file decoded into memory plays all of it", async () => {
    const voice = await play(bufferSource(context, new FakeBuffer(20)), { profile: profileOf(3), endAtFileEnd: true });
    await context.advance(19.5);
    expect(voice.state).toBe("playing");
    await context.advance(1);
    expect(voice.state).toBe("ended");
  });

  it("before 0.5.2 it stopped at the stored 3 s: an End the game master chose inside the track still stops there", async () => {
    const voice = await play(stream(20, 18.4), { profile: profileOf(20, { endMs: 3000 }) });
    await context.advance(2.9);
    expect(voice.state).toBe("playing");
    await context.advance(0.5);
    expect(voice.state).toBe("ended");
  });

  it("a fade out lands on the file's real end once the element finds it, not on its guess", async () => {
    const voice = await play(stream(20, 18.4), { profile: profileOf(3, { fadeOut: { ms: 2000, shape: 50 } }), endAtFileEnd: true });
    // The guessed end is 18.4 s: with it the fade would be over at 18.4 s and the last 1.6 s silent.
    await context.advance(18.6);
    expect(voice.state).toBe("playing");
    expect(context.signalAt(bus)).toBeGreaterThan(0.2);
    await context.advance(1.6);
    expect(voice.state).toBe("ended");
  });

  it("a loop over the whole file goes round at its real end", async () => {
    const voice = await play(stream(20, 18.4), { profile: profileOf(3, { after: "loop", loopCrossfadeMs: 1000 }), endAtFileEnd: true });
    await context.advance(18.8);
    // Still the first pass: the guess (18.4 s) has passed and the file goes on.
    expect(voice.position()).toBeGreaterThan(18.5);
    await context.advance(3);
    expect(voice.state).toBe("playing");
    expect(voice.position()).toBeLessThan(3);
  });

  it("a track the library has no length for (0) plays its whole file", async () => {
    const voice = await play(stream(12), { profile: profileOf(0), endAtFileEnd: true });
    await context.advance(11);
    expect(voice.state).toBe("playing");
    await context.advance(1.5);
    expect(voice.state).toBe("ended");
  });

  it("says how it ended: at the end of the file, with the length it found (for Save diagnostics)", async () => {
    const voice = await play(stream(20, 18.4), { profile: profileOf(3), endAtFileEnd: true });
    await context.advance(21);
    expect(voice.ending).toEqual({ how: "file end", atSeconds: 20, fileSeconds: 20, endSeconds: null, message: null, sourceKind: "stream" });
  });

  it("says when it stopped at End, and where", async () => {
    const voice = await play(stream(20), { profile: profileOf(20, { endMs: 3000 }) });
    await context.advance(4);
    expect(voice.ending).toMatchObject({ how: "end", endSeconds: 3, fileSeconds: 20 });
  });

  it("says why it failed, and where in the file", async () => {
    const source = stream(20);
    const voice = await play(source, { profile: profileOf(20), endAtFileEnd: true });
    await context.advance(4);
    const element = context.elements[context.elements.length - 1];
    element.emit("error");
    expect(voice.state).toBe("failed");
    expect(voice.ending).toMatchObject({ how: "failed", message: "The audio file stopped playing" });
    expect(voice.ending?.atSeconds).toBeCloseTo(4, 0);
  });
});
