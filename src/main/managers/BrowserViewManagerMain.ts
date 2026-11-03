import { BrowserWindow, ipcMain, WebContentsView } from "electron";
import { getUserAgent } from "../userAgent";
import { checkTabUrl, isRefused } from "../../common/security/urlPolicy";
import { guardIpc } from "../security/ipcGuard";
import { PLAYER_VIEW_KIND, REFUSED_VIEW_ID } from "../security/ipcChannels";
import { guardTabNavigation, lockAppPage } from "../security/navigationGuards";
import { TAB_PARTITION } from "../security/partitions";
import { createRateLimiter, POPUP_LIMIT } from "../security/popupRateLimiter";
import { trustedContents } from "../security/trustedContents";
import { classifyViewRequest } from "../security/viewKind";

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;
declare const PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export { REFUSED_VIEW_ID };

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

  constructor(window: BrowserWindow) {
    this.window = window;
    this.views = {};

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

    this.window.on("resize", this._resizeListener);
  }

  destroy() {
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
    kind?: typeof PLAYER_VIEW_KIND
  ) => {
    const id = this.createBrowserView(url, x, y, width, height, kind);
    if (id === REFUSED_VIEW_ID) {
      event.returnValue = id;
      return;
    }
    this.views[id].webContents.on(
      "did-start-navigation",
      (_, url, __, isMainFrame) => {
        if (isMainFrame) {
          event.reply("BROWSER_VIEW_DID_NAVIGATE", id, url);
        }
      }
    );
    this.views[id].webContents.on("page-title-updated", (_, title) => {
      event.reply("BROWSER_VIEW_TITLE_UPDATED", id, title);
    });
    this.views[id].webContents.on("page-favicon-updated", (_, favicons) => {
      event.reply("BROWSER_VIEW_FAVICON_UPDATED", id, favicons);
    });
    this.views[id].webContents.on("media-started-playing", () => {
      event.reply("BROWSER_VIEW_MEDIA_STARTED_PLAYING", id);
    });
    this.views[id].webContents.on("media-paused", () => {
      event.reply("BROWSER_VIEW_MEDIA_PAUSED", id);
    });
    if (trustedContents.roleOf(this.views[id].webContents) === "player-view") {
      // SEC-7: the player view is pinned to its page; links it opens with
      // target="_blank" (help pages) still become ordinary tabs.
      lockAppPage(this.views[id].webContents, "player-view", {
        onWindowOpen: (url) => {
          const check = checkTabUrl(url);
          if (!isRefused(check)) {
            event.reply("BROWSER_VIEW_NEW_TAB", check.url);
          }
        },
      });
    } else {
      this.views[id].webContents.setWindowOpenHandler(({ url }) => {
        this._openPopupAsTab(event, id, url);
        return { action: "deny" };
      });
    }

    let loaded = false;
    this.views[id].webContents.on("did-finish-load", () => {
      if (!loaded) {
        event.reply("BROWSER_VIEW_LOADED", id);
        loaded = true;
      }
    });
    event.returnValue = id;
  };

  /**
   * SEC-6: a page called window.open. Open the address as a new tab only if
   * it passes the tab URL policy and the page is not flooding us with popups.
   */
  _openPopupAsTab(event: Electron.IpcMainEvent, viewId: number, url: string) {
    const check = checkTabUrl(url);
    if (isRefused(check)) {
      console.warn(`Blocked popup from tab ${viewId}: ${check.reason}`);
      return;
    }
    if (!this.popupLimiter.tryAcquire(viewId)) {
      console.warn(`Blocked popup from tab ${viewId}: too many popups`);
      return;
    }
    event.reply("BROWSER_VIEW_NEW_TAB", check.url);
  }

  /** Tell the user, in the main window, why a page was not opened. */
  _reportRefusedUrl(reason: string) {
    this.window.webContents.send("ERROR", `That page was not opened. ${reason}`);
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
   * SEC-8: the renderer asks for the Kenku player with the kind "player"; the
   * main process chooses the player's preload itself, and only for the
   * player's own page, which is registered as trusted.
   * @param url Initial URL
   * @param requestedKind `PLAYER_VIEW_KIND` for the Kenku player, undefined for a website tab
   * @returns id of the created view, or `REFUSED_VIEW_ID`
   */
  createBrowserView(
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    requestedKind?: typeof PLAYER_VIEW_KIND
  ): number {
    const kind = classifyViewRequest(url, requestedKind, PLAYER_WINDOW_WEBPACK_ENTRY);
    if (kind === "refused") {
      console.error("Refused to create a view of an unknown kind");
      return REFUSED_VIEW_ID;
    }

    const view = new WebContentsView({
      webPreferences:
        kind === "player"
          ? { preload: PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY }
          : { partition: TAB_PARTITION },
    });
    if (kind === "player") {
      trustedContents.trust(view.webContents, "player-view");
    } else {
      guardTabNavigation(view.webContents);
    }
    this.window.contentView.addChildView(view);

    view.setBounds({
      x,
      y,
      width,
      height,
    });

    if (kind === "player") {
      this._load(view, url);
    } else {
      this._loadTabUrl(view, url);
    }

    // Spoof user agent to fix compatibility issues with 3rd party apps
    view.webContents.setUserAgent(getUserAgent());

    this.views[view.webContents.id] = view;
    this.topView = view;

    return view.webContents.id;
  }

  removeBrowserView(id: number) {
    this.popupLimiter.forget(id);
    if (this.views[id]) {
      if (this.topView === this.views[id]) {
        this.topView = undefined;
      }
      this.views[id].webContents.close({ waitForBeforeUnload: false });
      this.window.contentView.removeChildView(this.views[id]);
      (this.views[id].webContents as any).destroy();
      delete this.views[id];
    }
  }

  removeAllBrowserViews() {
    for (let id in this.views) {
      this.views[id].webContents.close({ waitForBeforeUnload: false });
      this.window.contentView.removeChildView(this.views[id]);
      (this.views[id].webContents as any).destroy();
      this.topView = undefined;
      this.popupLimiter.forget(Number(id));
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
