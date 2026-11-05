import { ipcMain, webContents } from "electron";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";

declare const LYRE_WINDOW_WEBPACK_ENTRY: string;

/**
 * WP5 (w3-shell): the main process's side of the new interface page, shown in
 * the main window's built-in "Lyre" tab beside the old player.
 *
 * The page itself is created by BrowserViewManagerMain (kind "lyre"), which
 * gives it its preload, registers it as trusted ("lyre-view") and pins it to
 * its own document. This manager tells the main window where the page is and
 * finds the page for other managers (wave 3: the audio host and the library
 * API wire themselves to it).
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

  constructor() {
    this.ipc.on("LYRE_GET_URL", this._handleGetURL);
  }

  destroy() {
    this.ipc.dispose();
  }

  /** The new interface page, or undefined when it is not open (or has been closed). */
  getView(): Electron.WebContents | undefined {
    return webContents
      .getAllWebContents()
      .find((contents) => !contents.isDestroyed() && trustedContents.roleOf(contents) === "lyre-view");
  }

  /** BrowserViewManagerMain made a view of kind "lyre"; anything not trusted as the Lyre page is ignored. */
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
