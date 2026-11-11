import { autoUpdater, globalShortcut, ipcMain, webContents } from "electron";
import { LYRE_GLOBAL_KEY, type GlobalKeysRequest } from "../../common/globalKeys";
import { GlobalKeys, type GlobalShortcutLike } from "../globalKeys";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";
import { updateStatus, type UpdateStatus } from "../updateStatus";

declare const LYRE_WINDOW_WEBPACK_ENTRY: string;

/**
 * WP5 (w3-shell): the main process's side of the Lyre page.
 *
 * FND-16 (0.5.1): the page is the window's own page. src/index.ts gives the
 * window Lyre's preload, registers the page as trusted ("lyre-view") and pins
 * it to its own document; SessionManager attaches it here when it is made and
 * after every reload. This manager finds the page for other managers (wave 3:
 * the audio host and the library API wire themselves to it).
 */
export class LyreManager {
  /** SEC-8: message listeners; each channel accepts only the pages IPC_CHANNELS names. */
  private ipc = guardIpc(ipcMain);
  /**
   * Told when the Lyre page has been created (already trusted as "lyre-view" by BrowserViewManagerMain).
   * --- w3-host wiring --- SessionManager sets this to
   *   (view) => this.playbackManager.setLyreView(view)
   */
  onAttachView?: (view: Electron.WebContents) => void;

  /** SEC-14: stops telling the Lyre page about update changes. */
  private stopUpdateNews: () => void;
  /**
   * UX-12 (w6-rooms): Next scene and Fade all from other programs, when Settings turns it on. Each press
   * goes to the Lyre page as LYRE_GLOBAL_KEY; every key is let go of in destroy() (and on quit, src/index.ts).
   */
  private globalKeys: GlobalKeys | null = null;
  private readonly shortcuts?: GlobalShortcutLike;

  constructor(options: { updates?: UpdateStatus; shortcuts?: GlobalShortcutLike; restartIntoUpdate?: () => void } = {}) {
    const updates = options.updates ?? updateStatus;
    this.shortcuts = options.shortcuts;
    this.ipc.on("LYRE_GET_URL", this._handleGetURL);
    // SEC-14: Settings (round 7) shows what automatic updates are doing, and the last problem in plain words.
    this.ipc.handle("UPDATE_GET", () => updates.state());
    this.stopUpdateNews = updates.onChange((state) => this.getView()?.send("UPDATE_STATE", state));
    // FND-16: Restart now on Lyre's update note (until 0.5.1 the old main window said to restart).
    const restart = options.restartIntoUpdate ?? (() => autoUpdater.quitAndInstall());
    this.ipc.on("UPDATE_RESTART", () => {
      if (updates.state().kind === "ready") restart();
    });
    // --- w6-rooms ---
    this.ipc.handle("LYRE_GLOBAL_KEYS_SET", (_event, request) => this.keys().set(request as GlobalKeysRequest));
  }

  destroy() {
    this.ipc.dispose();
    this.stopUpdateNews();
    this.globalKeys?.dispose();
  }

  /** Made on first use, so a window that never turns the keys on never touches globalShortcut. */
  private keys(): GlobalKeys {
    this.globalKeys ??= new GlobalKeys(this.shortcuts ?? globalShortcut, (action) => this.getView()?.send(LYRE_GLOBAL_KEY, action));
    return this.globalKeys;
  }

  /** The new interface page, or undefined when it is not open (or has been closed). */
  getView(): Electron.WebContents | undefined {
    return webContents
      .getAllWebContents()
      .find((contents) => !contents.isDestroyed() && trustedContents.roleOf(contents) === "lyre-view");
  }

  /** The Lyre page is there (made or loaded again); anything not trusted as the Lyre page is ignored. */
  attachView(view: Electron.WebContents) {
    if (trustedContents.roleOf(view) !== "lyre-view") {
      return;
    }
    this.onAttachView?.(view);
  }

  _handleGetURL = (event: Electron.IpcMainEvent) => {
    event.returnValue = LYRE_WINDOW_WEBPACK_ENTRY;
  };
}
