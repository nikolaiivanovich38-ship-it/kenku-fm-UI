import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(window, { kenku: { platform: "win32", playerGetURL: () => "player.html" } });
  // Bookmarks as Kenku FM 1.5.5 / Cue Desk 0.1.0 saved them (persist:root, version 4).
  // redux-persist stores each top-level key as its own JSON string.
  window.localStorage.setItem(
    "persist:root",
    JSON.stringify({
      bookmarks: JSON.stringify({
        bookmarks: {
          byId: {
            b1: { id: "b1", url: "https://tabletopaudio.com/", title: "Tabletop Audio", icon: "" },
            b2: { id: "b2", url: "youtube.com", title: "YouTube", icon: "" },
          },
          allIds: ["b2", "b1"],
        },
      }),
      _persist: JSON.stringify({ version: 4, rehydrated: true }),
    }),
  );
});

import { persistor, store } from "../../app/store";

describe("saved bookmarks after the update (UX-10)", () => {
  it("are all still there, in the same order, with no folders and the sidebar open", async () => {
    await vi.waitFor(() => expect(persistor.getState().bootstrapped).toBe(true));
    const { bookmarks } = store.getState();
    expect(bookmarks.bookmarks.allIds).toEqual(["b2", "b1"]);
    expect(bookmarks.bookmarks.byId.b1).toMatchObject({ title: "Tabletop Audio" });
    expect(bookmarks.bookmarks.byId.b2.folderId).toBeUndefined();
    expect(bookmarks.folders).toEqual({ byId: {}, allIds: [] });
    expect(bookmarks.sidebarCollapsed).toBe(false);
  });
});
