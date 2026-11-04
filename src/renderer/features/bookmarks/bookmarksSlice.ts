import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Bookmark {
  url: string;
  icon: string;
  title: string;
  id: string;
  /** UX-10: the folder the bookmark is in; left out for the main list. */
  folderId?: string;
}

/** UX-10: a named group of bookmarks in the sidebar. */
export interface BookmarkFolder {
  id: string;
  title: string;
  /** Whether the folder shows its bookmarks. */
  open: boolean;
}

export interface BookmarksState {
  /**
   * Every bookmark. `allIds` is the order they are shown in: a folder shows
   * its own bookmarks in this order, the main list the ones without a folder.
   */
  bookmarks: {
    byId: Record<string, Bookmark>;
    allIds: string[];
  };
  /** UX-10: folders, shown above the main list in this order. */
  folders: {
    byId: Record<string, BookmarkFolder>;
    allIds: string[];
  };
  /** UX-10: the sidebar is narrowed to icons. Saved with the bookmarks. */
  sidebarCollapsed: boolean;
}

const initialState: BookmarksState = {
  bookmarks: {
    byId: {},
    allIds: [],
  },
  folders: {
    byId: {},
    allIds: [],
  },
  sidebarCollapsed: false,
};

/** Move `id` to the end of the shown order, so it appears last in its new group. */
function moveToEnd(state: BookmarksState, id: string) {
  state.bookmarks.allIds = state.bookmarks.allIds.filter((other) => other !== id);
  state.bookmarks.allIds.push(id);
}

export const bookmarksSlice = createSlice({
  name: "bookmarks",
  initialState,
  reducers: {
    addBookmark: (state, action: PayloadAction<Bookmark>) => {
      state.bookmarks.byId[action.payload.id] = action.payload;
      state.bookmarks.allIds.push(action.payload.id);
    },
    removeBookmark: (state, action: PayloadAction<string>) => {
      delete state.bookmarks.byId[action.payload];
      state.bookmarks.allIds = state.bookmarks.allIds.filter(
        (id) => id !== action.payload
      );
    },
    editBookmark: (state, action: PayloadAction<Partial<Bookmark>>) => {
      if (!action.payload.id) {
        throw Error("Id needed in editBookmark payload");
      }
      state.bookmarks.byId[action.payload.id] = {
        ...state.bookmarks.byId[action.payload.id],
        ...action.payload,
      };
    },
    /**
     * Drag and drop: put `active` where `over` is. UX-10: dropped on a
     * bookmark in another group, it joins that group.
     */
    moveBookmark: (
      state,
      action: PayloadAction<{ active: string; over: string }>
    ) => {
      const { active, over } = action.payload;
      const oldIndex = state.bookmarks.allIds.indexOf(active);
      const newIndex = state.bookmarks.allIds.indexOf(over);
      if (oldIndex === -1 || newIndex === -1) {
        return;
      }
      state.bookmarks.allIds.splice(oldIndex, 1);
      state.bookmarks.allIds.splice(newIndex, 0, active);
      const folderId = state.bookmarks.byId[over]?.folderId;
      if (folderId === undefined) {
        delete state.bookmarks.byId[active].folderId;
      } else {
        state.bookmarks.byId[active].folderId = folderId;
      }
    },
    /** UX-10: "Move to folder" (and dropping on a folder): `null` is the main list. */
    moveBookmarkToFolder: (
      state,
      action: PayloadAction<{ bookmarkId: string; folderId: string | null }>
    ) => {
      const { bookmarkId, folderId } = action.payload;
      const bookmark = state.bookmarks.byId[bookmarkId];
      if (!bookmark || (folderId !== null && !state.folders.byId[folderId])) {
        return;
      }
      if (folderId === null) {
        delete bookmark.folderId;
      } else {
        bookmark.folderId = folderId;
      }
      moveToEnd(state, bookmarkId);
    },
    addFolder: (state, action: PayloadAction<{ id: string; title: string }>) => {
      const { id, title } = action.payload;
      state.folders.byId[id] = { id, title, open: true };
      state.folders.allIds.push(id);
    },
    renameFolder: (state, action: PayloadAction<{ id: string; title: string }>) => {
      const folder = state.folders.byId[action.payload.id];
      if (folder) {
        folder.title = action.payload.title;
      }
    },
    /** Delete a folder. Its bookmarks are kept and go back to the main list. */
    removeFolder: (state, action: PayloadAction<string>) => {
      for (const bookmark of Object.values(state.bookmarks.byId)) {
        if (bookmark.folderId === action.payload) {
          delete bookmark.folderId;
        }
      }
      delete state.folders.byId[action.payload];
      state.folders.allIds = state.folders.allIds.filter((id) => id !== action.payload);
    },
    /** Show or hide a folder's bookmarks. */
    toggleFolder: (state, action: PayloadAction<string>) => {
      const folder = state.folders.byId[action.payload];
      if (folder) {
        folder.open = !folder.open;
      }
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
  },
});

export const {
  addBookmark,
  removeBookmark,
  editBookmark,
  moveBookmark,
  moveBookmarkToFolder,
  addFolder,
  renameFolder,
  removeFolder,
  toggleFolder,
  setSidebarCollapsed,
} = bookmarksSlice.actions;

export default bookmarksSlice.reducer;
