import { BrowserWindow, dialog, ipcMain, WebContentsView } from "electron";
import fs from "fs";
import { getUserAgent } from "../userAgent";
import { checkTabUrl, isRefused } from "../../common/security/urlPolicy";
import { guardIpc } from "../security/ipcGuard";
import { LYRE_VIEW_KIND, PLAYER_VIEW_KIND, REFUSED_VIEW_ID } from "../security/ipcChannels";
import {
  guardLocalFileTab,
  guardTabNavigation,
  lockAppPage,
} from "../security/navigationGuards";
import { LOCAL_FILE_PARTITION, TAB_PARTITION } from "../security/partitions";
import { createRateLimiter, POPUP_LIMIT } from "../security/popupRateLimiter";
import { trustedContents } from "../security/trustedContents";
import { classifyViewRequest } from "../security/viewKind";
import {
  LocalFileFolders,
  LocalFileGate,
  type LocalFilePrompt,
  type PromptAnswer,
  type Realpath,
} from "../security/localFiles";
import { localFileFolders } from "../security/localFileStore";
import { sharedLocalFileServer, type LocalFileServer } from "../security/localFileServer";

/** UX finding 7: a file typed in the address bar (or a bookmark) that is not there. */
export const MISSING_FILE_MESSAGE = "Can't find this file. Check the name and folder.";

/** True for an existing file (not a folder) on this computer. */
function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;
declare const PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const LYRE_WINDOW_WEBPACK_ENTRY: string;
declare const LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

/** The kinds of the app's own pages the main window may ask for (see viewKind.ts). */
type AppViewKind = typeof PLAYER_VIEW_KIND | typeof LYRE_VIEW_KIND;

export { REFUSED_VIEW_ID };

/**
 * The app's own pages that open as views: their preload (chosen here, never by
 * the renderer) and their trusted role. Webpack defines the entry constants.
 */
const APP_PAGES = {
  player: { role: "player-view", preload: () => PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY, capturable: true },
  // w3-shell: the new interface page (WP5), opened as the "Lyre" tab. Never tab-captured: its sound reaches
  // Discord only through the private player channel (WAVE3 decision "Audio").
  lyre: { role: "lyre-view", preload: () => LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY, capturable: false },
} as const;

/** `webContents.destroy()` exists at run time but is missing from Electron's type definitions. */
function destroyContents(contents: Electron.WebContents) {
  (contents as unknown as { destroy(): void }).destroy();
}

/** Sends a message to the main window about a view (title, address, new tab…). */
type Reply = (channel: string, ...args: unknown[]) => void;

export interface BrowserViewManagerOptions {
  /** SEC-15: remembered folders; defaults to the list saved in the data folder. */
  localFiles?: LocalFileFolders;
  /** SEC-15: shows the "Open this file?" question; defaults to a dialog on the main window. */
  askAboutFile?: (prompt: LocalFilePrompt) => Promise<PromptAnswer>;
  /** Resolves links in file paths; tests pass their own. */
  realpath?: Realpath;
  /** Serves files to their tabs; defaults to the one the local-files session uses. */
  fileServer?: LocalFileServer;
  /** UX finding 7: whether a (real) path is a file; defaults to a check on the disk. */
  fileExists?: (filePath: string) => boolean;
  /** w3-shell: told when the new interface page (kind "lyre") has been created and trusted. */
  onLyreView?: (contents: Electron.WebContents) => void;
}

/**
 * Manager to help create and manager browser views
 * This class is to be run on the main thread
 * For the render thread counterpart see `BrowserViewManagerPreload.ts`
 */
export class BrowserViewManagerMain {
  window: BrowserWindow;
  views: Record<number, WebContentsView>;
  topView: WebContentsView;
  /** SEC-6: limits how fast a page can turn popups into new tabs. */
  private popupLimiter = createRateLimiter<number>(POPUP_LIMIT);
  /** SEC-8: message listeners that only accept the main window. */
  private ipc = guardIpc(ipcMain);
  /** SEC-15: ids of tabs showing a file from the user's computer. */
  private localFileViews = new Set<number>();
  private localFiles: LocalFileFolders;
  private fileGate: LocalFileGate;
  private fileServer: LocalFileServer;
  private destroyed = false;
  private onLyreView?: (contents: Electron.WebContents) => void;

  constructor(window: BrowserWindow, options: BrowserViewManagerOptions = {}) {
    this.window = window;
    this.views = {};
    this.localFiles = options.localFiles ?? localFileFolders();
    this.fileGate = new LocalFileGate({
      folders: this.localFiles,
      // SEC-15: the question is shown by the main process, on the main window,
      // so a page can never answer it.
      ask: options.askAboutFile ?? ((prompt) => dialog.showMessageBox(this.window, prompt)),
      realpath: options.realpath,
      fileExists: options.fileExists ?? isFile,
      // UX finding 4/7: shown in the main window, and closed once an address opens.
      onRefused: () => this.window.webContents.send("ERROR", MISSING_FILE_MESSAGE, { kind: "address" }),
    });
    this.fileServer = options.fileServer ?? sharedLocalFileServer();
    this.onLyreView = options.onLyreView;

    // SEC-8: only the main window's own page may manage views.
    this.ipc.on("BROWSER_VIEW_CREATE_BROWSER_VIEW", this._handleCreateBrowserView);
    this.ipc.on("BROWSER_VIEW_REMOVE_BROWSER_VIEW", this._handleRemoveBrowserView);
    this.ipc.on("BROWSER_VIEW_REMOVE_ALL_BROWSER_VIEWS", this._handleRemoveAllBrowserViews);
    this.ipc.on("BROWSER_VIEW_HIDE_BROWSER_VIEW", this._handleHideBrowserView);
    this.ipc.on("BROWSER_VIEW_SHOW_BROWSER_VIEW", this._handleShowBrowserView);
    this.ipc.on("BROWSER_VIEW_SET_BROWSER_VIEW_BOUNDS", this._handleSetBrowserViewBounds);
    this.ipc.on("BROWSER_VIEW_LOAD_URL", this._handleLoadURL);
    this.ipc.on("BROWSER_VIEW_GO_FORWARD", this._handleGoForward);
    this.ipc.on("BROWSER_VIEW_GO_BACK", this._handleGoBack);
    this.ipc.on("BROWSER_VIEW_RELOAD", this._handleReload);
    this.ipc.handle("BROWSER_VIEW_OPEN_LOCAL_FILE", this._handleOpenLocalFile);
    this.ipc.handle("LOCAL_FILES_LIST_FOLDERS", () => this.localFiles.list());
    this.ipc.handle("LOCAL_FILES_FORGET_FOLDER", (_event, folder: string) => {
      this.localFiles.forget(folder);
      return this.localFiles.list();
    });

    this.window.on("resize", this._resizeListener);
  }

  destroy() {
    this.destroyed = true;
    this.ipc.dispose();
    this.window.off("resize", this._resizeListener);
    this.removeAllBrowserViews();
  }

  _resizeListener = () => {
    if (!this.window || !this.topView) {
      return;
    }
    const bounds = this.window.getBounds();
    const viewBounds = this.topView.getBounds();

    this.topView.setBounds({
      x: viewBounds.x,
      y: viewBounds.y,
      width: bounds.width - viewBounds.x,
      height: bounds.height - viewBounds.y,
    });
  };

  _handleCreateBrowserView = (
    event: Electron.IpcMainEvent,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    kind?: AppViewKind
  ) => {
    const reply: Reply = (channel, ...args) => event.reply(channel, ...args);
    const id = this.createBrowserView(url, x, y, width, height, kind, reply);
    event.returnValue = id;
  };

  /**
   * SEC-15: the address bar or a bookmark asks for a file from the user's
   * computer. The main process checks the address, asks the user (unless the
   * file is in a remembered folder) and only then opens the file in a tab of
   * its own, in the local-files partition. WP1 review 1 and 2: the tab loads
   * the file from the local-file scheme (localFileServer.ts), never from
   * file:, and the main window is told the file's own address.
   * @returns the new view's id, or `REFUSED_VIEW_ID`
   */
  _handleOpenLocalFile = async (
    event: Electron.IpcMainInvokeEvent,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<number> => {
    const approved = await this.fileGate.approve(url);
    if (!approved || this.destroyed) {
      return REFUSED_VIEW_ID;
    }
    const sender = event.sender;
    const reply: Reply = (channel, ...args) => {
      if (!sender.isDestroyed()) {
        sender.send(channel, ...args);
      }
    };
    const view = new WebContentsView({
      webPreferences: { partition: LOCAL_FILE_PARTITION },
    });
    const id = view.webContents.id;
    this.localFileViews.add(id);
    guardLocalFileTab(view.webContents, {
      onOpenWebPage: (webUrl) => this._openPopupAsTab(reply, id, webUrl),
    });
    this._addView(view, x, y, width, height);
    this._watchView(id, reply, {
      shownAddress: (address) => this.fileServer.toFileAddress(address),
    });
    const { search, hash } = new URL(approved.url);
    this._load(view, this.fileServer.addressOf(approved.filePath, `${search}${hash}`));
    return id;
  };

  /**
   * Pass the view's title, address, icon and media events on to the main window.
   * @param shownAddress for a file's tab: the address to show for the page's
   *   own one (its file: address). A file's icons are not passed on: the main
   *   window could not load them, and they would be the page's choice of file.
   * @param capturable false for a page whose audio must never be offered for
   *   tab capture (the main window offers every view that reports it loaded)
   */
  _watchView(
    id: number,
    reply: Reply,
    { shownAddress, capturable = true }: { shownAddress?: (address: string) => string | undefined; capturable?: boolean } = {},
  ) {
    const contents = this.views[id].webContents;
    contents.on("did-start-navigation", (_, url, __, isMainFrame) => {
      if (isMainFrame) {
        reply("BROWSER_VIEW_DID_NAVIGATE", id, shownAddress ? (shownAddress(url) ?? "") : url);
      }
    });
    contents.on("page-title-updated", (_, title) => {
      reply("BROWSER_VIEW_TITLE_UPDATED", id, title);
    });
    if (!shownAddress) {
      contents.on("page-favicon-updated", (_, favicons) => {
        reply("BROWSER_VIEW_FAVICON_UPDATED", id, favicons);
      });
    }
    contents.on("media-started-playing", () => {
      reply("BROWSER_VIEW_MEDIA_STARTED_PLAYING", id);
    });
    contents.on("media-paused", () => {
      reply("BROWSER_VIEW_MEDIA_PAUSED", id);
    });

    let loaded = false;
    contents.on("did-finish-load", () => {
      if (!loaded && capturable) {
        reply("BROWSER_VIEW_LOADED", id);
        loaded = true;
      }
    });
  }

  /**
   * SEC-6: a page called window.open. Open the address as a new tab only if
   * it passes the tab URL policy and the page is not flooding us with popups.
   */
  _openPopupAsTab(reply: Reply, viewId: number, url: string) {
    const check = checkTabUrl(url);
    if (isRefused(check)) {
      console.warn(`Blocked popup from tab ${viewId}: ${check.reason}`);
      return;
    }
    if (!this.popupLimiter.tryAcquire(viewId)) {
      console.warn(`Blocked popup from tab ${viewId}: too many popups`);
      return;
    }
    reply("BROWSER_VIEW_NEW_TAB", check.url);
  }

  /** Tell the user, in the main window, why a page was not opened. */
  _reportRefusedUrl(reason: string) {
    // UX finding 4: closed in the main window once an address opens.
    this.window.webContents.send("ERROR", `That page was not opened. ${reason}`, { kind: "address" });
  }

  _handleRemoveBrowserView = (_: Electron.IpcMainEvent, id: number) =>
    this.removeBrowserView(id);

  _handleRemoveAllBrowserViews = () => this.removeAllBrowserViews();

  _handleHideBrowserView = (_: Electron.IpcMainEvent, id: number) =>
    this.hideBrowserView(id);

  _handleShowBrowserView = (_: Electron.IpcMainEvent, id: number) =>
    this.showBrowserView(id);

  _handleSetBrowserViewBounds = (
    _: Electron.IpcMainEvent,
    id: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) => this.setBrowserViewBounds(id, x, y, width, height);

  _handleLoadURL = (_: Electron.IpcMainEvent, id: number, url: string) =>
    this.loadURL(id, url);

  _handleGoForward = (_: Electron.IpcMainEvent, id: number) =>
    this.goForward(id);

  _handleGoBack = (_: Electron.IpcMainEvent, id: number) => this.goBack(id);

  _handleReload = (_: Electron.IpcMainEvent, id: number) => this.reload(id);

  /**
   * Create a new browser view and attach it to the current window.
   * SEC-3/SEC-6: website tabs get their own storage partition, no preload,
   * navigation guards and the tab URL policy.
   * SEC-8: the renderer asks for the Kenku player with the kind "player" (and,
   * w3-shell, for the new interface page with the kind "lyre"); the main
   * process chooses the page's preload itself, and only for that page's own
   * address, which is registered as trusted.
   * @param url Initial URL
   * @param requestedKind `PLAYER_VIEW_KIND` or `LYRE_VIEW_KIND` for an app page, undefined for a website tab
   * @param reply sends the view's events to the main window
   * @returns id of the created view, or `REFUSED_VIEW_ID`
   */
  createBrowserView(
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    requestedKind?: AppViewKind,
    reply: Reply = (channel, ...args) => this.window.webContents.send(channel, ...args)
  ): number {
    const kind = classifyViewRequest(url, requestedKind, PLAYER_WINDOW_WEBPACK_ENTRY, LYRE_WINDOW_WEBPACK_ENTRY);
    if (kind === "refused") {
      console.error("Refused to create a view of an unknown kind");
      return REFUSED_VIEW_ID;
    }

    const appPage = kind === "tab" ? undefined : APP_PAGES[kind];
    const view = new WebContentsView({
      webPreferences: appPage ? { preload: appPage.preload() } : { partition: TAB_PARTITION },
    });
    const id = view.webContents.id;
    if (appPage) {
      trustedContents.trust(view.webContents, appPage.role);
      // SEC-7: an app page is pinned to its page; links it opens with
      // target="_blank" (help pages) still become ordinary tabs.
      lockAppPage(view.webContents, appPage.role, {
        onWindowOpen: (popupUrl) => {
          const check = checkTabUrl(popupUrl);
          if (!isRefused(check)) {
            reply("BROWSER_VIEW_NEW_TAB", check.url);
          }
        },
      });
    } else {
      guardTabNavigation(view.webContents);
      view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
        this._openPopupAsTab(reply, id, popupUrl);
        return { action: "deny" };
      });
    }
    this._addView(view, x, y, width, height);
    this._watchView(id, reply, { capturable: appPage?.capturable ?? true });

    if (kind === "lyre") {
      this.onLyreView?.(view.webContents);
    }
    if (appPage) {
      this._load(view, url);
    } else {
      this._loadTabUrl(view, url);
    }
    return id;
  }

  /** Show a new view on top, with the browser user agent, and remember it. */
  _addView(view: WebContentsView, x: number, y: number, width: number, height: number) {
    this.window.contentView.addChildView(view);
    view.setBounds({ x, y, width, height });
    // Spoof user agent to fix compatibility issues with 3rd party apps.
    // Set before loading: changing it during a load restarts the load.
    view.webContents.setUserAgent(getUserAgent());
    this.views[view.webContents.id] = view;
    this.topView = view;
  }

  /** Stop tracking a view that is being closed. */
  _forgetView(id: number) {
    this.popupLimiter.forget(id);
    this.localFileViews.delete(id);
  }

  removeBrowserView(id: number) {
    this._forgetView(id);
    if (this.views[id]) {
      if (this.topView === this.views[id]) {
        this.topView = undefined;
      }
      this.views[id].webContents.close({ waitForBeforeUnload: false });
      this.window.contentView.removeChildView(this.views[id]);
      destroyContents(this.views[id].webContents);
      delete this.views[id];
    }
  }

  removeAllBrowserViews() {
    for (const id in this.views) {
      this._forgetView(Number(id));
      this.views[id].webContents.close({ waitForBeforeUnload: false });
      this.window.contentView.removeChildView(this.views[id]);
      destroyContents(this.views[id].webContents);
      this.topView = undefined;
      delete this.views[id];
    }
  }

  hideBrowserView(id: number) {
    if (this.views[id]) {
      if (this.topView === this.views[id]) {
        this.topView = undefined;
      }
      this.window.contentView.removeChildView(this.views[id]);
    }
  }

  showBrowserView(id: number) {
    if (this.views[id]) {
      this.window.contentView.addChildView(this.views[id]);
      this.topView = this.views[id];
    }
  }

  setBrowserViewBounds(
    id: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    try {
      this.views[id].setBounds({ x, y, width, height });
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Load an address typed or chosen by the user in an existing tab.
   * SEC-6/SEC-7: only website tabs can be redirected, and only to addresses
   * the tab URL policy allows; the player view stays on its own page.
   * SEC-15: a file's tab only ever shows the file it was opened with; the
   * main window opens other addresses in a new tab instead.
   */
  loadURL(id: number, url: string) {
    const view = this.views[id];
    if (!view) {
      return;
    }
    if (trustedContents.roleOf(view.webContents) !== null) {
      console.warn("Refused to load a different page in the Kenku player");
      return;
    }
    if (this.localFileViews.has(id)) {
      console.warn("Refused to load a different address in a file's tab");
      return;
    }
    this._loadTabUrl(view, url);
  }

  /** Load `url` in a website tab if the tab URL policy allows it; an empty URL leaves a blank tab. */
  _loadTabUrl(view: WebContentsView, url: string) {
    if (typeof url !== "string" || url.trim() === "") {
      return;
    }
    const check = checkTabUrl(url);
    if (isRefused(check)) {
      console.warn(`Blocked tab address: ${check.reason}`);
      this._reportRefusedUrl(check.reason);
      return;
    }
    this._load(view, check.url);
  }

  _load(view: WebContentsView, url: string) {
    try {
      view.webContents.loadURL(url).catch((err) => console.error(err));
    } catch (err) {
      console.error(err);
    }
  }

  goForward(id: number) {
    try {
      this.views[id].webContents.navigationHistory.goForward();
    } catch (err) {
      console.error(err);
    }
  }

  goBack(id: number) {
    try {
      this.views[id].webContents.navigationHistory.goBack();
    } catch (err) {
      console.error(err);
    }
  }

  reload(id: number) {
    try {
      this.views[id].webContents.reload();
    } catch (err) {
      console.error(err);
    }
  }
}
