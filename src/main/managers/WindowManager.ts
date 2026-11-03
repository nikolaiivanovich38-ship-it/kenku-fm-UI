import { BrowserWindow, ipcMain } from "electron";
import { guardIpc } from "../security/ipcGuard";

export class WindowManager {
  window: BrowserWindow;
  /** SEC-8: message listeners that only accept the main window. */
  private ipc = guardIpc(ipcMain);

  constructor(window: BrowserWindow) {
    this.window = window;
    this.ipc.on("WINDOW_TOGGLE_MAXIMIZE", this._handleToggleMaximize);
    this.ipc.on("WINDOW_MINIMIZE", this._handleMinimize);
    this.ipc.on("WINDOW_CLOSE", this._handleClose);
  }

  destroy() {
    this.ipc.dispose();
  }

  _handleToggleMaximize = (_: Electron.IpcMainEvent) => this.toggleMaximize();

  _handleMinimize = (_: Electron.IpcMainEvent) => this.minimize();

  _handleClose = (_: Electron.IpcMainEvent) => this.close();

  toggleMaximize() {
    if (this.window.isMaximized()) {
      this.window.unmaximize();
    } else {
      this.window.maximize();
    }
  }

  minimize() {
    this.window.minimize();
  }

  close() {
    this.window.close();
  }
}
