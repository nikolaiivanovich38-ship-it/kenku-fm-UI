/**
 * PERF-7: how long each soundboard sound is, so the player knows which sounds are short enough to decode whole.
 *
 * Howler's Web Audio mode decodes the whole file into memory (about 23 MB per stereo minute at 48 kHz) before it
 * plays, which is right for a short effect (instant start, gapless loop) and wasteful for a long ambience. A sound's
 * length is only known once it has loaded, so a sound Lyre has not heard before is streamed; its length is then
 * remembered here (also across restarts, in the player page's localStorage), and from its next play on a short sound
 * is decoded as before.
 */

/** Sounds up to this long are decoded whole; longer ones stream. Matches the engine's DEFAULT_SOURCE_POLICY. */
export const MAX_DECODE_SECONDS = 30;

/** Enough for every sound on a large set of soundboards; the oldest are forgotten first. */
const DEFAULT_LIMIT = 2000;

const STORAGE_KEY = "lyre.soundLengths";

/** The part of localStorage this uses. */
export interface LengthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SoundLengths {
  /** In the order they were learned, oldest first, so the oldest go first beyond the limit. */
  private lengths = new Map<string, number>();

  constructor(
    private storage?: LengthStorage,
    private limit = DEFAULT_LIMIT,
  ) {
    this.lengths = readStored(storage);
  }

  /** The sound's length in seconds, if it has played before. */
  get(src: string): number | undefined {
    return this.lengths.get(src);
  }

  /** True only for a sound known to be short enough to decode whole. */
  isShort(src: string): boolean {
    const seconds = this.lengths.get(src);
    return seconds !== undefined && seconds <= MAX_DECODE_SECONDS;
  }

  remember(src: string, seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.lengths.get(src) === seconds) {
      return;
    }
    this.lengths.delete(src);
    this.lengths.set(src, seconds);
    while (this.lengths.size > this.limit) {
      const oldest = this.lengths.keys().next().value as string;
      this.lengths.delete(oldest);
    }
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.lengths)));
    } catch {
      // Storage full or refused: the lengths still help for this visit.
    }
  }
}

function readStored(storage: LengthStorage | undefined): Map<string, number> {
  const lengths = new Map<string, number>();
  try {
    const stored: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    if (stored && typeof stored === "object") {
      for (const [src, seconds] of Object.entries(stored)) {
        if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
          lengths.set(src, seconds);
        }
      }
    }
  } catch {
    // Unreadable: start again; each sound streams once more.
  }
  return lengths;
}

function pageStorage(): LengthStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The player page's shared record of sound lengths. */
export const soundLengths = new SoundLengths(pageStorage());
