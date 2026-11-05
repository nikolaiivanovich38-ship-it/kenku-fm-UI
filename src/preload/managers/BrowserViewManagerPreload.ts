import { ipcRenderer } from "electron";

/** SEC-8: the app's own pages the main window may ask for besides a website tab (w3-shell: "lyre"). */
export type BrowserViewKind = "player" | "lyre";

/**
 * Manager to help create and manager browser views
 * This class is to be run on the renderer thread
 * For the main thread counterpart see `BrowserViewManagerMain.ts`
 */
export class BrowserViewManagerPreload {
  /**
   * Create a view and return its id (-1 when the main process refuses it).
   * @param kind "player" for the Kenku player, "lyre" for the new interface; leave out for a website tab.
   */
  async createBrowserView(
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    kind?: BrowserViewKind
  ): Promise<number> {
    const viewId = ipcRenderer.sendSync(
      "BROWSER_VIEW_CREATE_BROWSER_VIEW",
      url,
      x,
      y,
      width,
      height,
      ...(kind === undefined ? [] : [kind])
    );
    return viewId;
  }

  removeBrowserView(id: number) {
    ipcRenderer.send("BROWSER_VIEW_REMOVE_BROWSER_VIEW", id);
  }

  removeAllBrowserViews() {
    ipcRenderer.send("BROWSER_VIEW_REMOVE_ALL_BROWSER_VIEWS");
  }

  hideBrowserView(id: number) {
    ipcRenderer.send("BROWSER_VIEW_HIDE_BROWSER_VIEW", id);
  }

  showBrowserView(id: number) {
    ipcRenderer.send("BROWSER_VIEW_SHOW_BROWSER_VIEW", id);
  }

  setBrowserViewBounds(
    id: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    ipcRenderer.send(
      "BROWSER_VIEW_SET_BROWSER_VIEW_BOUNDS",
      id,
      x,
      y,
      width,
      height
    );
  }

  loadURL(id: number, url: string) {
    ipcRenderer.send("BROWSER_VIEW_LOAD_URL", id, url);
  }

  goForward(id: number) {
    ipcRenderer.send("BROWSER_VIEW_GO_FORWARD", id);
  }

  goBack(id: number) {
    ipcRenderer.send("BROWSER_VIEW_GO_BACK", id);
  }

  reload(id: number) {
    ipcRenderer.send("BROWSER_VIEW_RELOAD", id);
  }

  /**
   * SEC-15: open a file from the user's computer in a tab of its own. The main
   * process asks the user first (unless the file's folder is remembered).
   * Arrow function so it can be handed to contextBridge on its own.
   * @returns the new view's id, or -1 when refused or the user said no
   */
  openLocalFile = (
    url: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<number> =>
    ipcRenderer.invoke("BROWSER_VIEW_OPEN_LOCAL_FILE", url, x, y, width, height);

  /** SEC-15: Settings > Local files, the folders whose files open without asking. */
  localFileFolders = {
    list: (): Promise<string[]> => ipcRenderer.invoke("LOCAL_FILES_LIST_FOLDERS"),
    /** @returns the folders still remembered */
    forget: (folder: string): Promise<string[]> =>
      ipcRenderer.invoke("LOCAL_FILES_FORGET_FOLDER", folder),
  };
}
