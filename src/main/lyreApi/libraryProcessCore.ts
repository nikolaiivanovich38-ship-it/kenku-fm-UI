/**
 * The library's own process (DB review 1, WP5): the Store, every database call and the backups run here, in an
 * Electron utility process, so nothing the library does can hold up the main process beside the Discord bots.
 * libraryProcess.ts is the thin entry Electron starts; this is the part tests run with a MessageChannel.
 *
 * Control messages from the main process (LyreApi calls use the rpc.ts protocol on the same port):
 *   { t: "init", folder, seed, ffmpegPath }
 *                                 open the library (and, in test builds, seed an empty one with the prototype's data);
 *                                 ffmpegPath is the bundled ffmpeg for loudness peaks (null: none are worked out)
 *   { t: "start-backups" }        the window is showing: start the daily backups
 *   { t: "legacy", raw }          bring in the old player's library (once; the database remembers it did)
 *   { t: "media-folders" }        the folders the player may read library files from (MediaAccess, MEDIA_PREPARE)
 *   { t: "restore", id }          put the latest good backup in place of a damaged library (one this process found
 *                                 itself in the library's backups folder), then open it again
 *   { t: "close" }                stop backups, close the library cleanly
 * Answers: { t: "ready" }, { t: "open-failed", message, canRestore }, { t: "damaged", message, canRestore } (the
 * background check found the open library damaged; it is closed and no longer used), { t: "restored", id, ok,
 * message? }, { t: "legacy-report", id, report },
 * { t: "media-folders", id, folders }, { t: "closed", id }. A request carries an `id` and its answer the same `id`, so
 * overlapping requests each get their own answer (security review 1).
 */
import path from "path";

import { serveLyreApi, type PortLike } from "../../common/lyre/rpc";
import { prototypeSeed } from "../../common/lyre/seed";
import {
  LibraryDatabaseError,
  findLatestGoodBackup,
  importLegacyLibrary,
  openLibrary,
  restoreBackup,
  startDailyBackups,
  type Library,
  type PeakReader,
  type TagReader,
} from "../data";
import { BACKUP_FOLDER_NAME } from "../data/library";
import { musicMetadataTagReader } from "../data/import/musicMetadata";
import { FfmpegPeakReader } from "../media/ffmpegPeaks";
import { createLibraryApi, type LibraryApi, type LibraryHost } from "./libraryApi";
import { seedLibrary } from "./seedLibrary";

export interface LibraryProcessOptions {
  /** Opens the library; tests pass openLibrary with a temporary folder. */
  open?: (folder: string) => Library;
  log?: (message: string, error?: unknown) => void;
  /** Reads new files' tags (DAT-5); music-metadata unless a test passes another. */
  tagReader?: TagReader;
  /** Works out loudness peaks; ffmpeg at the init message's path unless a test passes another. */
  peakReader?: (ffmpegPath: string | null) => PeakReader | null;
}

/**
 * Where library files are: the library folders, then the folder of each file outside them (a file chosen from
 * anywhere is the game master's choice). The main process lets the player read files under these only.
 */
export function mediaFolders(library: Library): string[] {
  const roots = library.store.all<{ path: string }>("SELECT path FROM library_roots ORDER BY created_at, rowid").map((r) => r.path);
  const outside = library.store
    .all<{ path: string }>("SELECT path FROM tracks WHERE root_id IS NULL AND path IS NOT NULL")
    // Security review 11: each path's own style, so E:\x.mp3 gives E:\ (the drive's root), never the
    // drive-relative "E:", which would mean the current folder on drive E.
    .map((r) => (/^[a-zA-Z]:[\\/]|^[\\/]{2}/.test(r.path) ? path.win32 : path.posix).dirname(r.path))
    .filter((folder) => folder !== "." && folder !== "");
  return [...new Set([...roots, ...outside])];
}

/** Plain words for a damaged library, with or without a backup to put back (security review 8). */
export function damagedWords(message: string, canRestore: boolean): string {
  const first = message.replace(/ Lyre can put back.*$| No backup was found.*$/, "");
  return canRestore
    ? `${first} Lyre can put back your latest backup; changes made since that backup are lost, and the damaged file is kept beside it.`
    : `${first} No backup was found to put back. The damaged file is left as it is; ask for help on Lyre's project page.`;
}

export type InitMessage = { t: "init"; folder: string; seed: boolean; ffmpegPath: string | null };

export function runLibraryProcess(port: PortLike, options: LibraryProcessOptions = {}): { done: Promise<void> } {
  const open = options.open ?? ((folder: string) => openLibrary({ folder }));
  const log = options.log ?? ((message, error) => console.error(message, error ?? ""));
  const tagReader = options.tagReader ?? musicMetadataTagReader;
  const peakReaderFor = options.peakReader ?? ((ffmpegPath) => (ffmpegPath ? new FfmpegPeakReader({ ffmpegPath }) : null));
  let library: Library | null = null;
  let server: ReturnType<typeof serveLyreApi> | null = null;
  let api: LibraryApi | null = null;
  let stopBackups: (() => void) | null = null;
  let backupsWanted = false;
  let folder: string | null = null;
  let seed = false;
  let ffmpegPath: string | null = null;
  /** The backup offered for a damaged library (found here, in the library's own backups folder). */
  let restorable: string | null = null;
  let finish: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));

  // The library's host work (choosers, File Explorer) is done by the main process, asked over the same port.
  const host: LibraryHost = {
    chooseFiles: () => server.askHost("chooseFiles", []) as Promise<string[] | null>,
    chooseFolder: () => server.askHost("chooseFolder", []) as Promise<string | null>,
    showItemInFolder: (path) => void server.askHost("showItemInFolder", [path]).catch((error) => log("Could not show the file in its folder", error)),
  };

  /** Says the library is damaged, offering the latest good backup when there is one. */
  const reportDamage = async (kind: "open-failed" | "damaged", error: LibraryDatabaseError) => {
    restorable = error.code === "corrupt" ? (error.latestBackup ?? (await findLatestGoodBackup(path.join(folder as string, BACKUP_FOLDER_NAME)))) : null;
    const canRestore = restorable !== null;
    port.postMessage({ t: kind, message: error.code === "corrupt" ? damagedWords(error.message, canRestore) : error.message, canRestore });
  };

  /** Stops using the open library (it was found damaged after opening). */
  const closeLibrary = () => {
    stopBackups?.();
    stopBackups = null;
    api?.stopBackgroundWork();
    server?.close();
    server = null;
    api = null;
    library?.close();
    library = null;
  };

  const openAndServe = async () => {
    let opened: Library;
    try {
      opened = open(folder as string);
    } catch (error) {
      log("Could not open the library", error);
      if (error instanceof LibraryDatabaseError) await reportDamage("open-failed", error);
      else port.postMessage({ t: "open-failed", message: "Lyre could not open your library.", canRestore: false });
      return;
    }
    library = opened;
    if (seed && !opened.store.get("SELECT 1 AS found FROM tracks LIMIT 1")) await seedLibrary(opened, prototypeSeed());
    const peakReader = peakReaderFor(ffmpegPath);
    api = createLibraryApi(opened, host, { tagReader, peakReader: peakReader ?? undefined, log });
    server = serveLyreApi(api, port);
    if (backupsWanted && !stopBackups) stopBackups = startDailyBackups(opened, { onError: (error) => log("The daily backup failed", error) });
    port.postMessage({ t: "ready" });
    // Security review 8: the background check's result is acted on: a damaged library is no longer used.
    void opened
      .checkIntegrity()
      .then(async (report) => {
        if (report.status !== "corrupt" || library !== opened) return;
        log("The library check found damage", report.error);
        closeLibrary();
        await reportDamage("damaged", report.error);
      })
      .catch((error) => log("Could not act on the library check", error));
  };

  const stop = port.onMessage(async (data) => {
    const message = data as { t?: string; id?: number; folder?: string; seed?: boolean; raw?: unknown; ffmpegPath?: unknown };
    try {
      if (message?.t === "init" && !library) {
        folder = message.folder as string;
        seed = message.seed === true;
        ffmpegPath = typeof message.ffmpegPath === "string" ? message.ffmpegPath : null;
        await openAndServe();
      } else if (message?.t === "restore" && !library && folder) {
        // Only a backup this process found itself is put back; the main process only says yes.
        const backup = restorable;
        if (!backup) {
          port.postMessage({ t: "restored", id: message.id, ok: false, message: "There is no backup to put back." });
          return;
        }
        try {
          restoreBackup({ folder, backupPath: backup });
        } catch (error) {
          log("Could not put the backup back", error);
          port.postMessage({ t: "restored", id: message.id, ok: false, message: error instanceof Error ? error.message : "Lyre could not put the backup back." });
          return;
        }
        restorable = null;
        port.postMessage({ t: "restored", id: message.id, ok: true });
        await openAndServe();
      } else if (message?.t === "start-backups") {
        backupsWanted = true;
        if (library && !stopBackups) stopBackups = startDailyBackups(library, { onError: (error) => log("The daily backup failed", error) });
      } else if (message?.t === "legacy" && library) {
        const report = await importLegacyLibrary(library, message.raw, { tagReader });
        port.postMessage({ t: "legacy-report", id: message.id, report });
      } else if (message?.t === "media-folders" && library) {
        port.postMessage({ t: "media-folders", id: message.id, folders: mediaFolders(library) });
      } else if (message?.t === "close") {
        closeLibrary();
        stop();
        port.postMessage({ t: "closed", id: message.id });
        finish();
      }
    } catch (error) {
      log(`The library could not do "${message?.t}"`, error);
    }
  });
  return { done };
}
