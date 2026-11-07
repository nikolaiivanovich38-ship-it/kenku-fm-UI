/**
 * OUT-8 (w6-rooms): the Lyre page's preload half of the main window's Sound to Discord, Website tabs and Local files
 * settings (src/lyre/preload.ts exposes it as `window.lyre.windowSettings`). The main window keeps the first two
 * (src/common/windowSettings.ts), the main process the folders. Only well-formed answers reach the page. Kept free of
 * Electron imports, so it is unit-tested.
 */
import {
  LYRE_CLEAR_WEBSITE_DATA,
  LYRE_LOCAL_FOLDERS_FORGET,
  LYRE_LOCAL_FOLDERS_LIST,
  LYRE_WINDOW_SETTINGS_GET,
  LYRE_WINDOW_SETTINGS_SET,
  LYRE_WINDOW_SETTINGS_STATE,
  isWindowSettings,
  type WindowSettings,
  type WindowSettingsChange,
} from "../../common/windowSettings";

export interface LyreWindowSettingsBridge {
  /** The main window's settings, or null until it has told them. */
  get(): Promise<WindowSettings | null>;
  /** Change some; false when there is no main window to take the change. */
  set(change: WindowSettingsChange): Promise<boolean>;
  onChange(listener: (settings: WindowSettings) => void): () => void;
  /** Settings › Local files: the folders whose files open without asking. */
  localFolders(): Promise<string[]>;
  /** Ask again before opening files in that folder; answers the folders left. */
  forgetLocalFolder(folder: string): Promise<string[]>;
  /** Website tabs › Clear website data. */
  clearWebsiteData(): Promise<void>;
}

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

const folders = (answer: unknown): string[] => (Array.isArray(answer) ? answer.filter((f): f is string => typeof f === "string") : []);

export function createLyreWindowSettingsBridge(ipc: IpcRendererLike): LyreWindowSettingsBridge {
  return {
    get: async () => {
      const answer = await ipc.invoke(LYRE_WINDOW_SETTINGS_GET);
      return isWindowSettings(answer) ? { ...answer } : null;
    },
    set: async (change) => (await ipc.invoke(LYRE_WINDOW_SETTINGS_SET, change)) === true,
    onChange: (listener) => {
      const heard = (_event: unknown, state: unknown) => {
        if (isWindowSettings(state)) listener({ ...state });
      };
      ipc.on(LYRE_WINDOW_SETTINGS_STATE, heard);
      return () => {
        ipc.removeListener(LYRE_WINDOW_SETTINGS_STATE, heard);
      };
    },
    localFolders: async () => folders(await ipc.invoke(LYRE_LOCAL_FOLDERS_LIST)),
    forgetLocalFolder: async (folder) => folders(await ipc.invoke(LYRE_LOCAL_FOLDERS_FORGET, folder)),
    clearWebsiteData: async () => {
      await ipc.invoke(LYRE_CLEAR_WEBSITE_DATA);
    },
  };
}
