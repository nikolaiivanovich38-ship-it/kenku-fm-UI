import { describe, expect, it } from "vitest";
import type { BotState } from "../../../common/outputs";
import { botChip, canReconnect } from "./OutputStatusChip";
import { botStatusText } from "./BotStatusLine";

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

  it("offers Reconnect only for a failed bot that has a token", () => {
    expect(canReconnect(bot({ status: "error", error: "x" }))).toBe(true);
    expect(canReconnect(bot({ status: "error", error: "x", hasToken: false }))).toBe(false);
    expect(canReconnect(bot({ voice: [session("connected")] }))).toBe(false);
  });
});
