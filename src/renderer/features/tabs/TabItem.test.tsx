import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    setMuted: vi.fn(),
    removeBrowserView: vi.fn(),
    hideBrowserView: vi.fn(),
    showBrowserView: vi.fn(),
    playerGetURL: () => "file:///player/index.html",
    lyreGetURL: () => "file:///lyre/index.html",
  };
  Object.assign(window, { kenku: api });
  return api;
});

import bookmarksReducer from "../bookmarks/bookmarksSlice";
import playerReducer from "../player/playerSlice";
import tabsReducer, { addTab, type Tab } from "./tabsSlice";
import { TabItem } from "./TabItem";

const tab: Tab = { id: 7, url: "https://tabletopaudio.com/", title: "Tabletop Audio", icon: "", playingMedia: 1, muted: false };

function setup(overrides: Partial<Tab> = {}) {
  const store = configureStore({ reducer: { bookmarks: bookmarksReducer, player: playerReducer, tabs: tabsReducer } });
  store.dispatch(addTab({ ...tab, ...overrides }));
  render(
    <Provider store={store}>
      <TabItem tab={{ ...tab, ...overrides }} selected allowClose />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TabItem names (minor findings)", () => {
  it("names each button after the tab, with a fixed name and a pressed state for toggles", async () => {
    const store = setup();
    expect(screen.getByRole("button", { name: "Tabletop Audio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute Tabletop Audio" })).toHaveAttribute("aria-pressed", "false");
    const bookmark = screen.getByRole("button", { name: "Bookmark Tabletop Audio" });
    expect(bookmark).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(bookmark);
    expect(Object.values(store.getState().bookmarks.bookmarks.byId)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Bookmark Tabletop Audio" })).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the tab from a button named after it, not just 'close'", async () => {
    const store = setup();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close tab Tabletop Audio" }));
    expect(kenku.removeBrowserView).toHaveBeenCalledWith(7);
    expect(store.getState().tabs.tabs.allIds).toEqual([]);
  });

  it("keeps its buttons beside the tab's button, not inside it", () => {
    setup();
    const select = screen.getByRole("button", { name: "Tabletop Audio" });
    expect(select.querySelector("button, [role='button']")).toBeNull();
  });
});
