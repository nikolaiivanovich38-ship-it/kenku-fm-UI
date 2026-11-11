import { describe, expect, it, vi } from "vitest";

import { FakeAudioContext, FakeBuffer, FakeGain } from "../testing/fakeAudio";
import { RoomMixer, TABLE_ROOM } from "./index";
import { roomsAudioFrom } from "./roomsAudio";

/** The show engine (queue/director) sees the Rooms stream's mixer through roomsAudioFrom. */
describe("the engine's view of the rooms", () => {
  function setup() {
    const context = new FakeAudioContext();
    const mixer = new RoomMixer(context);
    return { context, mixer, audio: roomsAudioFrom(mixer) };
  }
  function play(context: FakeAudioContext, node: unknown) {
    const s = context.createBufferSource();
    s.buffer = new FakeBuffer(600);
    s.connect(node as FakeGain);
    s.start(context.currentTime);
  }

  it("lists the table while no bot is in a voice channel, so scenes always have a room", () => {
    const { audio } = setup();
    expect(audio.rooms()).toEqual([{ botId: TABLE_ROOM, name: "Table" }]);
  });

  it("lists the bots' rooms once they join, the first being where scenes play", () => {
    const { mixer, audio } = setup();
    mixer.setRooms([{ botId: "b1", name: "Table" }, { botId: "b2", name: "Side room" }]);
    expect(audio.rooms().map((r) => r.botId)).toEqual(["b1", "b2"]);
  });

  it("maps the engine's lanes onto each room's music, ambience and effects buses", () => {
    const { context, mixer, audio } = setup();
    mixer.setRooms([{ botId: "b1", name: "Table" }, { botId: "b2", name: "Side room" }]);
    play(context, audio.getRoomBus("b2", "ambience"));
    expect(context.signalAt(mixer.output("b2") as FakeGain)).toBeGreaterThan(0);
    expect(context.signalAt(mixer.output("b1") as FakeGain)).toBe(0);
  });

  it("tells the engine when rooms come and go, and stops telling it after unsubscribing", () => {
    const { mixer, audio } = setup();
    const heard = vi.fn();
    const off = audio.onRoomsChanged(heard);
    mixer.setRooms([{ botId: "b1", name: "Table" }]);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    mixer.setRooms([]);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
