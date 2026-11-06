/**
 * Security review w4, Should 4: one volume per room, the bot's; the audio host's level only for the table and for a
 * page without the Outputs bridge.
 */
import { describe, expect, it } from "vitest";

import { roomVolumeControl } from "./roomVolume";
import { FakeOutputs, TABLE_BOT } from "./testing/fakeOutputs";

function audio() {
  const calls: unknown[][] = [];
  return { calls, setRoomVolume: (target: { room: string }, volume: number) => calls.push([target, volume]) };
}

describe("a room's volume slider", () => {
  it("in a bot's room shows and changes the bot's volume, never the audio host's level", () => {
    const client = new FakeOutputs();
    const host = audio();
    const control = roomVolumeControl({ roomId: TABLE_BOT, level: 1 }, { id: TABLE_BOT, volume: 0.85 }, client, host);
    expect(control.volume).toBe(85);
    control.change(40);
    expect(client.calls).toContainEqual(["setVolume", TABLE_BOT, 0.4]);
    expect(host.calls).toEqual([]);
  });

  it("in a bot's room before the main process has said its volume, changes nothing (it would stay quieter than shown)", () => {
    const client = new FakeOutputs();
    const host = audio();
    const control = roomVolumeControl({ roomId: TABLE_BOT, level: 1 }, null, client, host);
    expect(control.volume).toBe(100);
    control.change(40);
    expect(host.calls).toEqual([]);
    expect(client.calls.filter(([m]) => m === "setVolume")).toEqual([]);
  });

  it("at the table, and on a page without the Outputs bridge, is the audio host's level", () => {
    const client = new FakeOutputs();
    const host = audio();
    const table = roomVolumeControl({ roomId: "table", level: 0.4 }, null, client, host);
    expect(table.volume).toBe(40);
    table.change(60);
    const bare = roomVolumeControl({ roomId: "side", level: 0.5 }, null, null, host);
    expect(bare.volume).toBe(50);
    bare.change(30);
    expect(host.calls).toEqual([
      [{ room: "table" }, 0.6],
      [{ room: "side" }, 0.3],
    ]);
  });
});
