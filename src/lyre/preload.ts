import { contextBridge } from "electron";

/**
 * WP5 (w3-shell): the new interface page's bridge to the rest of the app, exposed as `window.lyre`. Minimal for now:
 * it only lets the page know it runs inside Lyre. Wave 3 adds here, one marked block per stream, and lists every new
 * IPC channel in src/main/security/ipcChannels.ts (from: "lyre-view") with its argument checks:
 *   - w3-api: the library calls (LyreApi over IPC) and their change events;
 *   - w3-host: the private audio channel to the capture window (RoomStreams) and the rooms list.
 * The page runs sandboxed with context isolation; nothing from Node or Electron reaches it except this object.
 */
const api = {
  /** Which page this is; lets shared code tell the new interface from the old player. */
  page: "lyre" as const,
};

contextBridge.exposeInMainWorld("lyre", api);

declare global {
  interface Window {
    lyre: typeof api;
  }
}
