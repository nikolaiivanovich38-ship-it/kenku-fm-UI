import { describe, expect, it, vi } from "vitest";

import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { FakeOutputs, TABLE_BOT } from "./testing/fakeOutputs";
import type { RoomToRestore } from "../screens/outputs/outputsModel";
import { restoreRoom } from "./roomRestore";

const KICKED: RoomToRestore = {
  botId: TABLE_BOT,
  channelId: "1011",
  lanes: [
    { trackId: "t-anthem", fromMs: 42500, from: { playlistId: "p-company" }, place: undefined },
    { trackId: "a-rain", fromMs: 3000, from: undefined, place: undefined },
  ],
};

const roomOf = (roomId: string) => ({ roomId, name: "Table", music: null as never, ambience: null as never, upNext: null as never, queued: [] as never[], effects: [] as never[] });

describe("Undo of a Kick (OUT-7): the bot goes back to its channel, then its room plays again from where it was", () => {
  it("sends the bot back and, once its room is there, plays each lane in that room from its place", async () => {
    const outputs = new FakeOutputs();
    outputs.leave(TABLE_BOT);
    const audio = new FakeLyreAudio();
    const done = restoreRoom(KICKED, { client: outputs, audio, waitMs: 1000 });
    expect(outputs.calls).toContainEqual(["move", TABLE_BOT, "1011"]);
    expect(audio.calls.filter(([m]) => m === "playTrack")).toEqual([]);
    audio.setNowPlaying({ rooms: [roomOf(TABLE_BOT)] });
    expect(await done).toBe(true);
    expect(audio.calls.filter(([m]) => m === "playTrack")).toEqual([
      ["playTrack", "t-anthem", { target: { room: TABLE_BOT }, from: { playlistId: "p-company" }, fromMs: 42500, fadeMs: 1000 }],
      ["playTrack", "a-rain", { target: { room: TABLE_BOT }, fromMs: 3000, fadeMs: 1000 }],
    ]);
  });

  it("plays at once when the room is there already, and gives up quietly when it never comes back", async () => {
    vi.useFakeTimers();
    try {
      const audio = new FakeLyreAudio();
      const never = restoreRoom(KICKED, { client: new FakeOutputs(), audio, waitMs: 1000 });
      await vi.advanceTimersByTimeAsync(1100);
      expect(await never).toBe(false);
      expect(audio.calls.some(([m]) => m === "playTrack")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const audio = new FakeLyreAudio();
    audio.setNowPlaying({ rooms: [roomOf(TABLE_BOT)] });
    expect(await restoreRoom({ ...KICKED, lanes: [KICKED.lanes[0]] }, { client: new FakeOutputs(), audio, waitMs: 1000 })).toBe(true);
    expect(audio.calls.filter(([m]) => m === "playTrack")).toHaveLength(1);
  });

  it("w51-fix2: leaves a lane alone that still plays the same track in the room (the music went on at the table)", async () => {
    const audio = new FakeLyreAudio();
    audio.setNowPlaying({ rooms: [{ ...roomOf(TABLE_BOT), music: { trackId: "t-anthem", paused: false } as never }] });
    expect(await restoreRoom(KICKED, { client: new FakeOutputs(), audio, waitMs: 1000 })).toBe(true);
    expect(audio.calls.filter(([m]) => m === "playTrack")).toEqual([["playTrack", "a-rain", { target: { room: TABLE_BOT }, fromMs: 3000, fadeMs: 1000 }]]);
  });
});
