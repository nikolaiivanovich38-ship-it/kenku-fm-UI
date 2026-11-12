/**
 * FND-16 (0.5.1): what Kenku FM (and Lyre up to 0.5.0) kept in the storage the old main window, the old player and
 * the Lyre page share (file:// localStorage): "persist:player" (playlists and soundboards) and "persist:root"
 * (settings and bookmarks), written by redux-persist, each part a JSON string. Tests write it through the Lyre page,
 * quit, and start again as someone upgrading would, so Lyre's one-time moves read it.
 */
import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";

export interface OldPlaylist {
  id: string;
  title: string;
  tracks: { id: string; url: string; title: string }[];
}

export interface OldStorage {
  playlists?: OldPlaylist[];
  /** A bot token Kenku FM kept in plain text (settings.discordToken). */
  token?: string;
  /** Sound to Discord as the old window kept it. */
  streamingMode?: "lowLatency" | "performance";
  bookmarks?: { title: string; url: string }[];
}

/** A file's address as the old player wrote it. */
export function oldFileAddress(file: string): string {
  return `file://${encodeURIComponent(file).replace(/(%2F)|(%5C)/g, "/").replace(/%3A/g, ":")}`;
}

/** Writes the old storage through the Lyre page (they share it). */
export async function writeOldStorage(lyre: Page, old: OldStorage): Promise<void> {
  const playlists = old.playlists ?? [];
  const player = {
    playlists: JSON.stringify({
      playlists: { byId: Object.fromEntries(playlists.map((p) => [p.id, { id: p.id, title: p.title, background: "", tracks: p.tracks.map((t) => t.id) }])), allIds: playlists.map((p) => p.id) },
      tracks: Object.fromEntries(playlists.flatMap((p) => p.tracks).map((t) => [t.id, t])),
    }),
    soundboards: JSON.stringify({ soundboards: { byId: {}, allIds: [] }, sounds: {} }),
    _persist: JSON.stringify({ version: 1, rehydrated: true }),
  };
  const marks = old.bookmarks ?? [];
  const root = {
    settings: JSON.stringify({ ...(old.token ? { discordToken: old.token } : {}), ...(old.streamingMode ? { streamingMode: old.streamingMode } : {}) }),
    bookmarks: JSON.stringify({ bookmarks: { byId: Object.fromEntries(marks.map((b, i) => [`b${i}`, { id: `b${i}`, ...b }])), allIds: marks.map((_, i) => `b${i}`) } }),
    _persist: JSON.stringify({ version: 4, rehydrated: true }),
  };
  await lyre.evaluate(
    ([p, r]) => {
      localStorage.setItem("persist:player", p);
      localStorage.setItem("persist:root", r);
    },
    [JSON.stringify(player), JSON.stringify(root)] as const,
  );
}

/** What a library starting in 0.5.1 for the first time has not got yet: its database and the old window's record. */
export function forgetLyreLibrary(userDataDir: string): void {
  fs.rmSync(lyreLibraryFolder(userDataDir), { recursive: true, force: true });
}

/**
 * Where the packaged app keeps the library for this data folder, as src/main/data/library.ts libraryFolder does: on
 * Windows "%LOCALAPPDATA%\<data folder's name> Library", outside the data folder; elsewhere inside it. (The 0.5.1
 * release run on Windows found the old copy of this helper cleared only the Linux place, so the one-time move's record
 * survived and the move never ran again.)
 */
export function lyreLibraryFolder(userDataDir: string): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.win32.join(process.env.LOCALAPPDATA, `${path.win32.basename(userDataDir)} Library`);
  }
  return path.join(userDataDir, "library");
}
