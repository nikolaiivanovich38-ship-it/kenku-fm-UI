import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BotState } from "../../../common/outputs";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    outputs: { setToken: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), removeToken: vi.fn(), removeBot: vi.fn() },
  };
  Object.assign(window, { kenku: api });
  return api;
});

import { BotSettings } from "./BotSettings";

function bot(overrides: Partial<BotState> = {}): BotState {
  return {
    id: "bot-1",
    name: "Bot 1",
    hasToken: false,
    tokenRemembered: false,
    status: "offline",
    guilds: [],
    voice: [],
    muted: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  kenku.outputs.setToken.mockResolvedValue(true);
});

describe("BotSettings (UX finding 5)", () => {
  it("connects when Enter is pressed in the Token field", async () => {
    render(<BotSettings bot={bot()} removable={false} />);
    await userEvent.setup().type(screen.getByLabelText("Token"), "fake-token{Enter}");
    await vi.waitFor(() => expect(kenku.outputs.connect).toHaveBeenCalledWith("bot-1"));
    expect(kenku.outputs.setToken).toHaveBeenCalledWith("bot-1", "fake-token");
  });

  it("does nothing on Enter in an empty Token field", async () => {
    render(<BotSettings bot={bot()} removable={false} />);
    await userEvent.setup().type(screen.getByLabelText("Token"), "{Enter}");
    expect(kenku.outputs.connect).not.toHaveBeenCalled();
  });

  it("explains in one line what a token is and where to find it", () => {
    render(<BotSettings bot={bot()} removable={false} />);
    expect(screen.getByLabelText("Token")).toHaveAccessibleDescription(
      "Your bot's password, from the Bot page in the Discord Developer Portal.",
    );
  });

  it("shows Discord's refusal in plain words, with nothing saved", () => {
    render(
      <BotSettings
        bot={bot({
          status: "error",
          error: "Discord didn't accept this token. Copy it again from the Bot page in the Discord Developer Portal.",
        })}
        removable={false}
      />,
    );
    expect(screen.getByText(/^Discord didn't accept this token\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Token")).not.toHaveAttribute("placeholder", "Saved");
  });
});
