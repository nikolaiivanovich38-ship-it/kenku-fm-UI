/**
 * SEC-8: the app-wide messages the main window sends while it starts up
 * (version, platform) and from Settings (clear cache), registered through the
 * IPC sender guard. Called once from src/index.ts.
 */
import { ipcMain } from "electron";
import { guardIpc } from "./ipcGuard";

export interface AppInfo {
  getVersion(): string;
  getPlatform(): string;
  clearCache(): Promise<unknown>;
  /** FND-16: Lyre's audio cache only (Settings › Sound to Discord › Empty the audio cache). */
  emptyAudioCache(): Promise<unknown>;
}

/** Register the handlers; returns a function that removes them. */
export function registerAppInfoIpc(info: AppInfo): () => void {
  const ipc = guardIpc(ipcMain);
  ipc.on("GET_VERSION", (event) => {
    event.returnValue = info.getVersion();
  });
  ipc.on("GET_PLATFORM", (event) => {
    event.returnValue = info.getPlatform();
  });
  ipc.handle("CLEAR_CACHE", () => info.clearCache());
  // FND-16 (0.5.1): Settings in Lyre › Sound to Discord › Empty the audio cache. Website data is no longer cleared from
  // the Lyre page: website tabs are gone from the interface (their code is kept for OUT-12).
  ipc.handle("LYRE_EMPTY_AUDIO_CACHE", async () => {
    await info.emptyAudioCache();
  });
  return () => ipc.dispose();
}
