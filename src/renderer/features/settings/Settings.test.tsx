import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { OutputsState } from "../../../common/outputs";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    version: "1.2.3",
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    setStreamingMode: vi.fn(),
    playerStartRemote: vi.fn(),
    playerStopRemote: vi.fn(),
    clearCache: vi.fn(),
    outputs: {
      getState: vi.fn(),
      connectSaved: vi.fn(),
      addBot: vi.fn(),
      setToken: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeToken: vi.fn(),
      removeBot: vi.fn(),
    },
    localFileFolders: { list: vi.fn(), forget: vi.fn() },
  };
  Object.assign(window, { kenku: api });
  return api;
});

import outputReducer from "../output/outputSlice";
import connectionReducer from "../connection/connectionSlice";
import settingsReducer from "./settingsSlice";
import errorsReducer, { errorShown } from "../errors/errorsSlice";
import { Settings } from "./Settings";

const noKeyring: OutputsState = {
  encryption: false,
  local: { muted: false },
  bots: [
    { id: "b1", name: "Bot 1", hasToken: false, tokenRemembered: false, status: "offline", guilds: [], voice: [], muted: false },
  ],
};

function setup() {
  const store = configureStore({
    reducer: { output: outputReducer, connection: connectionReducer, settings: settingsReducer, errors: errorsReducer },
  });
  render(
    <Provider store={store}>
      <Settings open onClose={() => undefined} />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  kenku.outputs.getState.mockResolvedValue(noKeyring);
  kenku.localFileFolders.list.mockResolvedValue([]);
});

describe("Settings (UX finding 8 and wording)", () => {
  it("is a side panel that grows with the window, so the player moves aside instead of being hidden", () => {
    setup();
    const root = screen.getByRole("dialog", { name: "Settings" }).closest(".MuiModal-root");
    expect(root).toHaveAttribute("data-side-panel");
  });

  it("says in one line that tokens are forgotten, with the reason behind More", async () => {
    setup();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(/^Tokens are forgotten when you close the app\.More$/);
    await userEvent.setup().click(within(note).getByRole("button", { name: "More" }));
    expect(note).toHaveTextContent(/no secure place to save passwords/);
    expect(within(note).getByRole("button", { name: "Less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("describes how the two streaming modes differ", async () => {
    setup();
    await userEvent.setup().click(screen.getByRole("combobox", { name: "Mode" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Best sound qualityClearer sound; works the computer a little harder.",
      "Lighter on the computerLeaves more power for other programs; slightly less clear.",
    ]);
  });

  it("uses plain names for the other settings", () => {
    setup();
    expect(screen.getByRole("checkbox", { name: "Show the address bar on tabs" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Microphones and other inputs" })).toBeInTheDocument();
    const several = screen.getByRole("checkbox", { name: "Use several inputs at once" });
    expect(several).toBeDisabled();
    expect(several).toHaveAccessibleDescription("Turn on Microphones and other inputs first.");
    const clear = screen.getByRole("button", { name: "Clear website data" });
    expect(clear).toHaveAccessibleDescription(
      "Logs you out of websites in tabs and deletes their saved files. Your playlists, bookmarks and settings are kept.",
    );
  });

  it("explains the remote's address and port in plain words", () => {
    setup();
    expect(screen.getByText(/only programs on this computer can connect/)).toBeInTheDocument();
  });

  it("shows error messages inside the panel while it is open (UX finding 1)", async () => {
    const store = setup();
    store.dispatch(errorShown({ message: "Discord didn't accept this token." }));
    expect(
      await within(screen.getByRole("dialog", { name: "Settings" })).findByRole("alert"),
    ).toHaveTextContent("Discord didn't accept this token.");
  });
});
