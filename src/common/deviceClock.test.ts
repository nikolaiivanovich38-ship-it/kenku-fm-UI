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
