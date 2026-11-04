/**
 * Kenku FM backgrounds, wired into the app.
 *
 * `startKenkuBackgroundImport` (called by src/index.ts once the app is ready,
 * after the data carry-over) copies the background pictures from the user's
 * installed Kenku FM into `<userData>/backgrounds` in the background, so the
 * main window opens without waiting. `registerBackgroundsIpc` answers the
 * player's PLAYER_GET_BACKGROUNDS question (sent with `sendSync` while the
 * player loads) with the pictures in that folder, after the copy has finished
 * or a few seconds have passed.
 */
import path from "path";
import { app, ipcMain } from "electron";
import { userDataOverride } from "../migration/userDataOverride";
import { guardIpc } from "../security/ipcGuard";
import { backgroundUrls, describeBackgroundImport, importKenkuBackgrounds, waitAtMost } from "./backgroundFiles";
import { localAppDataFolder } from "./kenkuInstall";

/** True only in packages built with CUE_DESK_E2E_BUILD=1 (webpack.main.config.js). */
declare const __CUE_DESK_TEST_BUILD__: boolean;

/** The player waits at most this long for the copy before showing what is there. */
const PLAYER_WAIT_MS = 5000;

const LOG_PREFIX = "[Kenku FM backgrounds]";

let importing: Promise<void> = Promise.resolve();

/** Cue Desk's own folder of background pictures. */
export function backgroundsFolder(): string {
  return path.join(app.getPath("userData"), "backgrounds");
}

/** Start copying Kenku FM's background pictures; logs one line when done. Never rejects. */
export function startKenkuBackgroundImport(): Promise<void> {
  const isTestBuild = typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__;
  const localAppData = localAppDataFolder(process.env, process.platform, {
    isTestBuild,
    testUserData: userDataOverride(process.env, isTestBuild) !== null,
  });
  importing = importKenkuBackgrounds(localAppData, backgroundsFolder()).then((result) => {
    const line = `${LOG_PREFIX} ${describeBackgroundImport(result)}`;
    if (result.status === "failed") {
      console.warn(line);
    } else {
      console.info(line);
    }
  });
  return importing;
}

/** Register PLAYER_GET_BACKGROUNDS (player view only, no arguments). Returns a function that removes it. */
export function registerBackgroundsIpc(): () => void {
  const ipc = guardIpc(ipcMain);
  ipc.on("PLAYER_GET_BACKGROUNDS", (event) => {
    // A sync message's answer may be given later; the player waits for it.
    waitAtMost(importing, PLAYER_WAIT_MS)
      .then(() => backgroundUrls(backgroundsFolder()))
      .then(
        (urls) => {
          event.returnValue = urls;
        },
        (error: unknown) => {
          console.warn(`${LOG_PREFIX} Could not list the background pictures: ${String(error)}`);
          event.returnValue = {};
        },
      );
  });
  return () => ipc.dispose();
}
