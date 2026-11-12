import { describe, expect, it } from "vitest";

import { FRAME_SAMPLES, framesFrom, isCaptureAudioMessage, isPlayerAudioMessage } from "./playerAudio";

const samples = () => new Float32Array(FRAME_SAMPLES);

describe("player audio channel messages (OUT-5, PRV-1)", () => {
  it("accepts room frames, preview frames and device choices", () => {
    expect(isPlayerAudioMessage({ kind: "room", room: "bot-a", index: 3, samples: samples() })).toBe(true);
    expect(isPlayerAudioMessage({ kind: "preview", index: 0, samples: samples() })).toBe(true);
    expect(isPlayerAudioMessage({ kind: "preview-sink", id: 1, deviceId: "" })).toBe(true);
  });

  it.each([
    null,
    "room",
    { kind: "room", room: "", index: 0, samples: samples() },
    { kind: "room", room: "x".repeat(65), index: 0, samples: samples() },
    { kind: "room", room: "bot-a", index: -1, samples: samples() },
    { kind: "room", room: "bot-a", index: 0, samples: new Float32Array(10) },
    { kind: "room", room: "bot-a", index: 0, samples: Array.from(samples()) },
    { kind: "preview", index: 1.5, samples: samples() },
    { kind: "preview-sink", id: 1, deviceId: "x".repeat(257) },
    { kind: "broadcast", active: true },
    { kind: "room-frames", room: "bot-a" },
    { kind: "room-frames", room: "", port: { postMessage() {}, close() {} } },
    { kind: "room-frames", room: "bot-a", port: {} },
    { kind: "preview-frames", port: "port" },
  ])("drops %j", (message) => {
    expect(isPlayerAudioMessage(message)).toBe(false);
  });

  it("accepts only the capture window's two answers", () => {
    expect(isCaptureAudioMessage({ kind: "broadcast", active: false })).toBe(true);
    expect(isCaptureAudioMessage({ kind: "preview-sink-done", id: 2, error: "Gone" })).toBe(true);
    expect(isCaptureAudioMessage({ kind: "broadcast", active: "yes" })).toBe(false);
    expect(isCaptureAudioMessage({ kind: "room" })).toBe(false);
  });

  it("accepts a room's or the preview's own frames channel (w51-audio)", () => {
    const port = { postMessage() {}, close() {}, onmessage: null as unknown };
    expect(isPlayerAudioMessage({ kind: "room-frames", room: "bot-a", port })).toBe(true);
    expect(isPlayerAudioMessage({ kind: "preview-frames", port })).toBe(true);
  });

  it("reads frames as the PCM worklet posts them on a frames channel, and nothing odd (w51-audio)", () => {
    const frame = { index: 4, samples: samples(), last: true };
    expect(framesFrom([frame])).toEqual([frame]);
    expect(framesFrom([{ index: 5, samples: samples() }])).toEqual([{ index: 5, samples: expect.any(Float32Array), last: false }]);
    for (const odd of [null, frame, [], [{ index: -1, samples: samples() }], [{ index: 1, samples: new Float32Array(3) }], new Array(11).fill(frame)]) {
      expect(framesFrom(odd)).toEqual([]);
    }
  });
});
