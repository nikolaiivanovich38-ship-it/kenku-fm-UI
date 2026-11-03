/**
 * FND-1: the fork's data folder and the one-time carry-over from Kenku FM.
 *
 * Importing this module moves the app's data folder to
 * `<appData>/cue-desk` (see appIdentity.json). That has to happen before any
 * other module asks Electron for the data folder (electron-store in bounds.ts
 * does so as soon as it is imported), so `src/index.ts` imports this module
 * first. Keeping the folder name apart from the display name means a later
 * rename does not move anyone's library.
 */
import path from "path";
import { app } from "electron";
import packageJson from "../../../package.json";
import { DATA_FOLDER_NAME, LEGACY_DATA_FOLDER_NAME } from "../appIdentity";
import { carryOverLegacyData, CarryOverResult, describeCarryOver } from "./carryOver";

/**
 * Data folders by platform: Electron's `appData` is %APPDATA% on Windows,
 * ~/Library/Application Support on macOS and $XDG_CONFIG_HOME (or ~/.config)
 * on Linux. Electron names the default data folder after `productName`, so
 * upstream Kenku FM's folder is `<appData>/Kenku FM` on all three.
 */
export function dataFolders(appDataDir: string): { userData: string; legacyUserData: string } {
  return {
    userData: path.join(appDataDir, DATA_FOLDER_NAME),
    legacyUserData: path.join(appDataDir, LEGACY_DATA_FOLDER_NAME),
  };
}

/**
 * Windows AppUserModelId, as the Squirrel installer writes it into shortcuts:
 * `com.squirrel.<package name with underscores>.<executable name>`.
 */
export function windowsAppUserModelId(packageName: string): string {
  return `com.squirrel.${packageName.replace(/-/g, "_")}.${packageName}`;
}

const folders = dataFolders(app.getPath("appData"));
app.setPath("userData", folders.userData);
// Browser storage (Local Storage, Session Storage) lives in sessionData, which
// defaults to userData; pin it so the library always sits beside config.json.
app.setPath("sessionData", folders.userData);

// Windows groups taskbar icons and notifications by this ID. It matches the ID
// the Squirrel installer gives the shortcuts (com.squirrel.<package>.<exe>),
// so the fork never shares an identity with an installed Kenku FM.
if (process.platform === "win32") {
  app.setAppUserModelId(windowsAppUserModelId(packageJson.name));
}

let lastResult: CarryOverResult | null = null;

/**
 * Copy the Kenku FM library into this app's data folder the first time the app
 * starts. Must run before any window or session is created. Logs and returns
 * the result so the main window can tell the user later.
 */
export function runDataCarryOver(): CarryOverResult {
  lastResult = carryOverLegacyData(folders.legacyUserData, folders.userData);
  const message = `[data carry-over] ${describeCarryOver(lastResult)}`;
  if (lastResult.status === "failed") {
    console.error(message, lastResult.errors);
  } else {
    console.info(message);
  }
  return lastResult;
}

/** The result of this start's carry-over, or null if it has not run. For a future notice in the UI. */
export function getDataCarryOverResult(): CarryOverResult | null {
  return lastResult;
}
