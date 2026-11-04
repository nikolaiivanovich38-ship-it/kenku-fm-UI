import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    createBrowserView: vi.fn(),
    showBrowserView: vi.fn(),
    hideBrowserView: vi.fn(),
  };
  Object.assign(window, { kenku: api });
  return api;
});

vi.mock("../tabs/getBounds", () => ({
  getBounds: () => ({ x: 56, y: 80, width: 800, height: 600 }),
}));

import bookmarksReducer, { addBookmark, addFolder, moveBookmarkToFolder } from "./bookmarksSlice";
import tabsReducer from "../tabs/tabsSlice";
import { BookmarkRail } from "./BookmarkRail";
import { SidebarToggle } from "./SidebarToggle";

function setup() {
  const store = configureStore({ reducer: { bookmarks: bookmarksReducer, tabs: tabsReducer } });
  store.dispatch(addBookmark({ id: "b1", title: "Tabletop Audio", url: "https://tabletopaudio.com/", icon: "" }));
  store.dispatch(addBookmark({ id: "b2", title: "YouTube", url: "https://youtube.com/", icon: "" }));
  store.dispatch(addFolder({ id: "f1", title: "Combat" }));
  store.dispatch(moveBookmarkToFolder({ bookmarkId: "b2", folderId: "f1" }));
  render(
    <Provider store={store}>
      <SidebarToggle />
      <BookmarkRail />
    </Provider>,
  );
  return { store, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  kenku.createBrowserView.mockResolvedValue(9);
});

describe("collapsed sidebar (UX-10)", () => {
  it("collapses and expands, and says which it will do", async () => {
    const { store, user } = setup();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(store.getState().bookmarks.sidebarCollapsed).toBe(true);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows each loose bookmark as an icon button named after it, which opens it", async () => {
    const { store, user } = setup();
    const rail = screen.getByRole("list", { name: "Bookmarks" });
    await user.click(within(rail).getByRole("button", { name: "Tabletop Audio" }));
    expect(kenku.createBrowserView).toHaveBeenCalledWith("https://tabletopaudio.com/", 56, 80, 800, 600, undefined);
    expect(store.getState().tabs.selectedTab).toBe(9);
  });

  it("shows a folder as one button that lists its bookmarks", async () => {
    const { user } = setup();
    const rail = screen.getByRole("list", { name: "Bookmarks" });
    expect(within(rail).queryByRole("button", { name: "YouTube" })).not.toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: "Combat folder" }));
    await user.click(screen.getByRole("menuitem", { name: "YouTube" }));
    expect(kenku.createBrowserView).toHaveBeenCalledWith("https://youtube.com/", 56, 80, 800, 600, undefined);
  });

  it("can be used with the keyboard", async () => {
    const { user } = setup();
    act(() => screen.getByRole("button", { name: "Tabletop Audio" }).focus());
    await user.keyboard("{Enter}");
    expect(kenku.createBrowserView).toHaveBeenCalledTimes(1);
  });
});
