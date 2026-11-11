/**
 * OUT-8 (w6-rooms): Settings in Lyre shows and changes the main window's Sound to Discord and Website tabs settings.
 * The main window keeps them (as Kenku FM did); this passes its state to the Lyre page and the Lyre page's changes to
 * the main window. See src/common/windowSettings.ts. Channels and their checks: ipcChannels.ts "w6-rooms".
 */
import { ipcMain } from "electron";

import { LYRE_WINDOW_SETTINGS_STATE, WINDOW_SETTINGS_SET, type WindowSettings, type WindowSettingsChange } from "../../common/windowSettings";
import { guardIpc } from "../security/ipcGuard";

export interface WindowSettingsBridgeOptions {
  /** The main window's page. */
  mainWindow: () => Electron.WebContents | undefined;
  /** The Lyre page, when it is open. */
  lyreView: () => Electron.WebContents | undefined;
}

export class WindowSettingsBridge {
  private readonly ipc = guardIpc(ipcMain);
  private latest: WindowSettings | null = null;

  constructor(private readonly options: WindowSettingsBridgeOptions) {
    this.ipc.on("WINDOW_SETTINGS_STATE", (_event, state) => {
      this.latest = { ...(state as WindowSettings) };
      const view = this.options.lyreView();
      if (view && !view.isDestroyed()) view.send(LYRE_WINDOW_SETTINGS_STATE, this.latest);
    });
    this.ipc.handle("LYRE_WINDOW_SETTINGS_GET", () => this.latest);
    this.ipc.handle("LYRE_WINDOW_SETTINGS_SET", (_event, change) => {
      const main = this.options.mainWindow();
      if (!main || main.isDestroyed()) return false;
      main.send(WINDOW_SETTINGS_SET, { ...(change as WindowSettingsChange) });
      return true;
    });
  }

  destroy(): void {
    this.ipc.dispose();
  }
}
