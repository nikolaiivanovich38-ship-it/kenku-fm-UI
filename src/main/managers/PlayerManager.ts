import { ipcMain, BrowserWindow, webContents } from "electron";
import Fastify, { FastifyInstance } from "fastify";
import { registerRemote } from "../remote";
import { PlayerRequests } from "../remote/playerRequests";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;
declare const PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export class PlayerManager {
  registeredViewId?: number;
  fastify: FastifyInstance | null = null;
  address = "127.0.0.1";
  port = "3333";
  /** PERF-9: remote API questions to the player, matched to its answers. */
  requests = new PlayerRequests();
  /** SEC-8: message listeners that only accept the main window. */
  private ipc = guardIpc(ipcMain);

  constructor() {
    this.ipc.on("PLAYER_GET_URL", this._handleGetURL);
    this.ipc.on("PLAYER_GET_PRELOAD_URL", this._handleGetPreloadURL);
    this.ipc.on("PLAYER_REGISTER_VIEW", this._handleRegisterView);
    this.ipc.on("PLAYER_START_REMOTE", this._handleStartRemote);
    this.ipc.on("PLAYER_STOP_REMOTE", this._handleStopRemote);
  }

  destroy() {
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

  _handleGetPreloadURL = (event: Electron.IpcMainEvent) => {
    event.returnValue = PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY;
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
  };
}
