/**
 * StableRooms: the Director's room ids over the room mixer (w51-fix2). In the app the main process's first room list
 * can reach the mixer before StableRooms exists, so the first bot's room has no alias: it keeps its own id.
 */
import { describe, expect, it } from "vitest";

import { RoomMixer, TABLE_ROOM } from "../../engine/rooms";
import { FakeAudioContext } from "../../engine/testing/fakeAudio";
import { StableRooms } from "./stableRooms";

const BOT = { botId: "bot-a", name: "Table" };
const SIDE = { botId: "bot-b", name: "Side room" };

describe("StableRooms (w51-fix2)", () => {
  it("a bot already in a room when it starts, leaving and coming back: its room is the bot's again, not the table", () => {
    const mixer = new RoomMixer(new FakeAudioContext());
    mixer.setRooms([BOT]);
    const rooms = new StableRooms(mixer);
    const engineId = rooms.rooms()[0].botId;
    mixer.setRooms([]);
    expect(rooms.rooms().map((r) => r.botId)).toEqual([engineId]);
    expect(rooms.toReal(engineId)).toBe(TABLE_ROOM);
    mixer.setRooms([BOT]);
    expect(rooms.rooms().map((r) => r.botId)).toEqual([engineId]);
    expect(rooms.toReal(engineId)).toBe(BOT.botId);
  });

  it("never gives two rooms one id, and names each by its bot", () => {
    const mixer = new RoomMixer(new FakeAudioContext());
    mixer.setRooms([BOT]);
    const rooms = new StableRooms(mixer);
    mixer.setRooms([]);
    mixer.setRooms([SIDE]);
    mixer.setRooms([SIDE, BOT]);
    const ids = rooms.rooms().map((r) => r.botId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.map((id) => rooms.toReal(id))).toEqual([SIDE.botId, BOT.botId]);
  });
});
