/**
 * The audio cache's upkeep in the app (security review 3). MediaCache can tidy, empty and close its folder; this
 * says when: a tidy-up (copies whose original changed or went, leftovers of a job cut short) once, a while after
 * the main window shows, so it never competes with start-up; emptying from Settings > Clear cache; closing before
 * Lyre quits, which stops a conversion under way and removes its part file.
 */
export interface UpkeptCache {
  sweep(): Promise<number>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

/** One minute after the window shows: the first cue has usually played by then. */
const DEFAULT_SWEEP_AFTER_MS = 60_000;

export class MediaUpkeep {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private swept = false;
  private closed = false;
  private sweeping: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly cache: UpkeptCache,
    private readonly options: { sweepAfterMs?: number; log?: (message: string, error?: unknown) => void } = {},
  ) {}

  /** The main window is showing: tidy the cache once, a while from now. */
  windowShown(): void {
    if (this.swept || this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.swept = true;
      this.sweeping = this.cache.sweep().catch((error) => this.log("Could not tidy the audio cache", error));
    }, this.options.sweepAfterMs ?? DEFAULT_SWEEP_AFTER_MS);
    // A pending tidy-up never keeps Lyre running.
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Settings > Clear cache. */
  async clear(): Promise<void> {
    if (this.closed) return;
    await this.cache.clear();
  }

  /** Before quitting. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.sweeping;
    await this.cache.close();
  }

  private log(message: string, error: unknown) {
    (this.options.log ?? ((m, e) => console.warn(m, e)))(message, error);
  }
}
