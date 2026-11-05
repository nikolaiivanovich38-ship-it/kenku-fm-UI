/**
 * Starts Lyre's library for the app (WP5, wave 3 step 2): the library's own utility process, the LYRE_API_CALL and
 * MEDIA_PREPARE handlers, events to the Lyre page, and the old player's library brought in on the new interface's
 * first start. index.ts calls startLyreLibrary() when the app is ready, startBackups() once the window shows and
 * stop() before quitting. Everything that can be tested without Electron is in libraryService.ts and wiring.ts.
 */
import path from "path";
import { app, dialog, ipcMain, shell, utilityProcess, webContents, BrowserWindow } from "electron";

import { libraryFolder } from "../data";
import { MEDIA_CACHE_FOLDER, MediaCache } from "../media/mediaCache";
import { MediaAccess } from "../media/mediaAccess";
import { guardIpc } from "../security/ipcGuard";
import { trustedContents } from "../security/trustedContents";
import { LyreLibraryService, type LibraryChild } from "./libraryService";
import { LYRE_API_EVENT } from "./lyreIpc";
import { noConverter } from "./noConverter";
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
  startBackups(): void;
  stop(): Promise<void>;
}

export function startLyreLibrary(): StartedLibrary {
  const testBuild = typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__;
  const seed = wantsSeededLibrary(process.env, testBuild);
  const log = (message: string, error?: unknown) => console.error(message, error ?? "");
  const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  let wired: WiredLibrary | null = null;
  let current: Electron.UtilityProcess | null = null;
  if (testBuild) {
    // Test builds only: the end-to-end tests stop the library's process to check it starts again.
    (globalThis as unknown as { lyreLibraryPid: () => number | undefined }).lyreLibraryPid = () => current?.pid;
  }

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
    },
    onEvent: (event) => wired?.onEvent(event),
    log,
  });

  wired = wireLyreLibrary({
    service,
    ipc: guardIpc(ipcMain),
    send: (event) => {
      for (const page of lyrePages()) page.send(LYRE_API_EVENT, event);
    },
    media: (libraryFolders) =>
      new MediaCache({
        folder: path.join(app.getPath("userData"), MEDIA_CACHE_FOLDER),
        access: new MediaAccess({ libraryFolders }),
        converter: noConverter,
        log,
      }),
    bringInOldLibrary: !seed,
    readOldLibrary,
    log,
  });

  service.start();
  return {
    service,
    wired,
    startBackups: () => service.startBackups(),
    async stop() {
      wired.dispose();
      await service.stop();
    },
  };
}
