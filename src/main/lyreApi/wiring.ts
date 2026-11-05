/**
 * The main process's wiring of the library (WP5, wave 3 step 2), kept free of Electron so it is tested with
 * fakes (startLibrary.ts passes the real pieces):
 *
 * - LYRE_API_CALL from the Lyre page goes to the library service (its own process); its events go to the page.
 * - MEDIA_PREPARE (the player page and the Lyre page) may read files from the library's folders only: the library
 *   folders, and the folders of files added from elsewhere. The list is asked of the library at start, again when
 *   tracks or folders change and when the library is back after a restart; a request waits for the newest list.
 * - The old player's library (`persist:player`) is brought in on the new interface's first call, once (the database
 *   remembers it did, and keeps the report for the Library screen). The call itself is not held up.
 */
import type { LyreEvent } from "../../common/lyre/api";
import type { LyreInvoke } from "../../common/lyre/rpc";
import type { LegacyImportReport } from "../data";
import type { GuardedIpc, IpcSenderEvent } from "../security/ipcGuard";
import { registerMediaIpc, type MediaPreparer } from "../media/mediaIpc";
import { registerLyreApiIpc } from "./lyreIpc";

/** The parts of LyreLibraryService used here. */
export interface WiredService {
  call: LyreInvoke;
  mediaFolders(): Promise<string[]>;
  bringInOldLibrary(raw: unknown): Promise<LegacyImportReport | null>;
}

export type CallingPage = IpcSenderEvent["sender"];

export interface WiringOptions {
  service: WiredService;
  ipc: GuardedIpc;
  /** Sends a LyreApi event to the Lyre page. */
  send(event: LyreEvent): void;
  /** Makes the preparer MEDIA_PREPARE answers with, reading only under `libraryFolders()`. */
  media(libraryFolders: () => readonly string[]): MediaPreparer;
  /** False when the library was seeded for the tests (there is no old library to bring in). */
  bringInOldLibrary: boolean;
  /** The stored value of the old player's "persist:player", read through the page that called. */
  readOldLibrary(page: CallingPage): Promise<unknown>;
  log?: (message: string, error?: unknown) => void;
}

export interface WiredLibrary {
  /** Give every event of the library service here (it refreshes the folders, then the page gets the event). */
  onEvent(event: LyreEvent): void;
  /** Resolves when the newest folder list is in. */
  ready(): Promise<void>;
  /** The old library's move report (null when not brought in, or not yet asked for). */
  oldLibraryReport(): Promise<LegacyImportReport | null>;
  dispose(): void;
}

/** Test builds only: CUE_DESK_LYRE_SEED=prototype fills a new, empty library with the prototype's sample data. */
export function wantsSeededLibrary(env: NodeJS.ProcessEnv, testBuild: boolean): boolean {
  return testBuild && env.CUE_DESK_LYRE_SEED === "prototype";
}

const FOLDER_AREAS = new Set(["tracks", "folders"]);

export function wireLyreLibrary(options: WiringOptions): WiredLibrary {
  const log = options.log ?? ((message, error) => console.error(message, error ?? ""));
  let folders: readonly string[] = [];
  let latest: Promise<void> = Promise.resolve();

  const refresh = () => {
    latest = options.service
      .mediaFolders()
      .then((list) => {
        folders = list;
      })
      .catch((error) => log("Could not read the library's folders", error));
  };

  let oldLibrary: Promise<LegacyImportReport | null> | null = null;
  const bringInOld = (page: CallingPage) => {
    if (oldLibrary || !options.bringInOldLibrary) return;
    oldLibrary = options
      .readOldLibrary(page)
      .then((raw) => options.service.bringInOldLibrary(raw))
      .catch((error): null => {
        log("Could not bring the old player's library in", error);
        return null;
      });
  };

  const preparer = options.media(() => folders);
  const stopMedia = registerMediaIpc(options.ipc, {
    prepare: async (address, prepareOptions) => {
      await latest;
      return preparer.prepare(address, prepareOptions);
    },
  });
  const stopCalls = registerLyreApiIpc(options.ipc, options.service.call, bringInOld);
  refresh();

  return {
    onEvent(event) {
      if ((event.type === "changed" && event.areas.some((area) => FOLDER_AREAS.has(area))) || (event.type === "library-status" && event.ok)) {
        refresh();
      }
      options.send(event);
    },
    ready: () => latest,
    oldLibraryReport: () => oldLibrary ?? Promise.resolve(null),
    dispose() {
      stopMedia();
      stopCalls();
    },
  };
}
