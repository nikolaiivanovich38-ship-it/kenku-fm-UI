import type { MigrationManifest, PersistedState } from "redux-persist";

/** UX-10: the `persist:root` version that added bookmark folders and the collapsible sidebar. */
export const BOOKMARK_FOLDERS_VERSION = 5;

type SavedState = PersistedState & { bookmarks?: { bookmarks?: unknown } & Record<string, unknown> };

/**
 * UX-10: bookmarks saved before folders existed (Kenku FM, Cue Desk 0.1.0)
 * get an empty folder list and an expanded sidebar. Every bookmark keeps its
 * place, in the main list.
 */
export function addBookmarkFolders(state: PersistedState): PersistedState {
  const saved = state as SavedState;
  return {
    ...saved,
    bookmarks: {
      ...saved.bookmarks,
      bookmarks: saved.bookmarks?.bookmarks ?? { byId: {}, allIds: [] },
      folders: { byId: {}, allIds: [] },
      sidebarCollapsed: false,
    },
  } as PersistedState;
}

/** Migrations for `persist:root` owned by the bookmarks feature; merged into the store's list. */
export const bookmarkMigrations: MigrationManifest = {
  [BOOKMARK_FOLDERS_VERSION]: addBookmarkFolders,
};
