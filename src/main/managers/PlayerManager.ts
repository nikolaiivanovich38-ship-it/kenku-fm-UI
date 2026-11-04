import { ipcMain, BrowserWindow, webContents } from "electron";
import Fastify, { FastifyInstance } from "fastify";
import { registerRemote } from "../remote";
import { PlayerRequests } from "../remote/playerRequests";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;

/** How long closing waits for the player to save its changes (PERF-6). */
export const SAVE_BEFORE_CLOSE_TIMEOUT_MS = 1000;

export class PlayerManager {
  registeredViewId?: number;
  fastify: FastifyInstance | null = null;
  address = "127.0.0.1";
  port = "3333";
  /** PERF-9: remote API questions to the player, matched to its answers. */
  requests = new PlayerRequests();
  /** SEC-8: message listeners; each channel accepts only the pages IPC_CHANNELS names. */
  private ipc = guardIpc(ipcMain);
  /** OUT-5, PRV-1: told when a player page is registered (SessionManager joins it to the capture window). */
  onRegisterView?: (view: Electron.WebContents) => void;
  /** Callers of saveBeforeClose waiting for the player's PLAYER_SAVED. */
  private savedWaiters = new Set<() => void>();

  constructor() {
    this.ipc.on("PLAYER_GET_URL", this._handleGetURL);
    this.ipc.on("PLAYER_REGISTER_VIEW", this._handleRegisterView);
    this.ipc.on("PLAYER_START_REMOTE", this._handleStartRemote);
    this.ipc.on("PLAYER_STOP_REMOTE", this._handleStopRemote);
    this.ipc.on("PLAYER_SAVED", this._handleSaved);
  }

  destroy() {
    this._finishSaving();
    this.ipc.dispose();
    this.requests.destroy();
    this.stopRemote();
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

  startRemote(address: string, port: string) {
    this.address = address;
    this.port = port;

    this.fastify = Fastify();

    registerRemote(this);

    this.fastify.listen(this.port, this.address, (err) => {
      const windows = BrowserWindow.getAllWindows();
      if (err) {
        for (const window of windows) {
          window.webContents.send("ERROR", err.message);
        }
        this.stopRemote();
      } else {
        for (const window of windows) {
          window.webContents.send("PLAYER_REMOTE_ENABLED", true);
        }
      }
    });
  }

  stopRemote() {
    if (this.fastify) {
      this.fastify.close();
      this.fastify = null;

      const windows = BrowserWindow.getAllWindows();
      for (const window of windows) {
        window.webContents.send("PLAYER_REMOTE_ENABLED", false);
      }
    }
  }

  getRemoteInfo() {
    return `Running: ${this.fastify !== null}\nAddress: ${
      this.address
    }\nPort: ${this.port}`;
  }

  _handleStartRemote = (
    _: Electron.IpcMainEvent,
    address: string,
    port: string
  ) => this.startRemote(address, port);

  _handleStopRemote = () => this.stopRemote();

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
