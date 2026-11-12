/**
 * FND-16 step 2: the Lyre page's preload half of the window's frame (src/lyre/preload.ts exposes it as
 * `window.lyre.window`); the main process side is src/main/window/windowFrame.ts. Kept free of Electron imports.
 */
import { LYRE_TITLE_BAR, LYRE_WINDOW_MAXIMISE, isTitleBarColours, type TitleBarColours } from "../../common/windowFrame";

export interface LyreWindowBridge {
  /** The colours of the window's own buttons: those of what is under them. Malformed colours are not sent. */
  setTitleBar(colours: TitleBarColours): void;
  /** Maximise the window, or put it back. */
  toggleMaximise(): void;
}

/** The part of Electron's ipcRenderer this needs. */
export interface IpcSendLike {
  send(channel: string, ...args: unknown[]): void;
}

export function createLyreWindowBridge(ipc: IpcSendLike): LyreWindowBridge {
  return {
    setTitleBar: (colours) => {
      const exact = { color: colours?.color, symbolColor: colours?.symbolColor };
      if (isTitleBarColours(exact)) ipc.send(LYRE_TITLE_BAR, exact);
    },
    toggleMaximise: () => ipc.send(LYRE_WINDOW_MAXIMISE),
  };
}
