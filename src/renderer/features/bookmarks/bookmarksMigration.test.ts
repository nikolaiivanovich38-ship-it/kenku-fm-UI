import { describe, expect, it } from "vitest";
import { createMigrate } from "redux-persist";
import { BOOKMARK_FOLDERS_VERSION, bookmarkMigrations } from "./bookmarksMigration";

/** What Kenku FM 1.5.5 and Cue Desk 0.1.0 saved under persist:root (version 4). */
const savedBeforeFolders = {
  bookmarks: {
    bookmarks: {
      byId: {
        b1: { id: "b1", url: "https://tabletopaudio.com/", title: "Tabletop Audio", icon: "" },
        b2: { id: "b2", url: "youtube.com", title: "YouTube", icon: "" },
      },
      allIds: ["b2", "b1"],
    },
  },
  settings: { urlBarEnabled: true },
  _persist: { version: 4, rehydrated: false },
};

describe("bookmark folders migration (UX-10)", () => {
  it("is the next persisted version", () => {
    expect(BOOKMARK_FOLDERS_VERSION).toBe(5);
  });

  it("keeps every existing bookmark where it was and adds an empty folder list", async () => {
    const migrate = createMigrate(bookmarkMigrations, { debug: false });
    const migrated = (await migrate(savedBeforeFolders, BOOKMARK_FOLDERS_VERSION)) as unknown as {
      bookmarks: Record<string, unknown>;
      settings: unknown;
    };
    expect(migrated.bookmarks).toEqual({
      bookmarks: savedBeforeFolders.bookmarks.bookmarks,
      folders: { byId: {}, allIds: [] },
      sidebarCollapsed: false,
    });
    expect(migrated.settings).toEqual({ urlBarEnabled: true });
  });

  it("copes with a saved state that has no bookmarks yet", async () => {
    const migrate = createMigrate(bookmarkMigrations, { debug: false });
    const savedWithoutBookmarks = { settings: {}, _persist: { version: 4, rehydrated: false } };
    const migrated = (await migrate(savedWithoutBookmarks, BOOKMARK_FOLDERS_VERSION)) as unknown as { bookmarks: unknown };
    expect(migrated.bookmarks).toEqual({
      bookmarks: { byId: {}, allIds: [] },
      folders: { byId: {}, allIds: [] },
      sidebarCollapsed: false,
    });
  });
});
