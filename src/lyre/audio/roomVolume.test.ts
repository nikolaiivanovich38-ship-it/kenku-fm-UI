/**
 * UX-16: each room's volume, the one the Now playing bar, Live's room box and Outputs show (core.js: a room's
 * volume slider, 0 to 100 in steps of 5). It is the room's mix level, so the players hear it (never this computer, BUG-19), and
 * it is kept per room while the app runs.
 */
import { describe, expect, it } from "vitest";

import type { Room } from "../../common/domain";
import { ROOM_START_VOLUME } from "./lyreAudio";
import { lyreAudioOnFakes, testTrack, type AudioTestData } from "./testing/onFakes";

const TAVERN: Room = { botId: "bot-a", name: "Tavern" };
const DUNGEON: Room = { botId: "bot-b", name: "Dungeon" };

const data = (): AudioTestData => ({ tracks: [testTrack("m1", 60)], playlists: [], campaigns: [] });

describe("room volume", () => {
  it("rooms start at the design's starting volume, 85, leaving room to turn one up", () => {
    expect(ROOM_START_VOLUME).toBe(0.85);
    const rig = lyreAudioOnFakes(data(), { startRoomVolume: ROOM_START_VOLUME });
    expect(rig.audio.getNowPlaying().rooms[0]).toMatchObject({ roomId: "table", volume: 0.85 });
  });

  it("is the room's mix level: what the room plays follows it", async () => {
    const rig = lyreAudioOnFakes(data());
    rig.audio.playTrack("m1");
    await rig.advance(4);
    expect(rig.hearRoom("table")).toBeCloseTo(1);
    expect(rig.audio.setRoomVolume({ room: "table" }, 0.5)).toEqual({ ok: true });
    await rig.advance(1);
    expect(rig.hearRoom("table")).toBeCloseTo(0.5);
    expect(rig.audio.getNowPlaying().rooms[0].volume).toBe(0.5);
  });

  it("a volume chosen before the first bot joins stays with the table: the bot's room plays at its own volume (security review w4, Should 4)", async () => {
    // The review's probe: the table at 40, a track plays, a bot joins. The room played at 0.40 while every slider
    // showed the bot's volume (100), so nothing could turn it back up.
    const rig = lyreAudioOnFakes(data());
    rig.audio.setRoomVolume({ room: "table" }, 0.4);
    rig.audio.playTrack("m1");
    await rig.advance(4);
    expect(rig.hearRoom("table")).toBeCloseTo(0.4);
    rig.setRooms([TAVERN]);
    await rig.advance(2);
    expect(rig.hearRoom("bot-a")).toBeCloseTo(1);
    expect(rig.audio.getNowPlaying().rooms[0]).toMatchObject({ roomId: "bot-a", volume: 1 });
    // The bot leaves: the table is as it was.
    rig.setRooms([]);
    expect(rig.audio.getNowPlaying().rooms[0]).toMatchObject({ roomId: "table", volume: 0.4 });
  });

  it("is kept per room", async () => {
    const rig = lyreAudioOnFakes(data());
    rig.audio.setRoomVolume({ room: "table" }, 0.6);
    rig.setRooms([TAVERN, DUNGEON]);
    await rig.advance(1);
    expect(rig.audio.getNowPlaying().rooms.map((r) => [r.roomId, r.volume])).toEqual([
      ["bot-a", 1],
      ["bot-b", 1],
    ]);
    rig.audio.setRoomVolume({ room: "bot-b" }, 0.3);
    rig.audio.playTrack("m1", { target: { room: "bot-b" } });
    await rig.advance(4);
    expect(rig.hearRoom("bot-b")).toBeCloseTo(0.3);
    // The Dungeon's bot leaves and comes back: its volume is as it was.
    rig.setRooms([TAVERN]);
    rig.setRooms([TAVERN, DUNGEON]);
    expect(rig.audio.getNowPlaying().rooms[1].volume).toBe(0.3);
  });

  it("every room at once, and only from 0 to 1", () => {
    const rig = lyreAudioOnFakes(data());
    rig.setRooms([TAVERN, DUNGEON]);
    rig.audio.setRoomVolume("all", 1.7);
    expect(rig.audio.getNowPlaying().rooms.map((r) => r.volume)).toEqual([1, 1]);
    rig.audio.setRoomVolume("all", -1);
    expect(rig.audio.getNowPlaying().rooms.map((r) => r.volume)).toEqual([0, 0]);
  });

  it("refuses a volume that is not a number, in plain words", () => {
    const rig = lyreAudioOnFakes(data());
    const errors: string[] = [];
    rig.audio.on("error", (message) => errors.push(message));
    expect(rig.audio.setRoomVolume({ room: "table" }, Number.NaN)).toEqual({ ok: false, message: "That volume is not a number from 0 to 100." });
    expect(errors).toEqual(["That volume is not a number from 0 to 100."]);
  });
});
