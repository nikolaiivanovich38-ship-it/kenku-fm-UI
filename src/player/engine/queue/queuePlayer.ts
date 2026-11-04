/**
 * Plays a queue through the engine: the link between the queue rules
 * (queue.ts) and voices. When a track ends, its voice's "ended" event asks the
 * queue what comes next; nothing polls. Next and previous cross-fade (1 s by
 * default, as Kenku FM did); a track missing from the library is skipped; a
 * track that cannot be played stops playback with Kenku FM's message.
 *
 * Volume is the music bus fader (engine.mixer), not part of this class.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import type { PlaybackEngine } from "../engine";
import type { BusId } from "../graph/mixer";
import type { Voice } from "../voice/voice";
import { currentEntry, navigate, NavigationAction, QueueEntry, QueueState, Random } from "./queue";

export interface QueueTrack {
  url: string;
  title: string;
  sizeBytes?: number;
}

interface QueuePlayerEvents {
  /** The queue, the current entry or the playing state changed. */
  change: () => void;
  /** A plain-language message for the toast. */
  error: (message: string) => void;
}

const DEFAULT_CROSSFADE_SECONDS = 1;

export class QueuePlayer extends TypedEmitter<QueuePlayerEvents> {
  private readonly engine: PlaybackEngine;
  private readonly lookup: (trackId: string) => QueueTrack | undefined;
  private readonly bus: BusId;
  private readonly crossfadeSeconds: number;
  private readonly random: Random;
  private queue: QueueState | null = null;
  private voice: Voice | null = null;
  private plays = 0;

  constructor(options: {
    engine: PlaybackEngine;
    lookup: (trackId: string) => QueueTrack | undefined;
    bus?: BusId;
    crossfadeSeconds?: number;
    random?: Random;
  }) {
    super();
    this.engine = options.engine;
    this.lookup = options.lookup;
    this.bus = options.bus ?? "music";
    this.crossfadeSeconds = options.crossfadeSeconds ?? DEFAULT_CROSSFADE_SECONDS;
    this.random = options.random ?? Math.random;
  }

  queueState(): QueueState | null {
    return this.queue;
  }

  currentEntry(): QueueEntry | null {
    return this.queue ? currentEntry(this.queue) : null;
  }

  isPlaying(): boolean {
    return this.voice?.state === "playing" || this.voice?.state === "loading";
  }

  /** Replace the queue without starting anything (e.g. a new playlist was chosen). */
  setQueue(queue: QueueState): void {
    this.queue = queue;
    this.emit("change");
  }

  /**
   * Apply an edit (insert, remove, move, shuffle, repeat). If the edit removed
   * the playing entry, that track stops, as in Kenku FM; the next entry becomes
   * current and starts on Play.
   */
  updateQueue(edit: (queue: QueueState) => QueueState): void {
    if (!this.queue) {
      return;
    }
    const before = this.queue.currentId;
    this.queue = edit(this.queue);
    if (this.voice && this.queue.currentId !== before) {
      this.stopVoice(0);
    }
    this.emit("change");
  }

  /** Play the current entry from the start. */
  play(): void {
    const entry = this.currentEntry();
    if (entry) {
      this.start(entry, this.voice ? this.crossfadeSeconds : 0);
    }
  }

  next(): void {
    this.move("next");
  }

  previous(): void {
    this.move("previous");
  }

  pause(): void {
    this.voice?.pause();
    this.emit("change");
  }

  resume(): void {
    if (this.voice?.state === "paused") {
      this.voice.resume();
    } else if (!this.voice) {
      this.play();
    }
    this.emit("change");
  }

  stop(): void {
    this.stopVoice(0);
    this.emit("change");
  }

  seek(seconds: number): void {
    this.voice?.seek(seconds);
  }

  private move(action: NavigationAction) {
    if (!this.queue) {
      return;
    }
    // Try each entry at most once, so a queue of missing tracks cannot loop forever.
    for (let attempt = 0; attempt < Math.max(1, this.queue.entries.length); attempt++) {
      const { state, outcome } = navigate(this.queue, action, {
        positionSeconds: this.voice?.position() ?? 0,
        random: this.random,
      });
      this.queue = state;
      if (outcome.kind === "stop") {
        this.stopVoice(this.crossfadeSeconds);
        break;
      }
      if (outcome.kind === "restart") {
        if (this.voice && !this.voice.isFinal()) {
          this.voice.seek(0);
          this.voice.resume();
        } else {
          this.start(currentEntry(state)!, 0);
        }
        break;
      }
      const entry = currentEntry(state)!;
      if (this.lookup(entry.trackId)) {
        this.start(entry, action === "ended" ? 0 : this.crossfadeSeconds);
        break;
      }
      // Deleted from the library: skip it the same way.
    }
    this.emit("change");
  }

  private start(entry: QueueEntry, crossfade: number) {
    const track = this.lookup(entry.trackId);
    if (!track) {
      this.move("next");
      return;
    }
    this.stopVoice(crossfade);
    const voice = this.engine.play({
      bus: this.bus,
      id: `${entry.entryId}#${++this.plays}`,
      media: { url: track.url, trackId: entry.trackId, sizeBytes: track.sizeBytes },
      fadeInSeconds: this.crossfadeSeconds,
    });
    this.voice = voice;
    voice.on("ended", () => {
      if (this.voice === voice) {
        this.voice = null;
        this.move("ended");
      }
    });
    voice.on("error", () => {
      if (this.voice === voice) {
        this.voice = null;
        this.emit("error", `Unable to play track: ${track.title}`);
        this.emit("change");
      }
    });
    this.emit("change");
  }

  private stopVoice(fadeSeconds: number) {
    const voice = this.voice;
    this.voice = null;
    if (voice) {
      void voice.stop(fadeSeconds);
    }
  }
}
