import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Lane, Room } from "../../../common/domain";
import { FakeAudioContext, FakeBuffer, FakeBufferSource, FakeGain } from "../testing/fakeAudio";
import { ROOM_LANES, RoomMixer, TABLE_ROOM } from "./index";

let context: FakeAudioContext;
let rooms: RoomMixer;

const TABLE: Room = { botId: "bot-a", name: "Table" };
const SIDE: Room = { botId: "bot-b", name: "Side room" };
const CELLAR: Room = { botId: "bot-c", name: "Cellar" };

/** A sounding source wired into a node, as a voice would be. */
function soundInto(node: unknown): FakeBufferSource {
  const source = context.createBufferSource();
  source.buffer = new FakeBuffer(600);
  source.connect(node as FakeGain);
  source.start(context.currentTime);
  return source;
}

const heard = (roomId: string) => context.signalAt(rooms.output(roomId) as FakeGain);

beforeEach(() => {
  context = new FakeAudioContext();
  rooms = new RoomMixer(context);
});

describe("Rooms (OUT-5): one mix per room", () => {
  it("has music, ambience and effects lanes, as in the design", () => {
    expect(ROOM_LANES).toEqual(["music", "amb", "fx"]);
  });

  it("lists no rooms while no bot is in a voice channel, and still plays on the table", () => {
    expect(rooms.rooms()).toEqual([]);
    soundInto(rooms.getRoomBus(TABLE_ROOM, "music"));
    expect(heard(TABLE_ROOM)).toBeCloseTo(1);
  });

  it("makes a room for every bot in a voice channel, in the bots' order", () => {
    rooms.setRooms([TABLE, SIDE]);
    expect(rooms.rooms()).toEqual([TABLE, SIDE]);
  });

  it.each(["music", "amb", "fx"] as const)("each room's %s lane reaches its own room only", (lane: Lane) => {
    rooms.setRooms([TABLE, SIDE]);
    const bus = rooms.getRoomBus(SIDE.botId, lane) as FakeGain;
    expect(context.reaches(bus, rooms.output(SIDE.botId) as FakeGain)).toBe(true);
    expect(context.reaches(bus, rooms.output(TABLE.botId) as FakeGain)).toBe(false);
  });

  it("mixes a room's three lanes into its master", () => {
    rooms.setRooms([TABLE, SIDE]);
    for (const lane of ROOM_LANES) {
      soundInto(rooms.getRoomBus(SIDE.botId, lane));
    }
    soundInto(rooms.getRoomBus(TABLE.botId, "music"));
    expect(heard(SIDE.botId)).toBeCloseTo(3);
    expect(heard(TABLE.botId)).toBeCloseTo(1);
  });

  it("sends 'table' and a room that has gone to the first room, as roomsFor does", () => {
    rooms.setRooms([TABLE, SIDE]);
    expect(rooms.getRoomBus(TABLE_ROOM, "music")).toBe(rooms.getRoomBus(TABLE.botId, "music"));
    expect(rooms.getRoomBus("bot-gone", "fx")).toBe(rooms.getRoomBus(TABLE.botId, "fx"));
  });

  it("keeps what was playing on the table when the first bot joins (it becomes that room)", () => {
    soundInto(rooms.getRoomBus(TABLE_ROOM, "amb"));
    rooms.setRooms([TABLE]);
    expect(heard(TABLE.botId)).toBeCloseTo(1);
  });

  it("keeps a room's sound when its bot moves to another channel (same room, new name)", () => {
    rooms.setRooms([TABLE, SIDE]);
    soundInto(rooms.getRoomBus(SIDE.botId, "music"));
    rooms.setRooms([TABLE, { botId: SIDE.botId, name: "Crypt" }]);
    expect(rooms.rooms()[1].name).toBe("Crypt");
    expect(heard(SIDE.botId)).toBeCloseTo(1);
  });

  it("stops a room's sound when its bot leaves, and says so", () => {
    const removed = vi.fn();
    rooms.on("room-removed", removed);
    rooms.setRooms([TABLE, SIDE]);
    const sideBus = rooms.getRoomBus(SIDE.botId, "music") as FakeGain;
    const sideOutput = rooms.output(SIDE.botId) as FakeGain;
    soundInto(sideBus);
    soundInto(rooms.getRoomBus(TABLE.botId, "music"));

    rooms.setRooms([TABLE]);

    expect(removed).toHaveBeenCalledWith(SIDE.botId);
    expect(rooms.rooms()).toEqual([TABLE]);
    expect(context.reaches(sideBus, sideOutput)).toBe(false);
    expect(context.signalAt(sideOutput)).toBe(0);
    expect(heard(TABLE.botId)).toBeCloseTo(1);
  });

  it("goes back to an empty table when the last bot leaves", () => {
    rooms.setRooms([TABLE]);
    soundInto(rooms.getRoomBus(TABLE.botId, "music"));
    rooms.setRooms([]);
    expect(rooms.rooms()).toEqual([]);
    expect(heard(TABLE_ROOM)).toBe(0);
  });

  it("tells listeners when the rooms change, not when nothing did", () => {
    const changed = vi.fn();
    rooms.on("rooms", changed);
    rooms.setRooms([TABLE]);
    rooms.setRooms([{ ...TABLE }]);
    rooms.setRooms([TABLE, SIDE]);
    expect(changed.mock.calls).toEqual([[[TABLE]], [[TABLE, SIDE]]]);
  });

  it("refuses room ids that would clash with the table or the preview", () => {
    expect(() => rooms.setRooms([{ botId: TABLE_ROOM, name: "x" }])).toThrow(/room id/i);
    expect(() => rooms.setRooms([{ botId: "preview", name: "x" }])).toThrow(/room id/i);
    expect(() => rooms.setRooms([TABLE, { ...TABLE }])).toThrow(/twice/i);
  });

  it("does not connect room outputs anywhere: the host decides where each goes", () => {
    rooms.setRooms([TABLE, SIDE]);
    for (const room of [TABLE, SIDE]) {
      expect((rooms.output(room.botId) as FakeGain).outputs.size).toBe(0);
    }
  });
});

describe("Room master and lanes: volume and mute (PLY-5)", () => {
  beforeEach(() => rooms.setRooms([TABLE, SIDE]));

  it("a room's master volume scales that room only", async () => {
    soundInto(rooms.getRoomBus(TABLE.botId, "music"));
    soundInto(rooms.getRoomBus(SIDE.botId, "music"));
    rooms.setLevel(SIDE.botId, "master", 0.25);
    await context.advance(0.1);
    expect(heard(SIDE.botId)).toBeCloseTo(0.25);
    expect(heard(TABLE.botId)).toBeCloseTo(1);
  });

  it("lane and master levels multiply", async () => {
    soundInto(rooms.getRoomBus(SIDE.botId, "amb"));
    rooms.setLevel(SIDE.botId, "amb", 0.5);
    rooms.setLevel(SIDE.botId, "master", 0.4);
    await context.advance(0.1);
    expect(heard(SIDE.botId)).toBeCloseTo(0.2);
  });

  it("mute silences a room and unmute brings its volume back", async () => {
    soundInto(rooms.getRoomBus(SIDE.botId, "fx"));
    rooms.setLevel(SIDE.botId, "master", 0.6);
    rooms.setMuted(SIDE.botId, "master", true);
    await context.advance(0.1);
    expect(heard(SIDE.botId)).toBeCloseTo(0);
    expect(rooms.levels(SIDE.botId).master).toEqual({ level: 0.6, muted: true });
    rooms.setMuted(SIDE.botId, "master", false);
    await context.advance(0.1);
    expect(heard(SIDE.botId)).toBeCloseTo(0.6);
  });

  it("keeps levels between 0 and 1 and refuses anything not a number", () => {
    rooms.setLevel(SIDE.botId, "music", 4);
    expect(rooms.levels(SIDE.botId).music.level).toBe(1);
    expect(() => rooms.setLevel(SIDE.botId, "music", Number.NaN)).toThrow(/level/i);
  });

  it("keeps the table's levels when the first bot joins", () => {
    rooms.setRooms([]);
    rooms.setLevel(TABLE_ROOM, "master", 0.3);
    rooms.setRooms([TABLE]);
    expect(rooms.levels(TABLE.botId).master.level).toBe(0.3);
  });

  it("tells listeners which room's levels changed", () => {
    const listener = vi.fn();
    rooms.on("levels", listener);
    rooms.setMuted(SIDE.botId, "music", true);
    expect(listener).toHaveBeenCalledWith(SIDE.botId, expect.objectContaining({ music: { level: 1, muted: true } }));
  });
});

describe("Preview bus (PRV-1): never reaches a room", () => {
  /** Every node a room's sound can pass through, for every room there is now. */
  function roomOutputs(): FakeGain[] {
    const ids = rooms.rooms().length ? rooms.rooms().map((room) => room.botId) : [TABLE_ROOM];
    return ids.map((id) => rooms.output(id) as FakeGain);
  }

  function expectIsolated() {
    const preview = rooms.preview.input as FakeGain;
    for (const output of roomOutputs()) {
      expect(context.reaches(preview, output)).toBe(false);
      expect(context.signalAt(output)).toBe(0);
    }
    expect(context.signalAt(rooms.preview.output as FakeGain)).toBeGreaterThan(0);
  }

  it("preview plays only on the preview output, whatever rooms come and go", () => {
    soundInto(rooms.preview.input);
    expectIsolated();
    rooms.setRooms([TABLE]);
    expectIsolated();
    rooms.setRooms([TABLE, SIDE, CELLAR]);
    expectIsolated();
    rooms.setRooms([{ botId: SIDE.botId, name: "Moved" }]);
    expectIsolated();
    rooms.setRooms([]);
    expectIsolated();
  });

  it("no room lane is the preview bus, and 'preview' is not a lane", () => {
    rooms.setRooms([TABLE, SIDE]);
    for (const room of [TABLE_ROOM, TABLE.botId, SIDE.botId, "bot-gone"]) {
      for (const lane of ROOM_LANES) {
        const bus = rooms.getRoomBus(room, lane) as FakeGain;
        expect(bus).not.toBe(rooms.preview.input);
        expect(context.reaches(bus, rooms.preview.output as FakeGain)).toBe(false);
      }
    }
    expect(() => rooms.getRoomBus(TABLE.botId, "preview" as Lane)).toThrow(/lane/i);
  });

  it("room volume and mute leave the preview alone", async () => {
    soundInto(rooms.preview.input);
    rooms.setRooms([TABLE]);
    rooms.setMuted(TABLE.botId, "master", true);
    await context.advance(0.1);
    expect(context.signalAt(rooms.preview.output as FakeGain)).toBeCloseTo(1);
  });

  it("the preview output is not connected anywhere until the host connects it", () => {
    expect((rooms.preview.output as FakeGain).outputs.size).toBe(0);
  });
});

describe("RoomMixer dispose", () => {
  it("disconnects every node it made", () => {
    const baseline = context.connectedNodeCount();
    const extra = new RoomMixer(context);
    extra.setRooms([TABLE, SIDE]);
    expect(context.connectedNodeCount()).toBeGreaterThan(baseline);
    extra.dispose();
    expect(context.connectedNodeCount()).toBe(baseline);
  });

  it("frees a room's nodes when its bot leaves (no leak over a long session)", () => {
    rooms.setRooms([TABLE]);
    const baseline = context.connectedNodeCount();
    for (let i = 0; i < 20; i++) {
      rooms.setRooms([TABLE, SIDE]);
      rooms.setRooms([TABLE]);
    }
    expect(context.connectedNodeCount()).toBe(baseline);
  });
});
