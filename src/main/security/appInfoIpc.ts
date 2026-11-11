/**
 * SEC-8: the app-wide message the Lyre page sends from Settings (empty the audio cache), registered through the IPC
 * sender guard. Called once from src/index.ts. FND-16: the old main window's GET_VERSION, GET_PLATFORM and
 * CLEAR_CACHE went with it.
 */
import { ipcMain } from "electron";
import { guardIpc } from "./ipcGuard";

export interface AppInfo {
  /** FND-16: Lyre's audio cache only (Settings › Sound to Discord › Empty the audio cache). */
  emptyAudioCache(): Promise<unknown>;
}

/** Register the handlers; returns a function that removes them. */
export function registerAppInfoIpc(info: AppInfo): () => void {
  const ipc = guardIpc(ipcMain);
  // FND-16 (0.5.1): Settings in Lyre › Sound to Discord › Empty the audio cache. Website data is no longer cleared from
  // the Lyre page: website tabs are gone from the interface (their code is kept for OUT-12).
  ipc.handle("LYRE_EMPTY_AUDIO_CACHE", async () => {
    await info.emptyAudioCache();
  });
  return () => ipc.dispose();
}
