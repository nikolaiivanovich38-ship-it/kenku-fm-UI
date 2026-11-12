import fs from "fs";
import path from "path";
import { app, autoUpdater, BrowserWindow } from "electron";
import { GITHUB_REPO } from "./main/appIdentity";
import { buildUpdateFeedUrl } from "./main/updateFeed";
import { updateStatus, type UpdateStatus } from "./main/updateStatus";

declare const __CUE_DESK_TEST_BUILD__: boolean;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** What the specs can make the updater report (e2e/specs/support/target.ts reportUpdate). */
type TestUpdateEvent = { kind: "downloaded" } | { kind: "up-to-date" } | { kind: "error"; error: string };

/** Electron's updater events and what each records in `status`. */
function updateHandlers(status: UpdateStatus): Record<string, (...args: unknown[]) => void> {
  return {
    error: (error) => {
      console.error("Automatic update check failed:", error);
      status.failed(error);
    },
    "checking-for-update": () => status.checking(),
    "update-available": () => status.downloading(),
    "update-not-available": () => status.upToDate(),
    "update-downloaded": () => status.downloaded(),
  };
}

/**
 * Test builds only: `__lyreUpdatesTest.report(event)` feeds an event to the same handlers as Electron's updater, so the
 * specs can check Lyre's update news on a machine with no updates (Linux, an unsigned build).
 */
function installTestHook(handlers: Record<string, (...args: unknown[]) => void>): void {
  if (typeof __CUE_DESK_TEST_BUILD__ === "undefined" || !__CUE_DESK_TEST_BUILD__) return;
  (globalThis as unknown as { __lyreUpdatesTest: { report(event: TestUpdateEvent): void } }).__lyreUpdatesTest = {
    report(event) {
      if (event.kind === "downloaded") handlers["update-downloaded"]();
      else if (event.kind === "up-to-date") handlers["update-not-available"]();
      else if (event.kind === "error") handlers.error(new Error(String(event.error)));
    },
  };
}

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
 * the installer (the zip build). Every step is recorded in `status`; the Lyre
 * page shows a ready update and the first failure of a run in plain words
 * (FND-16: until 0.5.1 the old main window did); errors are also logged.
 */
export function runAutoUpdate(
  window: BrowserWindow,
  isInstalled: () => boolean = () => isSquirrelInstall(),
  status: UpdateStatus = updateStatus,
) {
  const handlers = updateHandlers(status);
  installTestHook(handlers);
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

  for (const [event, handler] of Object.entries(handlers)) {
    autoUpdater.on(event as "error", handler);
  }

  const interval = setInterval(() => {
    checkForAppUpdates();
  }, CHECK_INTERVAL_MS);

  window.on("close", () => {
    for (const [event, handler] of Object.entries(handlers)) {
      autoUpdater.off(event as "error", handler);
    }
    clearInterval(interval);
  });
}
