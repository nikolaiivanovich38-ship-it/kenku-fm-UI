import { beforeAll, describe, expect, it } from "vitest";

/** One posted frame: its number since the start and its planar samples. */
type Frame = { index: number; samples: Float32Array; last: boolean };
type Processor = {
  process(inputs: Float32Array[][]): boolean;
  port: { postMessage(message: Frame[], transfer?: unknown[]): void };
};
type ProcessorClass = new (options?: { processorOptions?: { framesPerMessage?: number } }) => Processor;

let PCMStream: ProcessorClass;

beforeAll(async () => {
  // The audio thread's globals, as the worklet sees them.
  class AudioWorkletProcessor {
    port = { postMessage: (): void => undefined };
  }
  Object.assign(globalThis, {
    AudioWorkletProcessor,
    registerProcessor: (_name: string, processor: ProcessorClass) => {
      PCMStream = processor;
    },
  });
  // The worklet is a script, not a module; importing it runs it.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("./PCMStream.worklet.js");
});

const QUANTUM = 128;

/** A processor that records what it posts. */
function processor(framesPerMessage?: number) {
  const node = new PCMStream({ processorOptions: { framesPerMessage } });
  const messages: Frame[][] = [];
  node.port = { postMessage: (message) => messages.push(message) };
  return { node, messages };
}

/** Feed `quanta` render quanta of a constant value (0 = silence) in stereo. */
function feed(node: Processor, quanta: number, value: number, channels = 2) {
  for (let i = 0; i < quanta; i++) {
    const input = Array.from({ length: channels }, () => new Float32Array(QUANTUM).fill(value));
    node.process([input]);
  }
}

/** 20 ms = 960 samples = 7.5 render quanta; 15 quanta make exactly two frames. */
const TWO_FRAMES = 15;

describe("PCMStream worklet (PERF-4)", () => {
  it("posts 20 ms planar frames of 960 samples per channel", () => {
    const { node, messages } = processor();
    feed(node, TWO_FRAMES, 0.5);
    expect(messages).toHaveLength(2);
    expect(messages[0][0].index).toBe(0);
    expect(messages[1][0].index).toBe(1);
    expect(messages[0][0].samples).toHaveLength(1920);
    expect(messages[0][0].samples.every((sample) => sample === 0.5)).toBe(true);
  });

  it("keeps left and right apart", () => {
    const { node, messages } = processor();
    for (let i = 0; i < TWO_FRAMES; i++) {
      node.process([[new Float32Array(QUANTUM).fill(0.25), new Float32Array(QUANTUM).fill(-0.25)]]);
    }
    const { samples } = messages[0][0];
    expect(samples.slice(0, 960).every((sample) => sample === 0.25)).toBe(true);
    expect(samples.slice(960).every((sample) => sample === -0.25)).toBe(true);
  });

  it("sends a mono source to both channels", () => {
    const { node, messages } = processor();
    feed(node, TWO_FRAMES, 0.5, 1);
    expect(messages[0][0].samples.every((sample) => sample === 0.5)).toBe(true);
  });

  it("posts nothing while everything is silent or nothing is connected", () => {
    const { node, messages } = processor();
    feed(node, 75, 0);
    for (let i = 0; i < 75; i++) {
      node.process([[]]);
    }
    expect(messages).toEqual([]);
  });

  it("posts one silent frame after a sound so the encoder can finish it, then stops", () => {
    const { node, messages } = processor();
    feed(node, TWO_FRAMES, 0.5);
    feed(node, 75, 0);
    expect(messages.flat().map((frame) => frame.index)).toEqual([0, 1, 2]);
    // The silent frame is marked as the end of the sound.
    expect(messages.flat().map((frame) => frame.last)).toEqual([false, false, true]);
    feed(node, TWO_FRAMES, 0.5);
    // Frame numbers follow the clock, so the gap shows.
    expect(messages.flat().map((frame) => frame.index)).toEqual([0, 1, 2, 12, 13]);
  });

  it("can collect several frames per message", () => {
    const { node, messages } = processor(2);
    feed(node, TWO_FRAMES * 2, 0.5);
    expect(messages.map((message) => message.length)).toEqual([2, 2]);
  });

  it("sends a part-filled batch at once when the sound stops", () => {
    const { node, messages } = processor(25);
    feed(node, TWO_FRAMES, 0.5);
    expect(messages).toEqual([]);
    feed(node, TWO_FRAMES * 2, 0);
    expect(messages.map((message) => message.length)).toEqual([3]);
  });
});
