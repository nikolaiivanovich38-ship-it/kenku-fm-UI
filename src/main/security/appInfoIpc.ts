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
  return () => ipc.dispose();
}
