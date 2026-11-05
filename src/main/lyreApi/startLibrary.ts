/**
 * Starts Lyre's library for the app (WP5, wave 3 step 2): the library's own utility process, the LYRE_API_CALL and
 * MEDIA_PREPARE handlers, events to the Lyre page, and the old player's library brought in on the new interface's
 * first start. index.ts calls startLyreLibrary() when the app is ready, windowShown() once the window shows and
 * stop() before quitting. Everything that can be tested without Electron is in libraryService.ts and wiring.ts.
 */
import fs from "fs";
import path from "path";
import { app, dialog, ipcMain, shell, utilityProcess, webContents, BrowserWindow } from "electron";

import { libraryFolder } from "../data";
import { findBundledFfmpeg } from "../media/bundledFfmpeg";
import { FfmpegConverter } from "../media/ffmpegConverter";
import { MEDIA_CACHE_FOLDER, MediaCache } from "../media/mediaCache";
import { MediaAccess } from "../media/mediaAccess";
import { MediaUpkeep } from "../media/mediaUpkeep";
import { sharedMediaGrants } from "../media/mediaProtocol";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";
import { LyreLibraryService, type LibraryChild } from "./libraryService";
import { LYRE_API_EVENT } from "./lyreIpc";
import { noConverter } from "./noConverter";
import { SAMPLE_SHARED_FILE } from "./sampleComputer";
import { standInForMissingFiles, writeStandInTone } from "./seedAudio";
import { wantsSeededLibrary, wireLyreLibrary, type CallingPage, type WiredLibrary } from "./wiring";

declare const __CUE_DESK_TEST_BUILD__: boolean;

/** Reads the old player's library from the page's own storage (the old player and Lyre share it), out of reach of page scripts. */
async function readOldLibrary(page: CallingPage): Promise<unknown> {
  const contents = webContents.fromId(page.id);
  if (!contents || contents.isDestroyed()) return null;
  // A world of its own: the page's scripts cannot change what localStorage.getItem does there.
  return contents.executeJavaScriptInIsolatedWorld(1999, [{ code: 'localStorage.getItem("persist:player")' }]);
}

function lyrePages(): Electron.WebContents[] {
  return webContents.getAllWebContents().filter((contents) => !contents.isDestroyed() && trustedContents.roleOf(contents) === "lyre-view");
}

export interface StartedLibrary {
  service: LyreLibraryService;
  wired: WiredLibrary;
  /** The main window is showing: the daily backups start, and the audio cache is tidied a while later. */
  windowShown(): void;
  /** Settings > Clear cache: empties Lyre's audio cache too (security review 3). */
  clearAudioCache(): Promise<void>;
  stop(): Promise<void>;
}

export function startLyreLibrary(): StartedLibrary {
  const testBuild = typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__;
  const seed = wantsSeededLibrary(process.env, testBuild);
  const log = (message: string, error?: unknown) => console.error(message, error ?? "");
  const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  let wired: WiredLibrary | null = null;
  let upkeep: MediaUpkeep | null = null;
  let current: Electron.UtilityProcess | null = null;
  // BUG-10: the ffmpeg shipped with Lyre converts WMA and AIFF for the player (here) and works out loudness peaks
  // (in the library's process). Missing means a damaged install: said plainly when a file needs it.
  const ffmpegPath = findBundledFfmpeg(app.getAppPath());
  if (!ffmpegPath) log("Lyre's bundled ffmpeg is missing", app.getAppPath());
  if (testBuild) {
    // Test builds only: the end-to-end tests check that the packaged app finds its ffmpeg.
    (globalThis as unknown as { lyreFfmpegPath: string | null }).lyreFfmpegPath = ffmpegPath;
  }
  if (testBuild) {
    // Test builds only: the end-to-end tests stop the library's process to check it starts again.
    (globalThis as unknown as { lyreLibraryPid: () => number | undefined }).lyreLibraryPid = () => current?.pid;
  }

  // DAT-7: .lyre files are saved to, and brought in from, Documents\Lyre. A test build of the sample library keeps
  // them in its own data folder and answers the two dialogs itself (Playwright cannot click native dialogs).
  const transferFolder = seed ? path.join(app.getPath("userData"), "Documents", "Lyre") : path.join(app.getPath("documents"), "Lyre");
  const lyreFilter: Electron.FileFilter[] = [{ name: "Lyre files", extensions: ["lyre"] }];

  const service = new LyreLibraryService({
    fork: () => {
      current = utilityProcess.fork(path.join(__dirname, "lyreLibrary.js"), [], {
        serviceName: "Lyre library",
        stdio: "inherit",
      });
      return current as unknown as LibraryChild;
    },
    folder: libraryFolder(app.getPath("userData")),
    seed,
    ffmpegPath,
    transferFolder,
    host: {
      chooseFiles: async () => {
        const window = parentWindow();
        const options: Electron.OpenDialogOptions = {
          title: "Add audio files",
          properties: ["openFile", "multiSelections"],
          filters: [
            { name: "Audio", extensions: ["mp3", "ogg", "oga", "opus", "wav", "flac", "m4a", "aac", "webm", "wma", "aif", "aiff"] },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const answer = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        return answer.canceled ? null : answer.filePaths;
      },
      chooseFolder: async () => {
        const window = parentWindow();
        const options: Electron.OpenDialogOptions = { title: "Choose a folder", properties: ["openDirectory"] };
        const answer = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        return answer.canceled ? null : answer.filePaths[0] ?? null;
      },
      showItemInFolder: (file: unknown) => {
        if (typeof file === "string" && path.isAbsolute(file)) shell.showItemInFolder(file);
      },
      chooseSaveFile: async (suggested: unknown) => {
        // Only a name is taken from the library, never a folder.
        const name = typeof suggested === "string" ? path.basename(suggested.replace(/\\/g, "/")) || "Lyre.lyre" : "Lyre.lyre";
        await fs.promises.mkdir(transferFolder, { recursive: true }).catch((): void => undefined);
        if (seed) return path.join(transferFolder, name);
        const window = parentWindow();
        const options: Electron.SaveDialogOptions = { title: "Save to a file", defaultPath: path.join(transferFolder, name), filters: lyreFilter };
        const answer = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
        return answer.canceled || !answer.filePath ? null : answer.filePath;
      },
      chooseLyreFile: async () => {
        if (seed) return path.join(transferFolder, SAMPLE_SHARED_FILE);
        const window = parentWindow();
        const options: Electron.OpenDialogOptions = { title: "Open a Lyre file", defaultPath: transferFolder, properties: ["openFile"], filters: [...lyreFilter, { name: "All files", extensions: ["*"] }] };
        const answer = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        return answer.canceled ? null : answer.filePaths[0] ?? null;
      },
    },
    onEvent: (event) => wired?.onEvent(event),
    // Security review 8: a damaged library offers its latest backup; the answer comes from the game master here,
    // never from a page. Cancel (and closing the box) leaves everything as it is.
    offerRestore: async (words) => {
      const window = parentWindow();
      const options: Electron.MessageBoxOptions = {
        type: "warning",
        title: "Lyre's library is damaged",
        message: "Lyre's library file is damaged.",
        detail: words,
        buttons: ["Restore the latest backup", "Not now"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const answer = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      return answer.response === 0;
    },
    log,
  });

  wired = wireLyreLibrary({
    service,
    ipc: guardIpc(ipcMain),
    send: (event) => {
      for (const page of lyrePages()) page.send(LYRE_API_EVENT, event);
    },
    media: (libraryFolders) => {
      const cache = new MediaCache({
        folder: path.join(app.getPath("userData"), MEDIA_CACHE_FOLDER),
        access: new MediaAccess({ libraryFolders }),
        converter: ffmpegPath ? new FfmpegConverter({ ffmpegPath }) : noConverter,
        log,
      });
      upkeep = new MediaUpkeep(cache, { log });
      // Test builds only: the seeded library's files are not on the test machine, so they play a stand-in tone.
      return seed ? standInForMissingFiles(cache, writeStandInTone(app.getPath("userData"))) : cache;
    },
    bringInOldLibrary: !seed,
    readOldLibrary,
    // Security review 6: the Lyre page gets lyre-media: addresses; the old player keeps file: until it retires.
    grants: sharedMediaGrants(),
    isLyrePage: (page) => trustedContents.roleOf(page) === "lyre-view",
    log,
  });

  service.start();
  return {
    service,
    wired,
    windowShown: () => {
      service.startBackups();
      upkeep?.windowShown();
    },
    clearAudioCache: async () => {
      await upkeep?.clear();
    },
    async stop() {
      wired.dispose();
      // A conversion under way stops and leaves no part file (security review 3).
      await Promise.all([upkeep?.close().catch((error) => log("Could not close the audio cache", error)), service.stop()]);
    },
  };
}
