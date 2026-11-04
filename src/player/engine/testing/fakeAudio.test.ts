import { describe, expect, it } from "vitest";

import { rampTo } from "../audio/types";
import { FakeAudioContext, FakeBuffer } from "./fakeAudio";

/** The fake is what every engine test relies on, so its own rules are pinned here. */
describe("fake audio context", () => {
  it("gain automation: set, linear ramp, and a ramp interrupted by another from the held value", async () => {
    const context = new FakeAudioContext();
    const gain = context.createGain();
    rampTo(gain.gain, 0, 0, 0);
    rampTo(gain.gain, 1, 0, 2);
    await context.advance(1);
    expect(gain.gain.value).toBeCloseTo(0.5);
    rampTo(gain.gain, 0, context.currentTime, 1);
    await context.advance(0.5);
    expect(gain.gain.value).toBeCloseTo(0.25);
    await context.advance(1);
    expect(gain.gain.value).toBe(0);
  });

  it("buffer sources sound between start and their end, then fire onended once", async () => {
    const context = new FakeAudioContext();
    const source = context.createBufferSource();
    source.buffer = new FakeBuffer(1);
    let ended = 0;
    source.onended = () => ended++;
    source.connect(context.destination);
    source.start(0.5);
    expect(context.signalAt(context.destination)).toBe(0);
    await context.advance(0.6);
    expect(context.signalAt(context.destination)).toBe(1);
    await context.advance(1);
    expect(context.signalAt(context.destination)).toBe(0);
    expect(ended).toBe(1);
  });

  it("media elements load on flush, play with the clock and fire ended", async () => {
    const context = new FakeAudioContext();
    context.mediaDurations.set("song", 2);
    const element = context.createMediaElement();
    let ended = 0;
    element.addEventListener("ended", () => ended++);
    element.src = "song";
    element.load();
    await context.flush();
    expect(element.duration).toBe(2);
    await element.play();
    await context.advance(2.5);
    expect(ended).toBe(1);
    expect(element.paused).toBe(true);
  });

  it("disconnecting a connection that does not exist throws, like Web Audio", () => {
    const context = new FakeAudioContext();
    expect(() => context.createGain().disconnect(context.destination)).toThrow(/InvalidAccessError/);
  });

  it("timers run in time order with the context clock", async () => {
    const context = new FakeAudioContext();
    const seen: string[] = [];
    context.clock.setTimeout(() => seen.push(`b@${context.currentTime.toFixed(2)}`), 300);
    context.clock.setTimeout(() => seen.push(`a@${context.currentTime.toFixed(2)}`), 120);
    await context.advance(1);
    expect(seen).toEqual(["a@0.12", "b@0.30"]);
  });
});
