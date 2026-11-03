import React from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";

vi.hoisted(() => {
  Object.assign(window, { kenku: { platform: "win32" } });
});

import bookmarksReducer, { addBookmark, Bookmark } from "./bookmarksSlice";
import { BookmarkSettings } from "./BookmarkSettings";

const original: Bookmark = {
  id: "b1",
  url: "https://tabletopaudio.com/",
  title: "Tabletop Audio",
  icon: "",
};

function makeStore() {
  const store = configureStore({ reducer: { bookmarks: bookmarksReducer } });
  store.dispatch(addBookmark(original));
  return store;
}
type Store = ReturnType<typeof makeStore>;
type State = ReturnType<Store["getState"]>;

function Connected({ onClose }: { onClose: () => void }) {
  const bookmark = useSelector((state: State) => state.bookmarks.bookmarks.byId.b1);
  return <BookmarkSettings bookmark={bookmark} open onClose={onClose} />;
}

let store: Store;
let onClose: Mock<() => void>;

beforeEach(() => {
  store = makeStore();
  onClose = vi.fn<() => void>();
  render(
    <Provider store={store}>
      <Connected onClose={onClose} />
    </Provider>,
  );
});

const savedUrl = () => store.getState().bookmarks.bookmarks.byId.b1.url;
const urlField = () => screen.getByRole("textbox", { name: /url/i });

async function replaceUrl(text: string) {
  const user = userEvent.setup();
  await user.clear(urlField());
  if (text) {
    await user.type(urlField(), text);
  }
  return user;
}

describe("BookmarkSettings (SEC-6)", () => {
  it("saves a valid address, adding https:// when missing", async () => {
    const user = await replaceUrl("youtube.com");
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(savedUrl()).toBe("https://youtube.com/");
    expect(onClose).toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "smb://host/share"])(
    "refuses %j, keeps the dialog open and explains why",
    async (text) => {
      const user = await replaceUrl(text);
      await user.click(screen.getByRole("button", { name: /done/i }));
      expect(onClose).not.toHaveBeenCalled();
      expect(savedUrl()).toBe(original.url);
      expect(screen.getByText(/https:\/\/ or http:\/\//)).toBeInTheDocument();
      expect(urlField()).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("keeps the old address when the dialog is dismissed with a refused one", async () => {
    await replaceUrl("file:///etc/passwd");
    await act(async () => {
      await userEvent.setup().keyboard("{Escape}");
    });
    expect(onClose).toHaveBeenCalled();
    expect(savedUrl()).toBe(original.url);
  });

  it("still updates the name as the user types", async () => {
    const user = userEvent.setup();
    const name = screen.getByRole("textbox", { name: /name/i });
    await user.clear(name);
    await user.type(name, "Ambience");
    expect(store.getState().bookmarks.bookmarks.byId.b1.title).toBe("Ambience");
  });
});
