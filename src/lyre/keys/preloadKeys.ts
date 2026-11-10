/**
 * UX-12 (w6-rooms): the Lyre page's preload half of "Next scene and Fade everything out work in other programs too"
 * (src/lyre/preload.ts exposes it as `window.lyre.keys`). The main process side is LyreManager with
 * src/main/globalKeys.ts. Only a well-formed answer, and only the two actions' names, reach the page. Kept free of
 * Electron imports, so it is unit-tested.
 */
import {
  GLOBAL_KEY_ACTIONS,
  LYRE_GLOBAL_KEY,
  LYRE_GLOBAL_KEYS_SET,
  isGlobalKeysAnswer,
  type GlobalKeyAction,
  type GlobalKeysAnswer,
  type GlobalKeysRequest,
} from "../../common/globalKeys";

export interface LyreKeysBridge {
  /** Register the two actions' keys in every program (or none when off); answers what was refused and why. */
  setGlobal(request: GlobalKeysRequest): Promise<GlobalKeysAnswer>;
  /** Each press of a registered key; returns a function that stops listening. */
  onGlobal(listener: (action: GlobalKeyAction) => void): () => void;
}

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export function createLyreKeysBridge(ipc: IpcRendererLike): LyreKeysBridge {
  return {
    setGlobal: async (request) => {
      const answer = await ipc.invoke(LYRE_GLOBAL_KEYS_SET, request);
      if (!isGlobalKeysAnswer(answer)) throw new Error("Lyre did not answer. Try again.");
      return { refused: answer.refused.map(({ action, key, message }) => ({ action, key, message })) };
    },
    onGlobal: (listener) => {
      const heard = (_event: unknown, action: unknown) => {
        if ((GLOBAL_KEY_ACTIONS as readonly unknown[]).includes(action)) listener(action as GlobalKeyAction);
      };
      ipc.on(LYRE_GLOBAL_KEY, heard);
      return () => {
        ipc.removeListener(LYRE_GLOBAL_KEY, heard);
      };
    },
  };
}
