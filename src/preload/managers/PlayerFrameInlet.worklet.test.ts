import { beforeAll, describe, expect, it } from "vitest";

type Message = { data: unknown };
type Processor = {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  port: { onmessage: ((event: Message) => void) | null; postMessage(message: unknown): void };
};
type ProcessorClass = new (options?: unknown) => Processor;

let Inlet: ProcessorClass;

beforeAll(async () => {
  class AudioWorkletProcessor {
    port: Processor["port"] = { onmessage: null, postMessage: (): void => undefined };
  }
  Object.assign(globalThis, {
    AudioWorkletProcessor,
    registerProcessor: (name: string, processor: ProcessorClass) => {
      if (name === "player-frame-inlet") {
        Inlet = processor;
      }
    },
  });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("./PlayerFrameInlet.worklet.js");
});

const FRAME = 960;
const QUANTUM = 128;

/** A planar stereo 20 ms frame: left all `left`, right all `right`. */
function frame(index: number, left: number, right = left) {
  const samples = new Float32Array(FRAME * 2);
  samples.fill(left, 0, FRAME);
  samples.fill(right, FRAME);
  return { index, samples };
}

/** Render `quanta` quanta; returns every left sample and every right sample played. */
function render(node: Processor, quanta: number) {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < quanta; i++) {
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    expect(node.process([], [out])).toBe(true);
    left.push(...out[0]);
    right.push(...out[1]);
  }
  return { left, right };
}

const send = (node: Processor, data: unknown) => node.port.onmessage?.({ data });

describe("PlayerFrameInlet worklet (OUT-5): plays a room's frames from the player page", () => {
  it("plays nothing until two frames have arrived, so a late frame does not cause a gap", () => {
    const node = new Inlet();
    send(node, frame(0, 0.5));
    expect(render(node, 3).left.every((s) => s === 0)).toBe(true);
    send(node, frame(1, 0.5));
    const { left } = render(node, 15);
    expect(left.filter((s) => s === 0.5)).toHaveLength(FRAME * 2);
  });

  it("keeps the left and right channels apart", () => {
    const node = new Inlet();
    send(node, frame(0, 0.25, -0.25));
    send(node, frame(1, 0.25, -0.25));
    const { left, right } = render(node, 2);
    expect(left[0]).toBe(0.25);
    expect(right[0]).toBe(-0.25);
  });

  it("plays silence when the frames stop, then waits for two again", () => {
    const node = new Inlet();
    send(node, frame(0, 0.5));
    send(node, frame(1, 0.5));
    render(node, 15); // 1920 samples: both frames played
    expect(render(node, 2).left.every((s) => s === 0)).toBe(true);
    send(node, frame(5, 0.3));
    expect(render(node, 2).left.every((s) => s === 0)).toBe(true);
    send(node, frame(6, 0.3));
    expect(render(node, 1).left[0]).toBeCloseTo(0.3);
  });

  it("drops the oldest frames when too many wait, so the delay never grows", () => {
    const node = new Inlet();
    for (let i = 0; i < 30; i++) {
      send(node, frame(i, i / 100));
    }
    // At most 200 ms waits; the oldest were dropped.
    expect(render(node, 1).left[0]).toBeGreaterThanOrEqual(0.2);
  });

  it("ignores anything that is not one stereo 20 ms frame", () => {
    const node = new Inlet();
    for (const odd of [null, "x", { samples: new Float32Array(10) }, { samples: [1, 2] }, frame(0, 0.5).samples]) {
      send(node, odd);
    }
    send(node, frame(0, 0.5));
    expect(render(node, 15).left.every((s) => s === 0)).toBe(true);
  });
});
