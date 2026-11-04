import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { BotState, OutputsState } from "../../../common/outputs";

const kenku = vi.hoisted(() => {
  const api = { platform: "win32", outputs: { setMuted: vi.fn() } };
  Object.assign(window, { kenku: api });
  return api;
});

import outputReducer, { setOutputsState } from "./outputSlice";
import { OutputRail } from "./OutputRail";

function bot(overrides: Partial<BotState> = {}): BotState {
  return {
    id: "bot-1",
    name: "Bot 1",
    discordName: "Fake Bot",
    hasToken: true,
    tokenRemembered: true,
    status: "ready",
    guilds: [],
    voice: [{ guildId: "1", channelId: "2", channelName: "Tavern", status: "connected" }],
    muted: false,
    ...overrides,
  };
}

function setup(state: Partial<OutputsState>) {
  const store = configureStore({ reducer: { output: outputReducer } });
  store.dispatch(setOutputsState({ encryption: true, local: { muted: false }, bots: [], ...state }));
  render(
    <Provider store={store}>
      <OutputRail />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OutputRail: outputs in the collapsed sidebar (UX finding 9)", () => {
  it("shows This Computer and every bot in use, each with its status", () => {
    setup({
      local: { muted: true },
      bots: [
        bot(),
        bot({ id: "bot-2", name: "Bot 2", discordName: "Other", voice: [{ guildId: "1", channelId: "3", channelName: "Dungeon", status: "reconnecting", error: "lost" }] }),
        bot({ id: "bot-3", name: "Bot 3", discordName: undefined, status: "offline", voice: [] }),
      ],
    });
    const group = screen.getByRole("group", { name: "Outputs" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "This Computer",
      "Mute Fake Bot (Bot 1)",
      "Mute Other (Bot 2)",
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-description"))).toEqual(["Off", "Connected", "Reconnecting…"]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[2]).toHaveAttribute("data-status", "warning");
  });

  it("mutes a bot and switches This Computer on or off", async () => {
    setup({ bots: [bot()] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mute Fake Bot (Bot 1)" }));
    expect(kenku.outputs.setMuted).toHaveBeenCalledWith("bot-1", true);
    await user.click(screen.getByRole("button", { name: "This Computer" }));
    expect(kenku.outputs.setMuted).toHaveBeenCalledWith("local", true);
  });
});
