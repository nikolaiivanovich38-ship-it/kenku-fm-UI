// FND-1: must stay the first import; it moves the data folder before anything uses it.
import { getDataCarryOverResult, runDataCarryOver } from "./main/migration";
// FND-9: Lyre's recent log (in memory only, for Help › Save diagnostics) starts before anything else logs.
import { startDiagnosticsLog } from "./main/diagnostics/diagnosticsLog";
import os from "os";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  shell,
  powerSaveBlocker,
} from "electron";
import "./menu";
import icon from "./assets/icon.png";
import { bundledAssetPath } from "./main/bundledAsset";
import { SessionManager } from "./main/managers/SessionManager";
import { windowFrameOptions } from "./main/window/windowFrame";
import { runAutoUpdate } from "./autoUpdate";
import { getSavedBounds, saveWindowBounds } from "./bounds";
import { openExternalIfAllowed } from "./main/security/externalLinks";
import { lockAppPage } from "./main/security/navigationGuards";
import { clearBrowsingData, registerLocalFileScheme, secureSessions } from "./main/security/sessions";
import { registerAppInfoIpc } from "./main/security/appInfoIpc";
import { confirmStartAfterCarryOver, startApp } from "./main/startup";
import { holdCloseUntilSaved, type SaveBeforeClose } from "./main/saveBeforeClose";
import { startLyreLibrary, type StartedLibrary } from "./main/lyreApi/startLibrary";

// FND-16 (0.5.1): the window is Lyre's own page; the old main window with its tabs and the old player are gone.
declare const LYRE_WINDOW_WEBPACK_ENTRY: string;
declare const LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let window: BrowserWindow | null = null;
/** PERF-6: holds quitting or closing until the player has saved (saveBeforeClose.ts). */
let saveFirst: SaveBeforeClose | null = null;
/** WP5: Lyre's library, in its own process; started when the app is ready, closed before quitting. */
let lyreLibrary: StartedLibrary | null = null;
let lyreLibraryClosed = false;

startDiagnosticsLog();

// WP1 review 1: files from the user's computer get a scheme of their own,
// which Electron accepts only before the app is ready.
registerLocalFileScheme();

// FND-1: the Windows installer check and the single-instance lock come first,
// so the Kenku FM library is copied only by the one real copy of the app,
// before any window, session or settings file touches the data folder.
const startupOutcome = startApp({
  // Creates or removes shortcuts when the Windows installer runs the app.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  handleSquirrelEvent: () => Boolean(require("electron-squirrel-startup")),
  requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
  runDataCarryOver,
  quit: () => app.quit(),
});

const createWindow = (): BrowserWindow => {
  const minWidth = 800;
  const minHeight = 600;

  // Create the browser window.
  const { bounds, maximized } = getSavedBounds(minWidth, minHeight);

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
    // FND-16 step 2: Lyre's top strip is the title bar; the system draws its own buttons over its right end.
    ...windowFrameOptions(),
    icon: bundledAssetPath(icon, __dirname),
    minWidth,
    minHeight,
    ...bounds,
  });

  if (maximized) {
    mainWindow.maximize();
  }

  // SEC-3/SEC-7/SEC-10: the window's page is trusted as the Lyre page and stays on its own document; links it
  // opens (the Discord Developer Portal in Add a bot, help links) go to the system browser, and only when they are
  // https web addresses.
  lockAppPage(mainWindow.webContents, "lyre-view", {
    onWindowOpen: (url) => openExternalIfAllowed(url, shell.openExternal),
  });

  // One set of managers for the window's whole life: reloading the page joins it again (SessionManager) without
  // closing the bots' voice connections.
  const session = new SessionManager(mainWindow, { library: lyreLibrary ?? undefined, moveOldWindowData: !lyreLibrary?.seeded });
  mainWindow.loadURL(LYRE_WINDOW_WEBPACK_ENTRY);

  // Prevent app suspension for Kenku FM to avoid playback issues
  const powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");

  // PERF-6: the player saves changes it is still holding back before its
  // view is destroyed with the session.
  const windowSaveFirst = holdCloseUntilSaved({
    save: () => session.saveBeforeClose(),
    close: () => {
      if (!mainWindow.isDestroyed()) mainWindow.close();
    },
    quit: () => app.quit(),
  });
  saveFirst = windowSaveFirst;

  mainWindow.on("close", (event) => {
    if (windowSaveFirst.holdClose(event)) {
      return;
    }
    session.destroy();
    window = null;
    powerSaveBlocker.stop(powerSaveBlockerId);
  });

  saveWindowBounds(mainWindow);

  // WP5: the daily backups start once the window shows, so they never slow the start; the audio cache is tidied
  // a while later (security review 3). FND-16: the saved Discord bots log in then too (the old Settings panel did
  // this when it opened).
  mainWindow.once("ready-to-show", () => {
    lyreLibrary?.windowShown();
    session.connectSavedBots();
  });

  if (app.isPackaged) {
    runAutoUpdate(mainWindow);
  }

  return mainWindow;
};

if (startupOutcome === "run") {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(() => {
    // FND-1: if Kenku FM was running or its library could not be copied,
    // offer to quit before any page creates an empty library in its place.
    const keepStarting = confirmStartAfterCarryOver(getDataCarryOverResult(), (prompt) =>
      dialog.showMessageBoxSync(prompt),
    );
    if (!keepStarting) {
      app.quit();
      return;
    }

    // SEC-3: permission handlers and user-agent rewrite for the app session
    // and the website-tab session, before any page loads.
    secureSessions();

    // WP5: Lyre's library opens in its own process before any page asks for it.
    lyreLibrary = startLyreLibrary();

    window = createWindow();
  });

  app.on("before-quit", (event) => {
    if (saveFirst?.holdQuit(event) || !lyreLibrary || lyreLibraryClosed) {
      return;
    }
    // WP5: close the library cleanly (backups stop, the database is closed), then quit.
    event.preventDefault();
    const closing = lyreLibrary;
    lyreLibraryClosed = true;
    closing
      .stop()
      .catch((error) => console.error("Could not close Lyre's library", error))
      .finally(() => app.quit());
  });

  // UX-12 (w6-rooms): keys Lyre took from every program for Next scene and Fade all go back on quit.
  app.on("will-quit", () => globalShortcut.unregisterAll());

  app.on("second-instance", () => {
    // Someone tried to run a second instance, we should focus our window.
    if (window) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      window = createWindow();
    }
  });

  // SEC-8: only the main window may ask for these.
  registerAppInfoIpc({
    getVersion: () => app.getVersion(),
    getPlatform: () => os.platform(),
    // Security review 3: "Clear cache" empties Lyre's audio cache (converted and local copies) as well.
    clearCache: async () => {
      await clearBrowsingData();
      await lyreLibrary?.clearAudioCache();
    },
    emptyAudioCache: async () => {
      await lyreLibrary?.clearAudioCache();
    },
  });
}
