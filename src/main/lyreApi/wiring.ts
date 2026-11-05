/**
 * The main process's wiring of the library (WP5, wave 3 step 2), kept free of Electron so it is tested with
 * fakes (startLibrary.ts passes the real pieces):
 *
 * - LYRE_API_CALL from the Lyre page goes to the library service (its own process); its events go to the page.
 * - MEDIA_PREPARE (the player page and the Lyre page) may read files from the library's folders only: the library
 *   folders, and the folders of files added from elsewhere. The list is asked of the library at start, again when
 *   tracks or folders change and when the library is back after a restart; a request waits for the newest list,
 *   at most `folderWaitMs`, then uses the last list the library gave (security review 1: it never waits for ever).
 * - The old player's library (`persist:player`) is brought in on the new interface's first call, once (the database
 *   remembers it did, and keeps the report for the Library screen). The call itself is not held up.
 */
import type { LyreEvent } from "../../common/lyre/api";
import type { LyreInvoke } from "../../common/lyre/rpc";
import type { LegacyImportReport } from "../data";
import type { GuardedIpc, IpcSenderEvent } from "../security/ipcGuard";
import { fileURLToPath } from "url";

import { registerMediaIpc, type MediaPreparer, type PreparingPage } from "../media/mediaIpc";
import type { MediaGrants } from "../media/mediaProtocol";
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
  /**
   * Security review 6: the Lyre page plays library files through lyre-media: addresses granted here (per page);
   * without `grants`, every page gets the prepared file's file: address (the old player always does).
   */
  grants?: MediaGrants;
  /** Whether the page that asked is the Lyre page (trustedContents role "lyre-view"). */
  isLyrePage?(page: PreparingPage): boolean;
  /** How long MEDIA_PREPARE waits for a folder list being refreshed before it uses the last one (default 5 s). */
  folderWaitMs?: number;
  log?: (message: string, error?: unknown) => void;
}

/** MEDIA_PREPARE's answer when the library has never given its folders in time (security review 1). */
export const LIBRARY_NOT_ANSWERING = "Lyre's library is not answering yet, so this file cannot be played. Try again in a moment.";

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
  // The last list the library gave (null: none yet). A failed refresh keeps it: a library that stopped must not
  // stop the player playing files it played a moment ago (security review 1).
  let folders: readonly string[] | null = null;
  let latest: Promise<void> = Promise.resolve();
  const waitMs = options.folderWaitMs ?? 5000;

  const refresh = () => {
    latest = options.service
      .mediaFolders()
      .then((list) => {
        folders = list;
      })
      .catch((error) => log("Could not read the library's folders", error));
  };
  /** Waits for the newest list, but never longer than `waitMs`; false when there is still no list at all. */
  const newestFolders = async (): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([latest, new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
    clearTimeout(timer);
    return folders !== null;
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

  const preparer = options.media(() => folders ?? []);
  const grantedPages = new Set<number>();
  /** The Lyre page's address for a prepared file: a lyre-media: grant for that page (security review 6). */
  const addressFor = (page: PreparingPage | undefined, fileAddress: string): string => {
    if (!options.grants || !page || !options.isLyrePage?.(page)) return fileAddress;
    const filePath = fileURLToPath(fileAddress);
    if (!grantedPages.has(page.id)) {
      grantedPages.add(page.id);
      // A page that goes (closed, or the app quitting) loses every address it was given.
      page.once?.("destroyed", () => {
        grantedPages.delete(page.id);
        options.grants?.revokePage(page.id);
      });
    }
    return options.grants.grant(page.id, filePath);
  };
  const stopMedia = registerMediaIpc(options.ipc, {
    prepare: async (address, prepareOptions, page) => {
      if (!(await newestFolders())) return { error: LIBRARY_NOT_ANSWERING };
      const answer = await preparer.prepare(address, prepareOptions);
      return "url" in answer ? { url: addressFor(page, answer.url) } : answer;
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
