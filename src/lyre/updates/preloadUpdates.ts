/**
 * SEC-14: the Lyre page's preload half of the automatic-updates state (src/lyre/preload.ts exposes it as
 * `window.lyre.updates`); the main process side is LyreManager with src/main/updateStatus.ts. Kept free of Electron
 * imports.
 */
import { UPDATE_GET, UPDATE_RESTART, UPDATE_STATE, isUpdateState, type UpdatesBridge } from "../../common/appUpdates";

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export function createLyreUpdatesBridge(ipc: IpcRendererLike): UpdatesBridge {
  return {
    get: async () => {
      const answer = await ipc.invoke(UPDATE_GET);
      if (!isUpdateState(answer)) throw new Error("Lyre did not answer. Try again.");
      return answer;
    },
    onChange: (listener) => {
      const heard = (_event: unknown, state: unknown) => {
        if (isUpdateState(state)) listener(state);
      };
      ipc.on(UPDATE_STATE, heard);
      return () => {
        ipc.removeListener(UPDATE_STATE, heard);
      };
    },
    restart: () => ipc.send(UPDATE_RESTART),
  };
}
