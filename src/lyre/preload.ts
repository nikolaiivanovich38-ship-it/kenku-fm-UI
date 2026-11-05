import { contextBridge, ipcRenderer, webUtils } from "electron";

import { createLyreApiBridge, type IpcRendererLike as ApiIpc } from "./api/preloadApi";
import { createLyreAudioBridge, type IpcRendererLike as AudioIpc } from "./audio/preloadAudio";

/**
 * WP5: the new interface page's bridge to the rest of the app, exposed as `window.lyre`. Every IPC channel it uses
 * is listed in src/main/security/ipcChannels.ts (from: "lyre-view") with its argument checks.
 *   - api (w3-api): LyreApi calls (LYRE_API_CALL) and its change events (LYRE_API_EVENT); src/lyre/api/preloadApi.ts.
 *   - audio (w3-host): the private audio channel to the capture window, the rooms list, MEDIA_PREPARE;
 *     src/lyre/audio/preloadAudio.ts.
 *   - files (w3-library): where a file dropped on the page is on disk, so the Library and Playlists can import it
 *     (webUtils.getPathForFile, as the old player's preload; no IPC). "" for a file that is not on disk.
 * The page runs sandboxed with context isolation; nothing from Node or Electron reaches it except this object.
 */
const api = {
  /** Which page this is; lets shared code tell the new interface from the old player. */
  page: "lyre" as const,
  // ipcRenderer's listeners take Electron's own event type; the bridges only pass it by.
  api: createLyreApiBridge(ipcRenderer as unknown as ApiIpc),
  audio: createLyreAudioBridge(ipcRenderer as unknown as AudioIpc, window),
  files: { pathOf: (file: File): string => webUtils.getPathForFile(file) },
};

contextBridge.exposeInMainWorld("lyre", api);

declare global {
  interface Window {
    lyre: typeof api;
  }
}
