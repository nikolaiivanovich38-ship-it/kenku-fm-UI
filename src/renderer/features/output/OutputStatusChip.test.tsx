import { describe, expect, it } from "vitest";
import type { BotState } from "../../../common/outputs";
import { botChip, canReconnect, canTryNow } from "./OutputStatusChip";
import { botStatusText, nextRetryAt } from "./BotStatusLine";

function bot(overrides: Partial<BotState> = {}): BotState {
  return {
    id: "bot-1",
    name: "Bot 1",
    hasToken: true,
    tokenRemembered: true,
    status: "ready",
    guilds: [],
    voice: [],
    muted: false,
    ...overrides,
  };
}

const session = (status: "joining" | "connected" | "reconnecting" | "error", error?: string) => ({
  guildId: "1",
  channelId: "2",
  channelName: "Tavern",
  status,
  ...(error ? { error } : {}),
});

describe("output status chip (OUT-2)", () => {
  it.each([
    [bot({ status: "offline" }), "Offline", "default"],
    [bot({ status: "connecting" }), "Connecting…", "info"],
    [bot(), "Ready", "default"],
    [bot({ voice: [session("joining")] }), "Joining…", "info"],
    [bot({ voice: [session("connected")] }), "Connected", "success"],
    [bot({ voice: [session("connected")], muted: true }), "Muted", "default"],
    [bot({ voice: [session("reconnecting", "Connection lost. Trying again in 2 s…")] }), "Reconnecting…", "warning"],
    [bot({ status: "connecting", error: "Cannot reach Discord. Trying again in 1 s…" }), "Reconnecting…", "warning"],
    [bot({ voice: [session("error", "Could not join")] }), "Error", "error"],
    [bot({ status: "error", error: "Error connecting to bot: refused" }), "Error", "error"],
  ])("%#: shows %s", (state, label, color) => {
    expect(botChip(state)).toEqual({ label, color });
  });

  it("gives the plain reason of a problem", () => {
    expect(botStatusText(bot({ voice: [session("error", "Could not join “Tavern” within 15 seconds.")] }))).toBe(
      "Could not join “Tavern” within 15 seconds.",
    );
    expect(botStatusText(bot({ voice: [session("connected")] }))).toBe("In Tavern");
    expect(botStatusText(bot({ status: "error", error: "Error connecting to bot: refused" }))).toBe(
      "Could not connect: refused",
    );
  });

  it("says why the bot left when a moderator moved it, as a state, not an error (WP1 review 5)", () => {
    const left = bot({ notice: "A moderator moved or disconnected the bot from “Tavern”, so it left." });
    expect(botStatusText(left)).toBe("A moderator moved or disconnected the bot from “Tavern”, so it left.");
    expect(botChip(left)).toEqual({ label: "Left", color: "warning" });
    expect(canReconnect(left)).toBe(false);
    // Once in a channel again, the channel is what counts.
    expect(botStatusText({ ...left, voice: [session("connected")] })).toBe("In Tavern");
  });

  it("does not offer Try now for a bot a moderator moved: it is not waiting to try again", () => {
    const left = bot({ notice: "A moderator moved or disconnected the bot from “Tavern”, so it left." });
    expect(canTryNow(left)).toBe(false);
    expect(canTryNow(bot({ status: "connecting", error: "Cannot reach Discord. Trying again in 1 s…" }))).toBe(true);
  });

  it("counts down to the next attempt while reconnecting (UX finding 6)", () => {
    const reconnecting = bot({
      voice: [{ ...session("reconnecting", "Connection to “Tavern” lost. Trying again in 8 s…"), retryAt: 10_000 }],
    });
    expect(botStatusText(reconnecting, 4_100)).toBe("Connection to “Tavern” lost. Trying again in 6 s…");
    expect(botStatusText(reconnecting, 9_950)).toBe("Connection to “Tavern” lost. Trying again in 1 s…");
    expect(botStatusText(reconnecting, 10_000)).toBe("Connection to “Tavern” lost. Trying again now…");
    expect(nextRetryAt(reconnecting)).toBe(10_000);

    const login = bot({ status: "connecting", error: "Cannot reach Discord. Trying again in 4 s…", retryAt: 5_000 });
    expect(botStatusText(login, 2_000)).toBe("Cannot reach Discord. Trying again in 3 s…");
    expect(nextRetryAt(login)).toBe(5_000);
    expect(nextRetryAt(bot())).toBeUndefined();
  });

  it("offers Reconnect only for a failed bot that has a token", () => {
    expect(canReconnect(bot({ status: "error", error: "x" }))).toBe(true);
    expect(canReconnect(bot({ status: "error", error: "x", hasToken: false }))).toBe(false);
    expect(canReconnect(bot({ voice: [session("connected")] }))).toBe(false);
  });
});
