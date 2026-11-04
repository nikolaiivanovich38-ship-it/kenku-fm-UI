/**
 * The library data layer (WP3, DAT-11): SQLite database, schema upgrades,
 * repository functions, search, undo/redo and backups, and the design's domain
 * shapes (repo/domain.ts, repo/profiles.ts), and bringing audio in (import/). Not yet connected to the player or
 * to IPC; the new interface (wave 3) will use it from the main process.
 * See docs/data-model.md.
 */
export { openLibrary, restoreBackup, startDailyBackups, libraryFolder, type Library, type LibraryOptions } from "./library";
export { listBackups, latestGoodBackup, findLatestGoodBackup, BACKUPS_TO_KEEP, type BackupInfo, type BackupKind } from "./backups";
export { LibraryDatabaseError, LibraryBusyError, ValidationError, NotFoundError, type LibraryErrorCode } from "./errors";
export { UndoHistory, type UndoState } from "./undo";
export { Store } from "./store";
export * from "./types";
export * from "./repo/roots";
export * from "./repo/tracks";
export * from "./repo/markers";
export * from "./repo/folders";
export * from "./repo/playlists";
export * from "./repo/boards";
export * from "./repo/tags";
export * from "./repo/campaigns";
export * from "./repo/profiles";
export * from "./repo/domain";
export * from "./repo/search";
export * from "./import";
