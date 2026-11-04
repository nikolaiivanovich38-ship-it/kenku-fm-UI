import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

vi.hoisted(() => {
  Object.assign(window, {
    kenku: { platform: "win32", createBrowserView: vi.fn(), showBrowserView: vi.fn(), hideBrowserView: vi.fn() },
  });
});

import bookmarksReducer, { addBookmark, addFolder, moveBookmarkToFolder } from "./bookmarksSlice";
import tabsReducer from "../tabs/tabsSlice";
import { BookmarkListItems } from "./BookmarkListItems";

let store_addFolder: () => void;

function setup() {
  const store = configureStore({ reducer: { bookmarks: bookmarksReducer, tabs: tabsReducer } });
  for (const [id, title] of [
    ["b1", "Tabletop Audio"],
    ["b2", "YouTube"],
  ]) {
    act(() => {
      store.dispatch(addBookmark({ id, title, url: `https://${id}.example/`, icon: "" }));
    });
  }
  store_addFolder = () => store.dispatch(addFolder({ id: "f1", title: "Combat" }));
  render(
    <Provider store={store}>
      <BookmarkListItems />
    </Provider>,
  );
  return { store, user: userEvent.setup() };
}

const folderButton = (name: string) => screen.getByRole("button", { name: `${name} folder` });
const folderGroup = (name: string) => screen.queryByRole("group", { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("drag handles (UX finding 2)", () => {
  it("gives each bookmark a handle named after it, apart from its own button", () => {
    setup();
    const handle = screen.getByRole("button", { name: "Move Tabletop Audio" });
    expect(handle).toHaveAttribute("aria-roledescription", "drag handle");
    expect(screen.getByRole("button", { name: "Tabletop Audio" })).not.toContainElement(handle);
  });
});

describe("bookmark folders (UX-10)", () => {
  it("creates a folder from the New folder button", async () => {
    const { store, user } = setup();
    await user.click(screen.getByRole("button", { name: "New bookmark folder" }));
    const dialog = screen.getByRole("dialog", { name: "New folder" });
    const name = within(dialog).getByRole("textbox", { name: "Folder name" });
    await user.clear(name);
    await user.type(name, "Combat{Enter}");
    expect(Object.values(store.getState().bookmarks.folders.byId)).toMatchObject([{ title: "Combat", open: true }]);
    expect(await screen.findByRole("button", { name: "Combat folder" })).toHaveAttribute("aria-expanded", "true");
  });

  it("does not create a folder without a name", async () => {
    const { store, user } = setup();
    await user.click(screen.getByRole("button", { name: "New bookmark folder" }));
    const dialog = screen.getByRole("dialog", { name: "New folder" });
    await user.clear(within(dialog).getByRole("textbox", { name: "Folder name" }));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(store.getState().bookmarks.folders.allIds).toEqual([]);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/name/i);
  });

  it("moves a bookmark into a folder with the Move to folder menu (keyboard alternative to dragging)", async () => {
    const { store, user } = setup();
    act(() => {
      store.dispatch(addFolder({ id: "f1", title: "Combat" }));
    });
    await user.click(screen.getByRole("button", { name: "Options for YouTube" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to folder…" }));
    await user.click(screen.getByRole("menuitem", { name: "Combat" }));
    expect(store.getState().bookmarks.bookmarks.byId.b2.folderId).toBe("f1");
    expect(within(folderGroup("Combat")!).getByText("YouTube")).toBeInTheDocument();
  });

  it("moves a bookmark back to the main list", async () => {
    const { store, user } = setup();
    act(() => {
      store.dispatch(addFolder({ id: "f1", title: "Combat" }));
    });
    act(() => {
      store.dispatch(moveBookmarkToFolder({ bookmarkId: "b2", folderId: "f1" }));
    });
    await user.click(await screen.findByRole("button", { name: "Options for YouTube" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to folder…" }));
    await user.click(screen.getByRole("menuitem", { name: "No folder (main list)" }));
    expect(store.getState().bookmarks.bookmarks.byId.b2.folderId).toBeUndefined();
  });

  it("closes and opens a folder", async () => {
    const { store, user } = setup();
    act(() => {
      store.dispatch(addFolder({ id: "f1", title: "Combat" }));
    });
    act(() => {
      store.dispatch(moveBookmarkToFolder({ bookmarkId: "b2", folderId: "f1" }));
    });
    await user.click(await screen.findByRole("button", { name: "Combat folder" }));
    expect(folderButton("Combat")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("YouTube")).not.toBeInTheDocument();
    await user.click(folderButton("Combat"));
    expect(screen.getByText("YouTube")).toBeInTheDocument();
  });

  it("renames a folder", async () => {
    const { store, user } = setup();
    act(() => {
      store.dispatch(addFolder({ id: "f1", title: "Combat" }));
    });
    await user.click(await screen.findByRole("button", { name: "Options for folder Combat" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename folder" });
    const name = within(dialog).getByRole("textbox", { name: "Folder name" });
    await user.clear(name);
    await user.type(name, "Battle");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(store.getState().bookmarks.folders.byId.f1.title).toBe("Battle");
  });

  it("moves focus to the next bookmark after Move to folder… (UX finding 12)", async () => {
    const { user } = setup();
    act(() => {
      store_addFolder();
    });
    await user.click(screen.getByRole("button", { name: "Options for Tabletop Audio" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to folder…" }));
    await user.click(screen.getByRole("menuitem", { name: "Combat" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "YouTube" })).toHaveFocus());
  });

  it("moves focus to the Bookmarks heading when nothing comes after (UX finding 12)", async () => {
    const { user } = setup();
    act(() => {
      store_addFolder();
    });
    await user.click(screen.getByRole("button", { name: "Options for YouTube" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to folder…" }));
    await user.click(screen.getByRole("menuitem", { name: "Combat" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Bookmarks" })).toHaveFocus());
  });

  it("moves focus to the item after a deleted folder (UX finding 12)", async () => {
    const { user } = setup();
    act(() => {
      store_addFolder();
    });
    await user.click(await screen.findByRole("button", { name: "Options for folder Combat" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete folder (keeps its bookmarks)" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Tabletop Audio" })).toHaveFocus());
  });

  it("deletes a folder but keeps its bookmarks", async () => {
    const { store, user } = setup();
    act(() => {
      store.dispatch(addFolder({ id: "f1", title: "Combat" }));
    });
    act(() => {
      store.dispatch(moveBookmarkToFolder({ bookmarkId: "b2", folderId: "f1" }));
    });
    await user.click(await screen.findByRole("button", { name: "Options for folder Combat" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete folder (keeps its bookmarks)" }));
    expect(store.getState().bookmarks.folders.allIds).toEqual([]);
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(store.getState().bookmarks.bookmarks.allIds).toEqual(["b1", "b2"]);
  });
});
