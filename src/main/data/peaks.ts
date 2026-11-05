/**
 * Loudness peaks, worked out in the background (w3-media). PeakJobs keeps a queue of tracks and works out one at a
 * time with a PeakReader (the real one runs ffmpeg in its own process: media/ffmpegPeaks.ts), so the library's
 * process only waits: each step it takes itself (a queue change, one row saved) is well under a millisecond, and
 * nothing it does holds the process for more than 200 ms.
 *
 * - `inBackground(ids)`: after an import, at the back of the queue.
 * - `soon(id)`: a screen asked (LyreApi library.peaksOf); next in line, ahead of the background ones.
 * - Tracks whose levels are ready, or whose file was found unreadable, are skipped; a file that is not there now
 *   (an unplugged drive) is left for a later request, not marked unreadable.
 * - While the library saves bulk work (LibraryBusyError), the save waits and tries again.
 * - `onReady` hears which tracks have levels, gathered into one notice per `notifyEveryMs`.
 */
import fs from "fs";

import { LibraryBusyError } from "./errors";
import { savePeaks, trackPeaks, type PeakSource } from "./repo/peaks";
import type { Store } from "./store";

export interface PeakReader {
  /** The file's levels (one byte per point, repo/peaks.ts); rejects when it cannot be read or `signal` aborts. */
  read(file: string, signal: AbortSignal): Promise<Uint8Array>;
}

export interface PeakJobsOptions {
  /** Tracks whose levels are now ready. */
  onReady(trackIds: string[]): void;
  /** Gather ready tracks into one notice per this many ms (default 500; 0 sends each at once). */
  notifyEveryMs?: number;
  /** Wait between tries while the library is busy (default 250 ms). */
  busyRetryMs?: number;
  log?: (message: string, error?: unknown) => void;
}

const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PeakJobs {
  private readonly store: Store;
  private readonly reader: PeakReader;
  private readonly options: PeakJobsOptions;
  /** In order: on-demand tracks first, then background ones. A Set keeps each once. */
  private urgent = new Set<string>();
  private background = new Set<string>();
  private running: Promise<void> | null = null;
  private current: AbortController | null = null;
  private closed = false;
  private readyIds: string[] = [];
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: Store, reader: PeakReader, options: PeakJobsOptions) {
    this.store = store;
    this.reader = reader;
    this.options = options;
  }

  /** Work these out when nothing more urgent is waiting (new tracks after an import). */
  inBackground(trackIds: readonly string[]): void {
    for (const id of trackIds) if (!this.urgent.has(id)) this.background.add(id);
    this.start();
  }

  /** Work this out next (a screen is waiting for it). */
  soon(trackId: string): void {
    this.background.delete(trackId);
    this.urgent.add(trackId);
    this.start();
  }

  /** Resolves when the queue is empty (tests, and closing). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Stops the running read and forgets the queue; nothing more is saved. */
  close(): void {
    this.closed = true;
    this.urgent.clear();
    this.background.clear();
    this.current?.abort();
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
  }

  private start(): void {
    if (this.closed || this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
  }

  private next(): string | undefined {
    for (const queue of [this.urgent, this.background]) {
      const id = queue.values().next().value as string | undefined;
      if (id !== undefined) {
        queue.delete(id);
        return id;
      }
    }
    return undefined;
  }

  private async drain(): Promise<void> {
    for (let id = this.next(); id !== undefined && !this.closed; id = this.next()) {
      try {
        await this.workOut(id);
      } catch (error) {
        this.options.log?.("Could not work out a track's loudness peaks", error);
      }
    }
  }

  private async workOut(trackId: string): Promise<void> {
    const state = trackPeaks(this.store, trackId);
    if (state.state !== "needed") return;
    const { source } = state;
    if (!fs.existsSync(source.file)) return;
    const controller = new AbortController();
    this.current = controller;
    let levels: Uint8Array | null;
    try {
      levels = await this.reader.read(source.file, controller.signal);
    } catch (error) {
      if (this.closed) return;
      this.options.log?.(`Could not work out the loudness peaks of ${fileName(source.file)}`, error);
      levels = null;
    } finally {
      this.current = null;
    }
    if (this.closed) return;
    if ((await this.save(source, levels)) && levels) this.ready(trackId);
  }

  /** Saves, waiting while bulk work holds the library. */
  private async save(source: PeakSource, levels: Uint8Array | null): Promise<boolean> {
    for (;;) {
      if (this.closed) return false;
      try {
        return savePeaks(this.store, source, levels);
      } catch (error) {
        if (!(error instanceof LibraryBusyError)) throw error;
        await pause(this.options.busyRetryMs ?? 250);
      }
    }
  }

  private ready(trackId: string): void {
    this.readyIds.push(trackId);
    const every = this.options.notifyEveryMs ?? 500;
    if (every <= 0) return this.flush();
    this.notifyTimer ??= setTimeout(() => this.flush(), every);
  }

  private flush(): void {
    this.notifyTimer = null;
    const ids = this.readyIds;
    this.readyIds = [];
    if (ids.length && !this.closed) this.options.onReady(ids);
  }
}
