import { describe, expect, it } from "vitest";

import { DEVICE_CLOCK_LEVEL, keepDeviceClock, type ClockContext } from "./deviceClock";

/** Just enough of an AudioContext: one constant source, and whether it reaches the speakers. */
function fakeContext() {
  const destination = {};
  const sources: { offset: { value: number }; started: number; stopped: number; connectedTo: unknown[] }[] = [];
  const context: ClockContext = {
    destination: destination as AudioDestinationNode,
    createConstantSource: () => {
      const source = {
        offset: { value: 1 },
        started: 0,
        stopped: 0,
        connectedTo: [] as unknown[],
        connect(target: unknown) {
          source.connectedTo.push(target);
          return target;
        },
        disconnect() {
          source.connectedTo = [];
        },
        start() {
          source.started++;
        },
        stop() {
          source.stopped++;
        },
      };
      sources.push(source);
      return source as unknown as ConstantSourceNode;
    },
  };
  return { context, destination, sources };
}

describe("keepDeviceClock (w51-audio): an audio context stays on the sound card's clock while it is needed", () => {
  it("plays a constant far below hearing into the speakers while held, and nothing once let go", () => {
    const { context, destination, sources } = fakeContext();
    const clock = keepDeviceClock(context);
    expect(sources).toEqual([]);
    clock.hold();
    expect(sources).toHaveLength(1);
    expect(sources[0].connectedTo).toEqual([destination]);
    expect(sources[0].offset.value).toBe(DEVICE_CLOCK_LEVEL);
    expect(sources[0].started).toBe(1);
    clock.release();
    expect(sources[0].connectedTo).toEqual([]);
    expect(sources[0].stopped).toBe(1);
  });

  it("is not silent to Chromium, but far below hearing: under the last bit of 24-bit sound (-144 dB)", () => {
    expect(DEVICE_CLOCK_LEVEL).toBeGreaterThan(0);
    expect(20 * Math.log10(DEVICE_CLOCK_LEVEL)).toBeLessThan(-144);
  });

  it("counts holders: it lets go only when every holder has", () => {
    const { context, sources } = fakeContext();
    const clock = keepDeviceClock(context);
    clock.hold();
    clock.hold();
    clock.release();
    expect(sources[0].stopped).toBe(0);
    clock.release();
    expect(sources[0].stopped).toBe(1);
    clock.release();
    clock.hold();
    expect(sources).toHaveLength(2);
    expect(sources[1].started).toBe(1);
  });

  it("does nothing in a context that cannot make a constant source, or has closed", () => {
    const clock = keepDeviceClock({ destination: {} as AudioDestinationNode, createConstantSource: () => { throw new Error("closed"); } });
    expect(() => clock.hold()).not.toThrow();
    expect(() => clock.release()).not.toThrow();
  });
});

/**
 * The reason for the keeper, with numbers. This build machine has no sound card, so the difference cannot be heard or
 * measured here (e2e/audioTiming.spec.ts "coarse timers" passes with and without the keeper); this models what
 * Chromium does on Windows. FakeAudioWorker (media/base/fake_audio_worker.cc), which drives a context on a timer:
 * one buffer per wake-up, and when the wake-up comes later than one buffer, the missed buffers are skipped. Windows
 * wakes timers on 15.625 ms steps unless a program asks for finer ones.
 */
function timerDrivenShare(bufferMs: number, timerStepMs: number, seconds = 10): number {
  let now = 0;
  let nextRead = 0;
  let rendered = 0;
  while (now < seconds * 1000) {
    rendered++;
    let delay = nextRead + bufferMs - now;
    if (delay < 0) delay += bufferMs * (Math.floor(-delay / bufferMs) + 1);
    nextRead = now + delay;
    now = Math.ceil((now + delay) / timerStepMs) * timerStepMs;
  }
  return (rendered * bufferMs) / (seconds * 1000);
}

describe("why Lyre's contexts are kept on the sound card (a model of Chromium's timer, w51-audio)", () => {
  it("before: a 10 ms context on a Windows timer renders about two thirds of real time, so the preview comes in pieces", () => {
    expect(timerDrivenShare(10, 15.625)).toBeCloseTo(0.68, 2);
  });

  it("before: with finer timers (a program asked for 1 ms) nothing is lost, which is why it comes and goes", () => {
    expect(timerDrivenShare(10, 1)).toBe(1);
  });

  it("before: a 20 ms context keeps pace on a Windows timer, but each buffer can come up to 15.6 ms late", () => {
    expect(timerDrivenShare(20, 15.625)).toBe(1);
  });

  it("after: on the sound card every buffer is rendered at the card's pace (no timer, nothing skipped)", () => {
    const { context, destination, sources } = fakeContext();
    keepDeviceClock(context).hold();
    // Not silence, so Chromium's SilentSinkSuspender never moves the context onto the timer.
    expect(sources[0].connectedTo).toEqual([destination]);
    expect(sources[0].offset.value).toBeGreaterThan(0);
  });
});
