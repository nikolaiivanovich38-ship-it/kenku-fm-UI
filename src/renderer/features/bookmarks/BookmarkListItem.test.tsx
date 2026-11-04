import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    createBrowserView: vi.fn(),
    openLocalFile: vi.fn(),
    hideBrowserView: vi.fn(),
    showBrowserView: vi.fn(),
  };
  Object.assign(window, { kenku: api });
  return api;
});

vi.mock("../tabs/getBounds", () => ({
  getBounds: () => ({ x: 240, y: 80, width: 800, height: 600 }),
}));

import bookmarksReducer, { addBookmark, Bookmark } from "./bookmarksSlice";
import tabsReducer from "../tabs/tabsSlice";
import { BookmarkListItem } from "./BookmarkListItem";
import { onAppError } from "../../common/appErrors";

function setup(bookmark: Bookmark) {
  const store = configureStore({
    reducer: { bookmarks: bookmarksReducer, tabs: tabsReducer },
  });
  store.dispatch(addBookmark(bookmark));
  render(
    <Provider store={store}>
      <BookmarkListItem bookmark={bookmark} />
    </Provider>,
  );
  return store;
}

const bookmark = (url: string): Bookmark => ({
  id: "b1",
  url,
  title: "Ambience",
  icon: "",
});

async function open() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Ambience" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  kenku.createBrowserView.mockResolvedValue(9);
});

describe("BookmarkListItem opening a bookmark", () => {
  it("adds https:// to an old bookmark saved without a scheme", async () => {
    const store = setup(bookmark("youtube.com"));
    await open();
    expect(kenku.createBrowserView).toHaveBeenCalledWith(
      "https://youtube.com/",
      240,
      80,
      800,
      600,
      undefined,
    );
    expect(store.getState().tabs.tabs.byId[9]).toMatchObject({
      url: "https://youtube.com/",
      title: "Ambience",
    });
    expect(store.getState().tabs.selectedTab).toBe(9);
  });

  it("opens a normal bookmark at its address", async () => {
    setup(bookmark("https://tabletopaudio.com/"));
    await open();
    expect(kenku.createBrowserView.mock.calls[0][0]).toBe(
      "https://tabletopaudio.com/",
    );
  });

  it.each(["file://fileserver/share/x.html", "javascript:alert(1)", ""])(
    "explains instead of opening a blank tab for %j",
    async (url) => {
      const errors: string[] = [];
      const stop = onAppError((message) => errors.push(message));
      const store = setup(bookmark(url));
      await open();
      stop();
      expect(kenku.createBrowserView).not.toHaveBeenCalled();
      expect(store.getState().tabs.tabs.allIds).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/^That page was not opened\. /);
    },
  );

  it("adds no tab when the main process refuses the view", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    kenku.createBrowserView.mockResolvedValue(-1);
    const store = setup(bookmark("https://tabletopaudio.com/"));
    await open();
    expect(store.getState().tabs.tabs.allIds).toEqual([]);
    expect(kenku.showBrowserView).not.toHaveBeenCalled();
  });
});

describe("BookmarkListItem: a bookmark to a file (SEC-15)", () => {
  it("asks the main process, which asks the user, and opens a file tab", async () => {
    kenku.openLocalFile.mockResolvedValue(12);
    const store = setup(bookmark("file:///C:/Maps/index.html"));
    await open();
    expect(kenku.createBrowserView).not.toHaveBeenCalled();
    expect(kenku.openLocalFile).toHaveBeenCalledWith("file:///C:/Maps/index.html", 240, 80, 800, 600);
    expect(store.getState().tabs.tabs.byId[12]).toMatchObject({
      url: "file:///C:/Maps/index.html",
      title: "Ambience",
      kind: "local-file",
    });
    expect(store.getState().tabs.selectedTab).toBe(12);
  });

  it("opens nothing, and shows no error, when the user says no", async () => {
    kenku.openLocalFile.mockResolvedValue(-1);
    const errors: string[] = [];
    const stop = onAppError((message) => errors.push(message));
    const store = setup(bookmark("file:///C:/Maps/index.html"));
    await open();
    stop();
    expect(store.getState().tabs.tabs.allIds).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("BookmarkListItem site icon (UX-10)", () => {
  it("cannot be dragged on its own, so holding a bookmark by its icon drags the bookmark", () => {
    const { container } = render(
      <Provider store={configureStore({ reducer: { bookmarks: bookmarksReducer, tabs: tabsReducer } })}>
        <BookmarkListItem bookmark={{ ...bookmark("https://tabletopaudio.com/"), icon: "data:image/png;base64,AA==" }} />
      </Provider>,
    );
    expect(container.querySelector("img")).toHaveAttribute("draggable", "false");
  });
});

describe("BookmarkListItem options button", () => {
  it("is named after the bookmark, so screen readers can tell the options buttons apart", () => {
    setup(bookmark("https://tabletopaudio.com"));
    expect(screen.getByRole("button", { name: "Options for Ambience" })).toBeInTheDocument();
  });
});
