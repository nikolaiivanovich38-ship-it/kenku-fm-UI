import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

const LYRE_URL = "file:///app/lyre_window/index.html";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    createBrowserView: vi.fn(async () => 42),
    hideBrowserView: vi.fn(),
    showBrowserView: vi.fn(),
    removeBrowserView: vi.fn(),
    setBrowserViewBounds: vi.fn(),
    setMuted: vi.fn(),
    playerGetURL: () => "file:///app/player_window/index.html",
    lyreGetURL: () => "file:///app/lyre_window/index.html",
  };
  Object.assign(window, { kenku: api });
  return api;
});

import bookmarksReducer from "../bookmarks/bookmarksSlice";
import playerReducer from "../player/playerSlice";
import tabsReducer, { selectTab } from "../tabs/tabsSlice";
import lyreReducer from "./lyreSlice";
import { LyreTab } from "./LyreTab";
import { isBuiltInTab } from "./lyreSlice";

function setup() {
  const store = configureStore({
    reducer: { bookmarks: bookmarksReducer, player: playerReducer, tabs: tabsReducer, lyre: lyreReducer },
  });
  render(
    <Provider store={store}>
      <LyreTab />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("The Lyre tab (WP5): the new interface beside the old player", () => {
  it("asks the main process for the Lyre page by its kind, never by a script path", async () => {
    const store = setup();
    await waitFor(() => expect(store.getState().lyre.tab.id).toBe(42));
    expect(kenku.createBrowserView).toHaveBeenCalledWith(LYRE_URL, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), "lyre");
  });

  it("is a tab named Lyre with no close or bookmark button", async () => {
    const store = setup();
    await waitFor(() => expect(store.getState().lyre.tab.id).toBe(42));
    expect(screen.getByRole("button", { name: "Lyre" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Close tab/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bookmark/ })).toBeNull();
  });

  it("does not take the screen at start: the old player stays in front until the tab is chosen", async () => {
    const store = setup();
    await waitFor(() => expect(store.getState().lyre.tab.id).toBe(42));
    expect(kenku.hideBrowserView).toHaveBeenCalledWith(42);
    expect(store.getState().tabs.selectedTab).toBeUndefined();
  });

  it("shows the Lyre page when the tab is chosen", async () => {
    const store = setup();
    await waitFor(() => expect(store.getState().lyre.tab.id).toBe(42));
    await userEvent.setup().click(screen.getByRole("button", { name: "Lyre" }));
    expect(store.getState().tabs.selectedTab).toBe(42);
    expect(kenku.showBrowserView).toHaveBeenCalledWith(42);
    expect(screen.getByRole("button", { name: "Lyre" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps showing a Lyre page that was chosen before it finished opening", async () => {
    kenku.createBrowserView.mockImplementationOnce(async () => {
      await Promise.resolve();
      return 42;
    });
    const store = setup();
    store.dispatch(selectTab(42));
    await waitFor(() => expect(store.getState().lyre.tab.id).toBe(42));
    expect(kenku.hideBrowserView).not.toHaveBeenCalledWith(42);
  });

  it("names the built-in tabs (player and Lyre) so they are never closed like a website tab", async () => {
    const store = setup();
    await waitFor(() => expect(store.getState().lyre.tab.id).toBe(42));
    const builtIn = { playerId: store.getState().player.tab.id, lyreId: store.getState().lyre.tab.id };
    expect(isBuiltInTab(42, builtIn)).toBe(true);
    expect(isBuiltInTab(7, builtIn)).toBe(false);
    expect(isBuiltInTab(undefined, builtIn)).toBe(false);
  });
});
