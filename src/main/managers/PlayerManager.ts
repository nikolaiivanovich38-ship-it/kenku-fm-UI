import { app, ipcMain, BrowserWindow, safeStorage, webContents } from "electron";
import os from "os";
import { homeNetworkAddress, ownNetworkAddresses } from "../remote/homeNetwork";
import { PlayerRequests } from "../remote/playerRequests";
import { RemoteControl, type RemoteState } from "../remote/remoteControl";
import { RemoteSettingsStore, type OldRemoteSetting, type RemoteSettings } from "../remote/remoteSettings";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;
declare const __CUE_DESK_TEST_BUILD__: boolean;

/** How long closing waits for the player to save its changes (PERF-6). */
export const SAVE_BEFORE_CLOSE_TIMEOUT_MS = 1000;

/**
 * SEC-4: the remote control's settings and secret code, shared by every PlayerManager (one per main-window load), so
 * a code that cannot be saved encrypted stays the same until Lyre quits.
 */
let sharedRemoteStore: RemoteSettingsStore | undefined;
function remoteSettingsStore(): RemoteSettingsStore {
  sharedRemoteStore ??= new RemoteSettingsStore(RemoteSettingsStore.fileIn(app.getPath("userData")), safeStorage, { ownAddresses: thisComputersAddresses });
  return sharedRemoteStore;
}

/**
 * The last PlayerManager's remote server, still closing. When the main window reloads, the next PlayerManager is
 * made at once; it waits for this so its server does not find the port still taken.
 */
let previousRemoteClosed: Promise<void> = Promise.resolve();

export interface PlayerManagerOptions {
  /** Tests give their own store; the app uses the shared one in the data folder. */
  remoteStore?: RemoteSettingsStore;
  /** Tests give their own; the app reads this computer's network cards each time Settings asks. */
  homeAddress?: () => string | null;
}

/**
 * Round 7 (Settings › Remote control › Your home network): this computer's private network address. Test builds may
 * be given one with CUE_DESK_FAKE_HOME_ADDRESS (the e2e machine has no home network); a release build never reads it.
 */
function thisComputersHomeAddress(): string | null {
  return fakeHomeAddress() || homeNetworkAddress(os.networkInterfaces());
}

/** CR-2: the addresses the remote control may listen on besides 127.0.0.1 must be among these (the test build's too). */
function thisComputersAddresses(): string[] {
  const fake = fakeHomeAddress();
  return [...ownNetworkAddresses(os.networkInterfaces()), ...(fake ? [fake] : [])];
}

function fakeHomeAddress(): string | undefined {
  return typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__ ? process.env.CUE_DESK_FAKE_HOME_ADDRESS : undefined;
}

export class PlayerManager {
  registeredViewId?: number;
  /** PERF-9: remote API questions to the player, matched to its answers. */
  requests = new PlayerRequests();
  /** SEC-4: the remote-control server, on only when its settings say so, and only with the secret code. */
  readonly remote: RemoteControl;
  /** SEC-8: message listeners; each channel accepts only the pages IPC_CHANNELS names. */
  private ipc = guardIpc(ipcMain);
  /** OUT-5, PRV-1: told when a player page is registered (SessionManager joins it to the capture window). */
  onRegisterView?: (view: Electron.WebContents) => void;
  /** Callers of saveBeforeClose waiting for the player's PLAYER_SAVED. */
  private savedWaiters = new Set<() => void>();

  constructor(options: PlayerManagerOptions = {}) {
    this.remote = new RemoteControl({
      store: options.remoteStore ?? remoteSettingsStore(),
      host: this,
      onChange: (state) => this._tellPagesAboutRemote(state),
      homeAddress: options.homeAddress ?? thisComputersHomeAddress,
    });
    this.ipc.on("PLAYER_GET_URL", this._handleGetURL);
    this.ipc.on("PLAYER_REGISTER_VIEW", this._handleRegisterView);
    this.ipc.on("REMOTE_MOVE_OLD_SETTING", this._handleMoveOldRemoteSetting);
    this.ipc.on("PLAYER_SAVED", this._handleSaved);
    this.ipc.handle("REMOTE_GET", () => this.remote.state());
    this.ipc.handle("REMOTE_SET", (_event, change) => this.remote.set(change as Partial<RemoteSettings>));
    this.ipc.handle("REMOTE_NEW_CODE", () => this.remote.newCode());
    // Left on last time: on again, without waiting for a page to ask.
    void previousRemoteClosed.then(() => this.remote.start());
  }

  /** Resolves once the remote-control server has stopped listening. */
  destroy(): Promise<void> {
    this._finishSaving();
    this.ipc.dispose();
    this.requests.destroy();
    previousRemoteClosed = this.remote.close();
    return previousRemoteClosed;
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


  /** The main window's player tab shows whether the remote runs; the Lyre page gets the whole state. */
  private _tellPagesAboutRemote(state: RemoteState) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("PLAYER_REMOTE_ENABLED", state.running);
    }
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed() && trustedContents.roleOf(contents) === "lyre-view") {
        contents.send("REMOTE_STATE", state);
      }
    }
  }

  /** Review 0.5.0 CR-3: the main window's old remote control choice, taken once (RemoteSettingsStore.moveOldSetting). */
  _handleMoveOldRemoteSetting = (_: Electron.IpcMainEvent, old: OldRemoteSetting): void => {
    void this.remote.moveOldSetting(old);
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
