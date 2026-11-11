import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room } from "../../common/domain";
import { FRAME_SAMPLES, type AudioPortLike } from "../../common/playerAudio";
import { FakeAudioContext, FakeGain } from "../testing/fakeAudio";
import { createBridgedPreviewOutput, PlayerAudioLink, RoomStreams, type FrameTap, type TapFrame } from "./index";
import { RoomMixer } from "./roomMixer";

const TABLE: Room = { botId: "bot-a", name: "Tavern" };
const SIDE: Room = { botId: "bot-b", name: "Dungeon" };

/** A fake MessagePort: records what is posted; `deliver` plays the capture window's side. */
class FakePort implements AudioPortLike {
  posted: { message: Record<string, unknown>; transfer?: Transferable[] }[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  started = false;
  postMessage(message: unknown, transfer?: Transferable[]) {
    if (this.closed) {
      throw new Error("posted on a closed port");
    }
    this.posted.push({ message: message as Record<string, unknown>, transfer });
  }
  start() {
    this.started = true;
  }
  close() {
    this.closed = true;
  }
  deliver(data: unknown) {
    this.onmessage?.({ data });
  }
  kinds() {
    return this.posted.map(({ message }) => message.kind);
  }
}

/** Taps made by the streams, in order; a test makes one "post" a frame. */
type FakeTap = FrameTap & { emit(frame?: Partial<TapFrame>): void; disposed: boolean; context: FakeAudioContext };

let context: FakeAudioContext;
let mixer: RoomMixer;
let link: PlayerAudioLink;
let port: FakePort;
let taps: FakeTap[];

function tapFactory(tapContext: FakeAudioContext) {
  return (onFrame: (frame: TapFrame) => void): FrameTap => {
    const input = tapContext.createGain();
    const tap: FakeTap = {
      input,
      context: tapContext,
      disposed: false,
      emit: (frame = {}) => onFrame({ index: 0, samples: new Float32Array(FRAME_SAMPLES), ...frame }),
      dispose: () => {
        tap.disposed = true;
        input.disconnect();
      },
    };
    taps.push(tap);
    return tap;
  };
}

/** The tap fed by a node, if any. */
const tapOf = (node: unknown) => taps.find((tap) => !tap.disposed && (node as FakeGain).outputs.has(tap.input as FakeGain));

beforeEach(() => {
  context = new FakeAudioContext();
  mixer = new RoomMixer(context);
  link = new PlayerAudioLink();
  port = new FakePort();
  taps = [];
});

function streams() {
  const result = new RoomStreams({ mixer, link, createTap: tapFactory(context) });
  link.connect(port);
  return result;
}

describe("RoomStreams (OUT-5): each engine room's mix goes to its own room in the capture window", () => {
  it("sends nothing and taps nothing until the capture window says a bot is in a voice channel", () => {
    streams();
    mixer.setRooms([TABLE, SIDE]);
    expect(taps).toEqual([]);
    expect(port.posted).toEqual([]);
    expect(port.started).toBe(true);
  });

  it("taps every room's output while broadcasting and labels each frame with its room", () => {
    streams();
    mixer.setRooms([TABLE, SIDE]);
    port.deliver({ kind: "broadcast", active: true });

    const side = tapOf(mixer.output(SIDE.botId))!;
    const samples = new Float32Array(FRAME_SAMPLES);
    side.emit({ index: 7, samples });
    tapOf(mixer.output(TABLE.botId))!.emit({ index: 7 });

    expect(port.posted.map(({ message }) => [message.kind, message.room, message.index])).toEqual([
      ["room", SIDE.botId, 7],
      ["room", TABLE.botId, 7],
    ]);
    // The samples move to the capture window without a copy.
    expect(port.posted[0].message.samples).toBe(samples);
    expect(port.posted[0].transfer).toEqual([samples.buffer]);
  });

  it("follows rooms that come and go during a broadcast", () => {
    streams();
    mixer.setRooms([TABLE]);
    port.deliver({ kind: "broadcast", active: true });
    mixer.setRooms([TABLE, SIDE]);
    const side = tapOf(mixer.output(SIDE.botId))!;
    expect(side).toBeDefined();
    mixer.setRooms([TABLE]);
    expect(side.disposed).toBe(true);
    side.emit();
    expect(port.posted).toEqual([]);
  });

  it("never taps the table while no bot is in a voice channel", () => {
    streams();
    port.deliver({ kind: "broadcast", active: true });
    expect(taps).toEqual([]);
  });

  it("removes every tap when the broadcast stops, and says so", () => {
    const result = streams();
    const changes: boolean[] = [];
    result.on("broadcast", (active) => changes.push(active));
    mixer.setRooms([TABLE, SIDE]);
    port.deliver({ kind: "broadcast", active: true });
    port.deliver({ kind: "broadcast", active: false });
    expect(taps.every((tap) => tap.disposed)).toBe(true);
    expect(changes).toEqual([true, false]);
    expect(result.broadcasting).toBe(false);
  });

  it("starts over on a new channel (the capture window reloaded): old end closed, waits to be told again", () => {
    streams();
    mixer.setRooms([TABLE]);
    port.deliver({ kind: "broadcast", active: true });
    const next = new FakePort();
    link.connect(next);
    expect(port.closed).toBe(true);
    expect(taps.every((tap) => tap.disposed)).toBe(true);
    next.deliver({ kind: "broadcast", active: true });
    tapOf(mixer.output(TABLE.botId))!.emit();
    expect(next.kinds()).toEqual(["room"]);
  });

  it("ignores odd messages from the channel", () => {
    streams();
    mixer.setRooms([TABLE]);
    for (const odd of [null, "broadcast", { kind: "broadcast", active: 1 }, { kind: "room" }]) {
      port.deliver(odd);
    }
    expect(taps).toEqual([]);
  });

  it("stops everything when disposed", () => {
    const result = streams();
    mixer.setRooms([TABLE]);
    port.deliver({ kind: "broadcast", active: true });
    result.dispose();
    expect(taps.every((tap) => tap.disposed)).toBe(true);
    mixer.setRooms([TABLE, SIDE]);
    expect(taps.filter((tap) => !tap.disposed)).toEqual([]);
  });
});

describe("Bridged preview (PRV-1): the preview is heard only through the capture window", () => {
  let previewContext: FakeAudioContext;

  function preview() {
    previewContext = new FakeAudioContext();
    const output = createBridgedPreviewOutput({
      context: previewContext,
      link,
      createTap: tapFactory(previewContext),
    });
    link.connect(port);
    return output;
  }

  it("sends preview frames as preview, never as a room, broadcasting or not", () => {
    preview();
    taps[0].emit({ index: 2 });
    port.deliver({ kind: "broadcast", active: true });
    taps[0].emit({ index: 3 });
    expect(port.posted.map(({ message }) => [message.kind, message.room])).toEqual([
      ["preview", undefined],
      ["preview", undefined],
    ]);
  });

  it("leads only to its tap: nothing in the preview's own context plays on the page", () => {
    const output = preview();
    expect((output.input as FakeGain).outputs).toEqual(new Set([taps[0].input]));
    expect(previewContext.reaches(output.input as FakeGain, previewContext.destination)).toBe(false);
  });

  it("cannot be wired into a room: it lives in a context of its own", () => {
    const output = preview();
    mixer.setRooms([TABLE]);
    expect(() => (output.input as FakeGain).connect(mixer.getRoomBus(TABLE.botId, "music"))).toThrow(/different audio contexts/);
  });

  it("drops preview frames while there is no channel instead of failing", () => {
    previewContext = new FakeAudioContext();
    createBridgedPreviewOutput({ context: previewContext, link, createTap: tapFactory(previewContext) });
    expect(() => taps[0].emit()).not.toThrow();
  });

  it("asks the capture window to play the preview on another device (PRV-2)", async () => {
    const output = preview();
    const chosen = output.setSinkId("speakers-2");
    const request = port.posted.find(({ message }) => message.kind === "preview-sink")!.message;
    expect(request).toMatchObject({ deviceId: "speakers-2" });
    port.deliver({ kind: "preview-sink-done", id: request.id });
    await expect(chosen).resolves.toBeUndefined();

    const refused = output.setSinkId("gone");
    const second = port.posted.filter(({ message }) => message.kind === "preview-sink")[1].message;
    port.deliver({ kind: "preview-sink-done", id: second.id, error: "That device is not connected." });
    await expect(refused).rejects.toThrow("That device is not connected.");
  });

  it("says plainly when the device cannot be chosen yet (no channel), or no answer comes", async () => {
    vi.useFakeTimers();
    try {
      previewContext = new FakeAudioContext();
      const output = createBridgedPreviewOutput({ context: previewContext, link, createTap: tapFactory(previewContext) });
      await expect(output.setSinkId("x")).rejects.toThrow(/not ready/i);
      link.connect(port);
      const waiting = output.setSinkId("x");
      const assertion = expect(waiting).rejects.toThrow(/did not answer/i);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops sending once closed", async () => {
    const output = preview();
    await output.close();
    expect(taps[0].disposed).toBe(true);
  });
});
