import fs from "fs";
import path from "path";
import { app, autoUpdater, BrowserWindow } from "electron";
import { GITHUB_REPO } from "./main/appIdentity";
import { buildUpdateFeedUrl } from "./main/updateFeed";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function checkForAppUpdates() {
  if (process.platform === "win32") {
    const squirrelCommand = process.argv[1];
    if (squirrelCommand === "--squirrel-firstrun") {
      return;
    }
  }

  if (app.isReady()) {
    autoUpdater.checkForUpdates();
  }
}

/**
 * SEC-14: true when this copy was installed by the Windows installer
 * (Squirrel), which puts `Update.exe` one folder above the app's own folder.
 * The zip build has no `Update.exe`, so Electron's updater cannot work there.
 */
export function isSquirrelInstall(
  execPath: string = process.execPath,
  existsSync: (file: string) => boolean = fs.existsSync,
): boolean {
  return existsSync(path.join(path.dirname(execPath), "..", "Update.exe"));
}

/**
 * SEC-14: check the fork's GitHub releases for updates every 15 minutes.
 * Does nothing when the feed cannot be built (repository not configured or
 * platform without update support) and, on Windows, for copies not set up by
 * the installer (the zip build). Update errors are logged, not ignored.
 */
export function runAutoUpdate(window: BrowserWindow, isInstalled: () => boolean = () => isSquirrelInstall()) {
  const url = buildUpdateFeedUrl({
    repo: GITHUB_REPO,
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  });
  if (!url) {
    console.info("Automatic updates are off for this build.");
    return;
  }
  if (process.platform === "win32" && !isInstalled()) {
    console.info("Automatic updates are off: this copy was not set up by the installer (zip build).");
    return;
  }

  autoUpdater.setFeedURL({ url });

  const handleError = (error: Error) => {
    console.error("Automatic update check failed:", error);
  };
  const handleUpdateDownloaded = () => {
    window.webContents.send("MESSAGE", "Update Available. Restart to apply.");
  };

  autoUpdater.on("error", handleError);
  autoUpdater.on("update-downloaded", handleUpdateDownloaded);

  const interval = setInterval(() => {
    checkForAppUpdates();
  }, CHECK_INTERVAL_MS);

  window.on("close", () => {
    autoUpdater.off("error", handleError);
    autoUpdater.off("update-downloaded", handleUpdateDownloaded);
    clearInterval(interval);
  });
}
