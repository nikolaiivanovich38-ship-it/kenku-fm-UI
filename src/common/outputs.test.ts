import { describe, expect, it } from "vitest";

import { roomsOf, type BotState, type VoiceSessionState } from "./outputs";

function bot(id: string, voice: Partial<VoiceSessionState>[] = []): BotState {
  return {
    id,
    name: id,
    hasToken: true,
    tokenRemembered: true,
    status: "ready",
    guilds: [],
    muted: false,
    volume: 1,
    voice: voice.map((session) => ({
      guildId: "1",
      channelId: "901",
      channelName: "Tavern",
      status: "connected",
      ...session,
    })),
  };
}

describe("roomsOf (OUT-5): every bot in a voice channel is a room named after its channel", () => {
  it("lists bots in voice channels, in the bots' order, named after the channel", () => {
    const bots = [bot("bot-1", [{ channelName: "Table" }]), bot("bot-2"), bot("bot-3", [{ channelName: "Side room" }])];
    expect(roomsOf(bots)).toEqual([
      { botId: "bot-1", name: "Table" },
      { botId: "bot-3", name: "Side room" },
    ]);
  });

  it("counts a bot that is joining or reconnecting, but not one whose join failed", () => {
    const bots = [
      bot("bot-1", [{ status: "joining", channelName: "A" }]),
      bot("bot-2", [{ status: "reconnecting", channelName: "B" }]),
      bot("bot-3", [{ status: "error", channelName: "C" }]),
    ];
    expect(roomsOf(bots).map((room) => room.name)).toEqual(["A", "B"]);
  });

  it("names a bot in two servers after its first live channel", () => {
    const bots = [bot("bot-1", [{ status: "error", channelName: "Gone" }, { guildId: "2", channelName: "Hall" }])];
    expect(roomsOf(bots)).toEqual([{ botId: "bot-1", name: "Hall" }]);
  });
});
