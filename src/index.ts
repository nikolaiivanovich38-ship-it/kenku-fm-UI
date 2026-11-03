// FND-1: must stay the first import; it moves the data folder before anything uses it.
import { runDataCarryOver } from "./main/migration";
import os from "os";
import {
  app,
  BrowserWindow,
  components,
  shell,
  ipcMain,
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

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

runDataCarryOver();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require("electron-squirrel-startup")) {
  app.quit();
}

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

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Workaround to allow for webpack support with widevine
  // https://github.com/castlabs/electron-releases/issues/116
  const widevine = components;

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    let hasWidevineError = false;

    try {
      // Wait for widevine to load
      await widevine.whenReady();
      console.log("components ready:", components.status());
    } catch (e) {
      hasWidevineError = true;
      console.error("components failed to load:", JSON.stringify(e, null, 2));
    }

    // SEC-3: permission handlers and user-agent rewrite for the app session
    // and the website-tab session, before any page loads.
    secureSessions();

    window = createWindow();

    if (hasWidevineError) {
      window.once("ready-to-show", () => {
        window.webContents.send(
          "ERROR",
          "Widevine DRM Error: Licensed music playback is disabled",
        );
      });
    }
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

  ipcMain.on("GET_VERSION", (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.on("GET_PLATFORM", (event) => {
    event.returnValue = os.platform();
  });

  ipcMain.handle("CLEAR_CACHE", () => clearBrowsingData());
}
