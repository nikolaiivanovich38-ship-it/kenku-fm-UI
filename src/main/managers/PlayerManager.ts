import { ipcMain, webContents } from "electron";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;

/** How long closing waits for the player to save its changes (PERF-6). */
export const SAVE_BEFORE_CLOSE_TIMEOUT_MS = 1000;

export class PlayerManager {
  registeredViewId?: number;
  /** SEC-8: message listeners; each channel accepts only the pages IPC_CHANNELS names. */
  private ipc = guardIpc(ipcMain);
  /** OUT-5, PRV-1: told when a player page is registered (SessionManager joins it to the capture window). */
  onRegisterView?: (view: Electron.WebContents) => void;
  /** Callers of saveBeforeClose waiting for the player's PLAYER_SAVED. */
  private savedWaiters = new Set<() => void>();

  constructor() {
    this.ipc.on("PLAYER_GET_URL", this._handleGetURL);
    this.ipc.on("PLAYER_REGISTER_VIEW", this._handleRegisterView);
    this.ipc.on("PLAYER_SAVED", this._handleSaved);
  }

  destroy(): Promise<void> {
    this._finishSaving();
    this.ipc.dispose();
    return Promise.resolve();
  }

  /** The player view, or undefined when none is registered or it has been closed. */
  getView() {
    if (this.registeredViewId === undefined) {
      return undefined;
    }
    const view = webContents.fromId(this.registeredViewId);
    if (!view || view.isDestroyed()) {
      return undefined;
    }
    return view;
  }

  /**
   * PERF-6 (review 7): asks the player to save changes it is still holding
   * back (during a slider drag) and resolves once it has, or after
   * `timeoutMs`. Electron destroys the player view when the window closes
   * without running its page-hide handlers, so the window waits for this.
   * Never rejects.
   */
  saveBeforeClose(timeoutMs = SAVE_BEFORE_CLOSE_TIMEOUT_MS): Promise<void> {
    const view = this.getView();
    if (!view) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.savedWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.savedWaiters.add(done);
      view.send("PLAYER_SAVE_NOW");
    });
  }

  private _finishSaving() {
    for (const done of [...this.savedWaiters]) {
      done();
    }
  }

  /** The player has saved; only the registered player view is listened to. */
  _handleSaved = (event: Electron.IpcMainEvent) => {
    if (event.sender.id === this.registeredViewId) {
      this._finishSaving();
    }
  };


  _handleGetURL = (event: Electron.IpcMainEvent) => {
    event.returnValue = PLAYER_WINDOW_WEBPACK_ENTRY;
  };

  /**
   * Remember which view is the Kenku player so the remote API can reach it.
   * SEC-8: only a live view registered as the player is accepted, so a
   * website tab can never receive the player's remote commands.
   */
  _handleRegisterView = (_: Electron.IpcMainEvent, viewId: number) => {
    const view = webContents.fromId(viewId);
    if (!view || view.isDestroyed() || trustedContents.roleOf(view) !== "player-view") {
      console.warn("Ignored a request to register a view that is not the Kenku player");
      return;
    }
    this.registeredViewId = viewId;
    this.onRegisterView?.(view);
  };
}
