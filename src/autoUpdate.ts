import fs from "fs";
import path from "path";
import { app, autoUpdater, BrowserWindow, net } from "electron";
import { GITHUB_REPO } from "./main/appIdentity";
import { buildUpdateFeedUrl, hasPublishedRelease } from "./main/updateFeed";
import { isNoPublishedUpdate, updateStatus, type UpdateStatus } from "./main/updateStatus";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Whether the feed has a release at all (w51-fix2): false when every release is a draft, null when unknown. */
type HasRelease = (feedUrl: string) => Promise<boolean | null>;

const askFeed: HasRelease = (feedUrl) => hasPublishedRelease(feedUrl, (address) => net.fetch(address));

async function checkForAppUpdates(feedUrl: string, status: UpdateStatus, hasRelease: HasRelease) {
  if (process.platform === "win32") {
    const squirrelCommand = process.argv[1];
    if (squirrelCommand === "--squirrel-firstrun") {
      return;
    }
  }
  if (!app.isReady()) return;
  // Nothing published (a Releases page with only drafts): no update, and Update.exe is not run to fail on it.
  if ((await hasRelease(feedUrl)) === false) {
    status.upToDate();
    return;
  }
  autoUpdater.checkForUpdates();
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
 * the installer (the zip build). Before each check the feed is asked whether
 * anything is published (w51-fix2): with only drafts it is up to date, and
 * Squirrel's Update.exe is not run. Every step is recorded in `status` (the Lyre
 * page reads it for Settings); errors are logged and the first of a run is
 * shown in the main window's message box in plain words.
 */
export function runAutoUpdate(
  window: BrowserWindow,
  isInstalled: () => boolean = () => isSquirrelInstall(),
  status: UpdateStatus = updateStatus,
  hasRelease: HasRelease = askFeed,
) {
  const url = buildUpdateFeedUrl({
    repo: GITHUB_REPO,
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  });
  if (!url) {
    console.info("Automatic updates are off for this build.");
    status.off("Automatic updates are not available for this system yet.");
    return;
  }
  if (process.platform === "win32" && !isInstalled()) {
    console.info("Automatic updates are off: this copy was not set up by the installer (zip build).");
    status.off(
      "Automatic updates are off: this copy was not set up by the installer. Install Lyre with its installer to get them.",
    );
    return;
  }

  autoUpdater.setFeedURL({ url });

  const handlers: Record<string, (...args: unknown[]) => void> = {
    error: (error) => {
      // A Releases page with only drafts gives the feed's 404: nothing newer is published, so this copy is up to date.
      if (isNoPublishedUpdate(error)) {
        console.info("No update published yet:", error);
        status.upToDate();
        return;
      }
      console.error("Automatic update check failed:", error);
      if (status.failed(error)) {
        const state = status.state();
        if (state.kind === "error") window.webContents.send("ERROR", state.message);
      }
    },
    "checking-for-update": () => status.checking(),
    "update-available": () => status.downloading(),
    "update-not-available": () => status.upToDate(),
    "update-downloaded": () => {
      status.downloaded();
      const state = status.state();
      if (state.kind === "ready") window.webContents.send("MESSAGE", state.message);
    },
  };
  for (const [event, handler] of Object.entries(handlers)) {
    autoUpdater.on(event as "error", handler);
  }

  const interval = setInterval(() => {
    void checkForAppUpdates(url, status, hasRelease);
  }, CHECK_INTERVAL_MS);

  window.on("close", () => {
    for (const [event, handler] of Object.entries(handlers)) {
      autoUpdater.off(event as "error", handler);
    }
    clearInterval(interval);
  });
}
