/**
 * The main process's side of the library (WP5, DB review 1): it starts the library's utility process, relays the
 * Lyre page's LyreApi calls to it and its change events back, does the host work it asks for (choosers, File
 * Explorer), and starts it again when it stops unexpectedly. The main process itself never touches the database.
 *
 * While the library process is starting, calls wait for it; while it is down after a crash, calls fail with plain
 * words and the page is told ("library-status"), and again when it is back.
 * Electron is kept out (the caller passes `fork`), so the restart rules are tested with a fake process.
 */
import type { LyreEvent } from "../../common/lyre/api";
import { LYRE_AREAS } from "../../common/lyre/api";
import { lyreApiOverPort, type LyreInvoke, type PortClient } from "../../common/lyre/rpc";
import type { LegacyImportReport } from "../data";

/** The parts of Electron's UtilityProcess used here. */
export interface LibraryChild {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  kill(): boolean;
}

export interface LibraryServiceOptions {
  /** Starts the library's utility process (utilityProcess.fork of the "lyreLibrary" bundle). */
  fork(): LibraryChild;
  /** The library folder (libraryFolder(app.getPath("userData"))). */
  folder: string;
  /** Test builds only: fill a new, empty library with the prototype's sample data. */
  seed?: boolean;
  /** The bundled ffmpeg (media/bundledFfmpeg.ts), for loudness peaks; null when it is missing. */
  ffmpegPath?: string | null;
  /** Work the library asks for: chooseFiles, chooseFolder, showItemInFolder. */
  host: Record<string, (...args: unknown[]) => unknown>;
  /** Every LyreApi event, and the library's status, for the Lyre page. */
  onEvent(event: LyreEvent): void;
  /** Wait before starting again after a crash (default 1 s). */
  restartDelayMs?: number;
  /** Crashes within `crashWindowMs` (default 60 s) after which it stops trying (default 3). */
  maxCrashes?: number;
  crashWindowMs?: number;
  log?: (message: string, error?: unknown) => void;
}

export const STARTING_AGAIN = "Lyre's library stopped unexpectedly and is starting again. Your last change may not have been saved; check it in a moment.";
export const BACK_AGAIN = "Lyre's library is working again.";
export const GAVE_UP = "Lyre's library keeps stopping. Close Lyre and start it again; your library and its backups are safe on disk.";
const CLOSED = "Lyre's library is closed.";

export class LyreLibraryService {
  private readonly options: LibraryServiceOptions;
  private child: LibraryChild | null = null;
  private client: PortClient | null = null;
  /** Resolves when the current library process is ready; rejects when it could not open the library. */
  private ready: Promise<void> = Promise.reject(new Error(CLOSED));
  private markReady: (() => void) | null = null;
  private markFailed: ((error: Error) => void) | null = null;
  private down: string | null = null;
  private stopping = false;
  private crashes: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private backupsWanted = false;
  private waiting = new Map<string, (message: unknown) => void>();

  constructor(options: LibraryServiceOptions) {
    this.options = options;
    this.ready.catch((): void => undefined);
  }

  /** Starts the library process. Calls made before it is ready wait for it. */
  start(): void {
    this.stopping = false;
    this.spawn(false);
  }

  /** A LyreApi call from the page: resolves to what the API answered (refusals too); rejects when the library is down. */
  readonly call: LyreInvoke = async (area, method, args) => {
    if (this.down) throw new Error(this.down);
    await this.ready;
    if (!this.client) throw new Error(this.down ?? CLOSED);
    return this.invoke(area, method, args);
  };

  /** The main window is showing: the daily backups may start (and start again after a restart). */
  startBackups(): void {
    this.backupsWanted = true;
    this.ready.then(() => this.child?.postMessage({ t: "start-backups" })).catch((): void => undefined);
  }

  /** Brings the old player's library in (once ever: the database remembers). Null when the library is not there. */
  async bringInOldLibrary(raw: unknown): Promise<LegacyImportReport | null> {
    await this.ready;
    const child = this.child;
    if (!child) return null;
    const answer = this.next("legacy-report");
    child.postMessage({ t: "legacy", raw });
    const report = ((await answer) as { report: LegacyImportReport }).report;
    if (report.status === "moved") this.options.onEvent({ type: "changed", areas: [...LYRE_AREAS] });
    return report;
  }

  /** The folders the player may read library files from (MediaAccess); empty while the library is not there. */
  async mediaFolders(): Promise<string[]> {
    try {
      await this.ready;
    } catch {
      return [];
    }
    const child = this.child;
    if (!child) return [];
    const answer = this.next("media-folders");
    child.postMessage({ t: "media-folders" });
    return ((await answer) as { folders: string[] }).folders;
  }

  /** Closes the library cleanly (backups stop, the database is closed), then the process ends. */
  async stop(timeoutMs = 3000): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) return;
    const closed = this.next("closed");
    child.postMessage({ t: "close" });
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    this.client?.close();
    this.client = null;
    this.child = null;
    child.kill();
  }

  private invoke(area: string, method: string, args: unknown[]): Promise<unknown> {
    const target = (this.client.api as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[area];
    return target[method](...args);
  }

  /** The next control message of this kind from the library process. */
  private next(kind: string): Promise<unknown> {
    return new Promise((resolve) => this.waiting.set(kind, resolve));
  }

  private spawn(afterCrash: boolean): void {
    const child = this.options.fork();
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      this.markReady = resolve;
      this.markFailed = reject;
    });
    this.ready.catch((): void => undefined);
    const listeners = new Set<(data: unknown) => void>();
    const onMessage = (message: unknown) => {
      const kind = (message as { t?: string })?.t;
      if (kind === "ready") {
        this.down = null;
        this.markReady?.();
        if (this.backupsWanted) child.postMessage({ t: "start-backups" });
        if (afterCrash) {
          this.options.onEvent({ type: "library-status", ok: true, message: BACK_AGAIN });
          this.options.onEvent({ type: "changed", areas: [...LYRE_AREAS] });
        }
      } else if (kind === "open-failed") {
        const words = (message as { message: string }).message;
        this.down = words;
        this.markFailed?.(new Error(words));
        this.options.onEvent({ type: "library-status", ok: false, message: words });
      } else if (kind && this.waiting.has(kind)) {
        const resolve = this.waiting.get(kind);
        this.waiting.delete(kind);
        resolve(message);
      }
      for (const listener of [...listeners]) listener(message);
    };
    child.on("message", onMessage);
    this.client = lyreApiOverPort(
      {
        postMessage: (message) => child.postMessage(message),
        onMessage: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      this.options.host,
    );
    this.client.api.subscribe((event) => this.options.onEvent(event));
    child.on("exit", (code) => this.exited(child, code));
    child.postMessage({ t: "init", folder: this.options.folder, seed: this.options.seed === true, ffmpegPath: this.options.ffmpegPath ?? null });
  }

  private exited(child: LibraryChild, code: number): void {
    if (child !== this.child) return;
    const client = this.client;
    this.child = null;
    this.client = null;
    if (this.stopping) {
      client?.close();
      return;
    }
    this.options.log?.(`Lyre's library process stopped (code ${code})`);
    const now = Date.now();
    this.crashes = [...this.crashes.filter((at) => now - at < (this.options.crashWindowMs ?? 60_000)), now];
    const giveUp = this.crashes.length >= (this.options.maxCrashes ?? 3);
    this.down = giveUp ? GAVE_UP : STARTING_AGAIN;
    client?.failPending(this.down);
    this.markFailed?.(new Error(this.down));
    this.options.onEvent({ type: "library-status", ok: false, message: this.down });
    if (giveUp) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.spawn(true);
    }, this.options.restartDelayMs ?? 1000);
  }
}
