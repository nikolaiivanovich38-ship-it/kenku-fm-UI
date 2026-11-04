import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { BotState, OutputsState } from "../../../common/outputs";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    outputs: { reconnect: vi.fn(), setMuted: vi.fn(), joinChannel: vi.fn(), leaveChannel: vi.fn() },
  };
  Object.assign(window, { kenku: api });
  return api;
});

import outputReducer, { setOutputsState } from "./outputSlice";
import { OutputListItems } from "./OutputListItems";

function bot(overrides: Partial<BotState> = {}): BotState {
  return {
    id: "bot-1",
    name: "Bot 1",
    discordName: "Fake Bot",
    hasToken: true,
    tokenRemembered: true,
    status: "ready",
    guilds: [{ id: "1", name: "Test Server", icon: null, voiceChannels: [{ id: "2", name: "Tavern" }] }],
    voice: [],
    muted: false,
    ...overrides,
  };
}

function setup(state: Partial<OutputsState>) {
  const store = configureStore({ reducer: { output: outputReducer } });
  store.dispatch(setOutputsState({ encryption: true, local: { muted: false }, bots: [], ...state }));
  render(
    <Provider store={store}>
      <OutputListItems />
    </Provider>,
  );
  return store;
}

const inTavern = { guildId: "1", channelId: "2", channelName: "Tavern" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OutputListItems", () => {
  it("offers Try now while a bot waits to reconnect (UX finding 6)", async () => {
    setup({
      bots: [
        bot({
          voice: [{ ...inTavern, status: "reconnecting", error: "Connection to “Tavern” lost. Trying again in 8 s…", retryAt: Date.now() + 8_000 }],
        }),
      ],
    });
    expect(screen.getByText(/Trying again in [78] s…/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try now" }));
    expect(kenku.outputs.reconnect).toHaveBeenCalledWith("bot-1");
  });

  it("keeps the mute button's name and says whether it is pressed (minor finding)", async () => {
    const store = setup({ bots: [bot({ voice: [{ ...inTavern, status: "connected" }] })] });
    const mute = screen.getByRole("button", { name: "Mute Fake Bot (Bot 1)" });
    expect(mute).toHaveAttribute("aria-pressed", "false");
    act(() => {
      store.dispatch(
        setOutputsState({ encryption: true, local: { muted: true }, bots: [bot({ muted: true, voice: [{ ...inTavern, status: "connected" }] })] }),
      );
    });
    expect(screen.getByRole("button", { name: "Mute Fake Bot (Bot 1)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("explains why This Computer switched off while a bot is in a channel", () => {
    setup({ local: { muted: true }, bots: [bot({ voice: [{ ...inTavern, status: "connected" }] })] });
    expect(
      screen.getByText(
        "So you don't hear everything twice, This Computer turns off while a bot is in a channel. Turn it back on if you want to listen here too.",
      ),
    ).toBeInTheDocument();
  });

  it("does not show that note when no bot is in a channel", () => {
    setup({ local: { muted: true }, bots: [bot()] });
    expect(screen.queryByText(/So you don't hear everything twice/)).not.toBeInTheDocument();
  });
});
