// FND-1: must stay the first import; it moves the data folder before anything uses it.
import { getDataCarryOverResult, runDataCarryOver } from "./main/migration";
import os from "os";
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  powerSaveBlocker,
} from "electron";
import "./menu";
import icon from "./assets/icon.png";
import { getUserAgent } from "./main/userAgent";
import { SessionManager } from "./main/managers/SessionManager";
import { runAutoUpdate } from "./autoUpdate";
import { getSavedBounds, saveWindowBounds } from "./bounds";
import { openExternalIfAllowed } from "./main/security/externalLinks";
import { lockAppPage } from "./main/security/navigationGuards";
import { clearBrowsingData, secureSessions } from "./main/security/sessions";
import { registerAppInfoIpc } from "./main/security/appInfoIpc";
import { confirmStartAfterCarryOver, startApp } from "./main/startup";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let window: BrowserWindow | null = null;

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
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 18 },
    icon: icon,
    minWidth,
    minHeight,
    ...bounds,
  });

  if (maximized) {
    mainWindow.maximize();
  }

  // SEC-7/SEC-10: the main window stays on its own page; links it opens go to
  // the system browser, and only when they are https web addresses.
  lockAppPage(mainWindow.webContents, "main-window", {
    onWindowOpen: (url) => openExternalIfAllowed(url, shell.openExternal),
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  let session = new SessionManager(mainWindow);

  mainWindow.webContents.on("did-start-loading", () => {
    // Restart the session on refresh
    session.destroy();
    session = new SessionManager(mainWindow);
  });

  // Spoof user agent for window.navigator
  mainWindow.webContents.setUserAgent(getUserAgent());

  // Prevent app suspension for Kenku FM to avoid playback issues
  const powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");

  mainWindow.on("close", () => {
    session.destroy();
    window = null;
    powerSaveBlocker.stop(powerSaveBlockerId);
  });

  saveWindowBounds(mainWindow);

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

    window = createWindow();
  });

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
    clearCache: clearBrowsingData,
  });
}
