/**
 * SEC-4: the Lyre page's preload half of the remote control's settings (src/lyre/preload.ts exposes it as
 * `window.lyre.remote`); the main process side is PlayerManager with src/main/remote/remoteControl.ts. Only a
 * well-formed state or a refusal's reason comes back. Kept free of Electron imports.
 */
import {
  REMOTE_GET,
  REMOTE_NEW_CODE,
  REMOTE_SET,
  REMOTE_STATE,
  isRemoteState,
  type RemoteBridge,
  type RemoteChange,
  type RemoteState,
} from "../../common/remoteControl";

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

const NO_ANSWER = "Lyre did not answer. Try again.";

function stateOf(answer: unknown): RemoteState {
  if (!isRemoteState(answer)) throw new Error(NO_ANSWER);
  return answer;
}

export function createLyreRemoteBridge(ipc: IpcRendererLike): RemoteBridge {
  return {
    get: async () => stateOf(await ipc.invoke(REMOTE_GET)),
    set: async (change: RemoteChange) => {
      const answer = await ipc.invoke(REMOTE_SET, change);
      const error = (answer as { error?: unknown } | null)?.error;
      return typeof error === "string" ? { error } : stateOf(answer);
    },
    newCode: async () => stateOf(await ipc.invoke(REMOTE_NEW_CODE)),
    onChange: (listener) => {
      const heard = (_event: unknown, state: unknown) => {
        if (isRemoteState(state)) listener(state);
      };
      ipc.on(REMOTE_STATE, heard);
      return () => {
        ipc.removeListener(REMOTE_STATE, heard);
      };
    },
  };
}
