/**
 * Layers: one playing copy of a sound. A voice plays one layer, or two while a
 * loop cross-fades into its next pass. Two kinds:
 *
 * - BufferLayer: a decoded AudioBuffer (short effects and gapless loops).
 *   Starts can be scheduled to the sample; pausing or seeking replaces the
 *   AudioBufferSourceNode, which can only be started once.
 * - StreamLayer: an <audio> element routed through a MediaElementAudioSourceNode,
 *   so long tracks stream from disk instead of being decoded whole (PERF-7).
 *
 * Every layer frees all it holds in `release()`: nodes disconnected, the
 * element's source removed and its listeners dropped (BUG-4). Release is safe
 * to call more than once.
 */
import type { BufferLike, BufferSourceLike, EngineContext, MediaElementLike, NodeLike } from "../audio/types";

export interface LayerEvents {
  /** The layer reached the end of the media (never for a native loop). */
  onEnded(): void;
  onError(message: string): void;
}

export interface Layer {
  readonly kind: "buffer" | "stream";
  /** Length of the media in seconds; NaN when the stream does not say. */
  readonly duration: number;
  /** Start playing at context time `when` (streams start at once) from `offset` seconds. */
  start(when: number, offset: number): void;
  /** Position in the media, in seconds. */
  position(): number;
  /** Context time at which the media ends at the current pace; Infinity when looping natively, paused or unknown. */
  endsAt(): number;
  seek(offset: number): void;
  pause(): void;
  resume(): void;
  /** Loop the media by itself, without a cross-fade (gapless for buffers). */
  setNativeLoop(loop: boolean): void;
  release(): void;
}

/** Something that can make layers: a decoded buffer, or a URL to stream. */
export interface PlayableSource {
  readonly kind: "buffer" | "stream";
  openLayer(destination: NodeLike, events: LayerEvents): Promise<Layer>;
  /** The voice no longer needs this source (gives back a cache lease). */
  release(): void;
}

export class BufferLayer implements Layer {
  readonly kind = "buffer";
  private source: BufferSourceLike | null = null;
  /** Context time at which `offset` was (or will be) playing. */
  private startTime = 0;
  private offset = 0;
  private pausedAt: number | null = null;
  private loop = false;
  private released = false;

  constructor(
    private readonly context: EngineContext,
    private readonly buffer: BufferLike,
    private readonly destination: NodeLike,
    private readonly events: LayerEvents,
  ) {}

  get duration() {
    return this.buffer.duration;
  }

  start(when: number, offset: number) {
    if (this.released) {
      return;
    }
    this.stopSource();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.connect(this.destination);
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      this.source = null;
      source.onended = null;
      source.disconnect();
      this.events.onEnded();
    };
    this.source = source;
    this.startTime = Math.max(when, this.context.currentTime);
    this.offset = clampOffset(offset, this.buffer.duration);
    this.pausedAt = null;
    source.start(this.startTime, this.offset);
  }

  position() {
    if (this.pausedAt !== null) {
      return this.pausedAt;
    }
    const played = this.offset + Math.max(0, this.context.currentTime - this.startTime);
    return this.loop ? played % this.buffer.duration : Math.min(played, this.buffer.duration);
  }

  endsAt() {
    if (this.loop || this.pausedAt !== null || !this.source) {
      return Infinity;
    }
    return this.startTime + (this.buffer.duration - this.offset);
  }

  seek(offset: number) {
    if (this.pausedAt !== null) {
      this.pausedAt = clampOffset(offset, this.buffer.duration);
    } else {
      this.start(this.context.currentTime, offset);
    }
  }

  pause() {
    if (this.pausedAt === null && this.source) {
      const at = this.position();
      this.stopSource();
      this.pausedAt = at;
    }
  }

  resume() {
    if (this.pausedAt !== null) {
      this.start(this.context.currentTime, this.pausedAt);
    }
  }

  setNativeLoop(loop: boolean) {
    if (this.loop === loop) {
      return;
    }
    // Re-anchor so position() and endsAt() stay right from here on.
    const at = this.position();
    this.loop = loop;
    if (this.source && this.pausedAt === null) {
      this.offset = at;
      this.startTime = this.context.currentTime;
      this.source.loop = loop;
    }
  }

  release() {
    this.released = true;
    this.stopSource();
  }

  private stopSource() {
    const source = this.source;
    if (!source) {
      return;
    }
    this.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped: nothing to do.
    }
    source.disconnect();
  }
}

export class StreamLayer implements Layer {
  readonly kind = "stream";
  private node: NodeLike | null = null;
  private released = false;
  private readonly listeners: [string, () => void][] = [];

  private constructor(
    private readonly context: EngineContext,
    private readonly element: MediaElementLike,
    private readonly events: LayerEvents,
  ) {}

  /** Load `url` into a new element and wait until its length is known. */
  static open(
    context: EngineContext,
    element: MediaElementLike,
    url: string,
    destination: NodeLike,
    events: LayerEvents,
  ): Promise<StreamLayer> {
    const layer = new StreamLayer(context, element, events);
    return new Promise<StreamLayer>((resolve, reject) => {
      let ready = false;
      layer.listen("loadedmetadata", () => {
        ready = true;
        resolve(layer);
      });
      layer.listen("error", () => {
        if (ready) {
          events.onError("The audio file stopped playing");
        } else {
          layer.release();
          reject(new Error("The audio file could not be opened"));
        }
      });
      layer.listen("ended", () => {
        if (!layer.released) {
          events.onEnded();
        }
      });
      try {
        layer.node = context.createMediaElementSource(element);
        layer.node.connect(destination);
        element.preload = "auto";
        element.src = url;
        element.load();
      } catch (error) {
        layer.release();
        reject(error);
      }
    });
  }

  get duration() {
    return this.element.duration;
  }

  start(_when: number, offset: number) {
    this.element.currentTime = clampOffset(offset, this.duration);
    this.play();
  }

  position() {
    return this.element.currentTime;
  }

  endsAt() {
    const element = this.element;
    if (element.loop || element.paused || !Number.isFinite(this.duration)) {
      return Infinity;
    }
    return this.context.currentTime + Math.max(0, this.duration - element.currentTime);
  }

  seek(offset: number) {
    this.element.currentTime = clampOffset(offset, this.duration);
  }

  pause() {
    this.element.pause();
  }

  resume() {
    this.play();
  }

  setNativeLoop(loop: boolean) {
    this.element.loop = loop;
  }

  release() {
    if (this.released) {
      return;
    }
    this.released = true;
    for (const [type, listener] of this.listeners) {
      this.element.removeEventListener(type, listener);
    }
    this.listeners.length = 0;
    this.element.pause();
    // Removing the source and calling load() is how a media element lets go of the file.
    this.element.removeAttribute("src");
    this.element.load();
    this.node?.disconnect();
    this.node = null;
  }

  private play() {
    if (this.released) {
      return;
    }
    this.element.play().catch((error: unknown) => {
      if (!this.released) {
        this.events.onError(error instanceof Error ? error.message : "The audio file could not be played");
      }
    });
  }

  private listen(type: string, listener: () => void) {
    this.listeners.push([type, listener]);
    this.element.addEventListener(type, listener);
  }
}

/** A decoded buffer as a source of layers. */
export function bufferSource(context: EngineContext, buffer: BufferLike, onRelease: () => void = () => undefined): PlayableSource {
  let released = false;
  return {
    kind: "buffer",
    openLayer: (destination, events) => Promise.resolve(new BufferLayer(context, buffer, destination, events)),
    release: () => {
      if (!released) {
        released = true;
        onRelease();
      }
    },
  };
}

/** A URL streamed through media elements as a source of layers. */
export function streamSource(
  context: EngineContext,
  url: string,
  createElement: () => MediaElementLike,
): PlayableSource {
  return {
    kind: "stream",
    openLayer: (destination, events) => StreamLayer.open(context, createElement(), url, destination, events),
    release: () => undefined,
  };
}

function clampOffset(offset: number, duration: number) {
  const upper = Number.isFinite(duration) ? duration : Infinity;
  return Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, upper));
}
