import { describe, expect, it } from "vitest";
import type { BotState, GuildInfo, OutputsState } from "./outputs";
import { applicationIdProblem, BOT_INVITE_PERMISSIONS, botInviteUrl, isApplicationId, isBotToken, isLyreOutputs, lyreOutputsOf, tokenProblem, undoOfMove, type LyreOutputs } from "./lyreOutputs";

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
    // Round 6 (OUT-8) adds what Settings shows: the saved name, the token's last four characters, the invite.
    const settings = { tokenEnd: null as string | null, tokenRemembered: true, applicationId: null as string | null, inviteUrl: null as string | null, canRemove: true };
    expect(outputs.bots).toEqual([
      { id: "bot-1", name: "Lyre Table", savedName: "Bot 1", ...settings, login: "ready", room: { serverId: "1001", channelId: "1011", status: "connected" }, muted: false, volume: 0.85, serverIds: ["1001"] },
      { id: "bot-2", name: "Bot 2", savedName: "Bot 2", ...settings, login: "ready", room: null, muted: true, volume: 1, serverIds: ["1001", "1002"] },
    ]);
    expect(outputs.servers).toEqual([
      { id: "1001", name: "The Gull and Lantern", channels: [{ id: "1011", name: "Table", members: ["Nik", "Aster"] }, { id: "1012", name: "Side room", members: [] }] },
      { id: "1002", name: "Night court", channels: [{ id: "1021", name: "Elysium", members: [] }] },
    ]);
    expect(JSON.stringify(outputs)).not.toMatch(/fake-|secret/i);
  });

  // --- w6-rooms ---
  it("keeps a bot's Discord name after it disconnects, so Settings and Rooms still call it by it (OUT-8)", () => {
    const outputs = lyreOutputsOf(state([bot({ id: "bot-2", name: "Bot 2", lastDiscordName: "Lyre Side", status: "offline" })]));
    expect(outputs.bots[0]).toMatchObject({ name: "Lyre Side", savedName: "Bot 2", login: "offline" });
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

describe("OUT-8: Settings in Lyre (design/prototype/src/views/settings.js)", () => {
  it("each bot says its own name, the last four characters of its token (never more), its Application ID and invite", () => {
    const outputs = lyreOutputsOf({
      ...state([
        bot({ id: "bot-1", name: "Bot 1", discordName: "Lyre Table", tokenEnd: "Kq7w", applicationId: "123456789012345678" }),
        bot({ id: "bot-2", name: "Bot 2", hasToken: false, tokenRemembered: false }),
      ]),
      encryption: false,
    });
    expect(outputs.encryption).toBe(false);
    expect(outputs.bots[0]).toMatchObject({ name: "Lyre Table", savedName: "Bot 1", tokenEnd: "Kq7w", tokenRemembered: true, applicationId: "123456789012345678", canRemove: true });
    expect(outputs.bots[0].inviteUrl).toBe("https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=3146752");
    expect(outputs.bots[1]).toMatchObject({ name: "Bot 2", tokenEnd: null, applicationId: null, inviteUrl: null });
    expect(isLyreOutputs(outputs)).toBe(true);
  });

  it("the last bot cannot be removed", () => {
    expect(lyreOutputsOf(state([bot({})])).bots[0].canRemove).toBe(false);
  });

  it("the invite asks for View Channels, Connect and Speak only (1024 + 1048576 + 2097152)", () => {
    expect(BOT_INVITE_PERMISSIONS).toBe(1024 + 1048576 + 2097152);
    expect(botInviteUrl("123456789012345678")).toBe("https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=3146752");
    expect(() => botInviteUrl("12&scope=admin")).toThrow();
  });

  it("checks an Application ID (Discord's id: digits) and a bot token (three parts with dots) before they reach Discord", () => {
    expect(isApplicationId("123456789012345678")).toBe(true);
    expect(["", "1234", "12345678901234567890123", "1234567890123456a", " 123456789012345678"].map(isApplicationId)).toEqual([false, false, false, false, false]);
    expect(isBotToken("MTAx.new-bot.abcd")).toBe(true);
    expect(isBotToken(["MTIzNDU2Nzg5MDEyMzQ1Njc4", "GhIjKl", "abcdefghijklmnopqrstuvwxyz_-0123456789AB"].join("."))).toBe(true);
    expect(["", "no dots here", "a.b", "a.b.c.d", "a b.c.d", "a.b.c\n", "x".repeat(300)].map(isBotToken)).toEqual([false, false, false, false, false, false, false]);
    expect(applicationIdProblem("12")).toBe("An Application ID is a long number: copy it from General Information › Application ID › Copy.");
    expect(tokenProblem("nope")).toBe("That is not a bot token. In the Discord Developer Portal: Bot › Reset Token › Copy, then paste it here.");
    expect(applicationIdProblem("123456789012345678")).toBeNull();
    expect(tokenProblem(" MTAx.new-bot.abcd ")).toBeNull();
  });

  it("OUT-7: Undo of a move or a Kick puts the bot back where it was, or takes it out again", () => {
    const before: LyreOutputs = lyreOutputsOf(state([bot({ id: "bot-1", guilds: [GULL], voice: [{ guildId: "1001", channelId: "1011", channelName: "Table", status: "connected" }] }), bot({ id: "bot-2", guilds: [GULL] })]));
    expect(undoOfMove(before, "bot-1")).toEqual({ kind: "move", botId: "bot-1", channelId: "1011" });
    expect(undoOfMove(before, "bot-2")).toEqual({ kind: "leave", botId: "bot-2" });
    expect(undoOfMove(before, "bot-9")).toBeNull();
  });
});
