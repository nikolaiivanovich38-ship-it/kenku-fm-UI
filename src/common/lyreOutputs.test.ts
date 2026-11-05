import { describe, expect, it } from "vitest";
import type { BotState, GuildInfo, OutputsState } from "./outputs";
import { isLyreOutputs, lyreOutputsOf } from "./lyreOutputs";

const GULL: GuildInfo = {
  id: "1001",
  name: "The Gull and Lantern",
  icon: null,
  voiceChannels: [
    { id: "1011", name: "Table", members: ["Nik", "Aster"] },
    { id: "1012", name: "Side room", members: [] },
  ],
};
const COURT: GuildInfo = { id: "1002", name: "Night court", icon: null, voiceChannels: [{ id: "1021", name: "Elysium" }] };

function bot(over: Partial<BotState>): BotState {
  return {
    id: "bot-1",
    name: "Bot 1",
    hasToken: true,
    tokenRemembered: true,
    status: "ready",
    guilds: [],
    voice: [],
    muted: false,
    ...over,
  };
}

function state(bots: BotState[]): OutputsState {
  return { encryption: true, local: { muted: false }, bots };
}

describe("lyreOutputsOf: what the Outputs screen sees of the bots (never a token)", () => {
  it("names each bot by its Discord name, gives its room, mute and volume, and the servers it sees", () => {
    const outputs = lyreOutputsOf(
      state([
        bot({
          id: "bot-1",
          discordName: "Lyre Table",
          guilds: [GULL],
          voice: [{ guildId: "1001", channelId: "1011", channelName: "Table", status: "connected" }],
          volume: 0.85,
        }),
        bot({ id: "bot-2", name: "Bot 2", guilds: [GULL, COURT], muted: true }),
      ]),
    );
    expect(outputs.bots).toEqual([
      { id: "bot-1", name: "Lyre Table", login: "ready", room: { serverId: "1001", channelId: "1011", status: "connected" }, muted: false, volume: 0.85, serverIds: ["1001"] },
      { id: "bot-2", name: "Bot 2", login: "ready", room: null, muted: true, volume: 1, serverIds: ["1001", "1002"] },
    ]);
    expect(outputs.servers).toEqual([
      { id: "1001", name: "The Gull and Lantern", channels: [{ id: "1011", name: "Table", members: ["Nik", "Aster"] }, { id: "1012", name: "Side room", members: [] }] },
      { id: "1002", name: "Night court", channels: [{ id: "1021", name: "Elysium", members: [] }] },
    ]);
    expect(JSON.stringify(outputs)).not.toMatch(/token/i);
  });

  it("takes the channel a bot is (about to be) heard in as its room; a failed join shows only when there is none", () => {
    const joining = lyreOutputsOf(
      state([
        bot({
          voice: [
            { guildId: "1002", channelId: "1021", channelName: "Elysium", status: "error", error: "No Connect permission" },
            { guildId: "1001", channelId: "1012", channelName: "Side room", status: "joining" },
          ],
        }),
      ]),
    );
    expect(joining.bots[0].room).toEqual({ serverId: "1001", channelId: "1012", status: "joining" });
    const failed = lyreOutputsOf(state([bot({ voice: [{ guildId: "1002", channelId: "1021", channelName: "Elysium", status: "error", error: "No Connect permission" }] })]));
    expect(failed.bots[0].room).toEqual({ serverId: "1002", channelId: "1021", status: "error", error: "No Connect permission" });
  });

  it("keeps a login problem in the bot's own words", () => {
    const outputs = lyreOutputsOf(state([bot({ status: "error", error: "Discord didn't accept this token." })]));
    expect(outputs.bots[0]).toMatchObject({ login: "error", error: "Discord didn't accept this token." });
  });

  it("isLyreOutputs accepts the shape and refuses anything else", () => {
    expect(isLyreOutputs(lyreOutputsOf(state([bot({ guilds: [GULL] })])))).toBe(true);
    expect(isLyreOutputs({ bots: "no", servers: [] })).toBe(false);
    expect(isLyreOutputs(null)).toBe(false);
    expect(isLyreOutputs({ bots: [{ id: 1 }], servers: [] })).toBe(false);
  });
});
