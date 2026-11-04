import { describe, expect, it } from "vitest";
import reducer, {
  addBookmark,
  addFolder,
  type Bookmark,
  type BookmarksState,
  moveBookmark,
  moveBookmarkToFolder,
  removeBookmark,
  removeFolder,
  renameFolder,
  setSidebarCollapsed,
  toggleFolder,
} from "./bookmarksSlice";

const bookmark = (id: string): Bookmark => ({ id, url: `https://${id}.example/`, title: id, icon: "" });

function withBookmarks(...ids: string[]): BookmarksState {
  return ids.reduce((state, id) => reducer(state, addBookmark(bookmark(id))), reducer(undefined, { type: "init" }));
}

/** Bookmark ids in each group, in order: "" is the main list. */
function groups(state: BookmarksState): Record<string, string[]> {
  const result: Record<string, string[]> = { "": [] };
  for (const id of state.folders.allIds) result[id] = [];
  for (const id of state.bookmarks.allIds) {
    result[state.bookmarks.byId[id].folderId ?? ""].push(id);
  }
  return result;
}

describe("bookmark folders (UX-10)", () => {
  it("starts with no folders and an expanded sidebar", () => {
    const state = reducer(undefined, { type: "init" });
    expect(state.folders).toEqual({ byId: {}, allIds: [] });
    expect(state.sidebarCollapsed).toBe(false);
  });

  it("creates, renames, opens and closes a folder", () => {
    let state = reducer(undefined, addFolder({ id: "f1", title: "Combat" }));
    expect(state.folders.byId.f1).toEqual({ id: "f1", title: "Combat", open: true });
    state = reducer(state, renameFolder({ id: "f1", title: "Battle music" }));
    state = reducer(state, toggleFolder("f1"));
    expect(state.folders.byId.f1).toEqual({ id: "f1", title: "Battle music", open: false });
    expect(state.folders.allIds).toEqual(["f1"]);
  });

  it("moves a bookmark into a folder (at the end) and back to the main list", () => {
    let state = withBookmarks("a", "b", "c");
    state = reducer(state, addFolder({ id: "f1", title: "Combat" }));
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "a", folderId: "f1" }));
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "c", folderId: "f1" }));
    expect(groups(state)).toEqual({ "": ["b"], f1: ["a", "c"] });
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "a", folderId: null }));
    expect(groups(state)).toEqual({ "": ["b", "a"], f1: ["c"] });
  });

  it("ignores a move to a folder that does not exist", () => {
    let state = withBookmarks("a");
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "a", folderId: "missing" }));
    expect(state.bookmarks.byId.a.folderId).toBeUndefined();
  });

  it("deleting a folder keeps its bookmarks, in the main list", () => {
    let state = withBookmarks("a", "b");
    state = reducer(state, addFolder({ id: "f1", title: "Combat" }));
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "a", folderId: "f1" }));
    state = reducer(state, removeFolder("f1"));
    expect(state.folders).toEqual({ byId: {}, allIds: [] });
    // They come after the bookmarks that were already in the main list.
    expect(groups(state)).toEqual({ "": ["b", "a"] });
  });

  it("dragging a bookmark onto one in a folder puts it in that folder, at that place", () => {
    let state = withBookmarks("a", "b", "c");
    state = reducer(state, addFolder({ id: "f1", title: "Combat" }));
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "b", folderId: "f1" }));
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "c", folderId: "f1" }));
    state = reducer(state, moveBookmark({ active: "a", over: "c" }));
    // Moving down puts it after the bookmark it was dropped on, as in the tab bar.
    expect(groups(state)).toEqual({ "": [], f1: ["b", "c", "a"] });
    expect(state.bookmarks.byId.a.folderId).toBe("f1");
  });

  it("removing a bookmark still works inside a folder", () => {
    let state = withBookmarks("a");
    state = reducer(state, addFolder({ id: "f1", title: "Combat" }));
    state = reducer(state, moveBookmarkToFolder({ bookmarkId: "a", folderId: "f1" }));
    state = reducer(state, removeBookmark("a"));
    expect(groups(state)).toEqual({ "": [], f1: [] });
  });
});

describe("collapsible sidebar (UX-10)", () => {
  it("remembers whether the sidebar is collapsed", () => {
    let state = reducer(undefined, setSidebarCollapsed(true));
    expect(state.sidebarCollapsed).toBe(true);
    state = reducer(state, setSidebarCollapsed(false));
    expect(state.sidebarCollapsed).toBe(false);
  });
});
