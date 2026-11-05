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
 *   { t: "close" }                stop backups, close the library cleanly
 * Answers: { t: "ready" }, { t: "open-failed", message }, { t: "legacy-report", report }, { t: "media-folders", folders },
 * { t: "closed" }.
 */
import { serveLyreApi, type PortLike } from "../../common/lyre/rpc";
import { prototypeSeed } from "../../common/lyre/seed";
import { LibraryDatabaseError, importLegacyLibrary, openLibrary, startDailyBackups, type Library, type PeakReader, type TagReader } from "../data";
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
    .map((r) => r.path.slice(0, Math.max(r.path.lastIndexOf("\\"), r.path.lastIndexOf("/"))))
    .filter(Boolean);
  return [...new Set([...roots, ...outside])];
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
  let finish: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));

  // The library's host work (choosers, File Explorer) is done by the main process, asked over the same port.
  const host: LibraryHost = {
    chooseFiles: () => server.askHost("chooseFiles", []) as Promise<string[] | null>,
    chooseFolder: () => server.askHost("chooseFolder", []) as Promise<string | null>,
    showItemInFolder: (path) => void server.askHost("showItemInFolder", [path]).catch((error) => log("Could not show the file in its folder", error)),
  };

  const stop = port.onMessage(async (data) => {
    const message = data as { t?: string; folder?: string; seed?: boolean; raw?: unknown; ffmpegPath?: unknown };
    try {
      if (message?.t === "init" && !library) {
        try {
          library = open(message.folder as string);
        } catch (error) {
          const words = error instanceof LibraryDatabaseError ? error.message : "Lyre could not open your library.";
          log("Could not open the library", error);
          port.postMessage({ t: "open-failed", message: words });
          return;
        }
        if (message.seed && !library.store.get("SELECT 1 AS found FROM tracks LIMIT 1")) await seedLibrary(library, prototypeSeed());
        const peakReader = peakReaderFor(typeof message.ffmpegPath === "string" ? message.ffmpegPath : null);
        api = createLibraryApi(library, host, { tagReader, peakReader: peakReader ?? undefined, log });
        server = serveLyreApi(api, port);
        port.postMessage({ t: "ready" });
      } else if (message?.t === "start-backups" && library && !stopBackups) {
        stopBackups = startDailyBackups(library, { onError: (error) => log("The daily backup failed", error) });
      } else if (message?.t === "legacy" && library) {
        const report = await importLegacyLibrary(library, message.raw, { tagReader });
        port.postMessage({ t: "legacy-report", report });
      } else if (message?.t === "media-folders" && library) {
        port.postMessage({ t: "media-folders", folders: mediaFolders(library) });
      } else if (message?.t === "close") {
        stopBackups?.();
        api?.stopBackgroundWork();
        server?.close();
        library?.close();
        library = null;
        stop();
        port.postMessage({ t: "closed" });
        finish();
      }
    } catch (error) {
      log(`The library could not do "${message?.t}"`, error);
    }
  });
  return { done };
}
