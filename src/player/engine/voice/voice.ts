/**
 * A voice: one playing item (a track, a sound, a preview) with its own volume,
 * fades and loop. See the state diagram in docs/playback-engine.md.
 *
 * Graph per voice:
 *   pass layer -> pass gain ┐                      (fade in / fade out of one pass)
 *   pass layer -> pass gain ┴> envelope -> volume -> bus input
 *                              (stop fades)  (the item's own volume)
 *
 * A "pass" is one play-through. A loop with a fade-out cross-fades each pass
 * into the next: shortly before the fade point the next pass is opened
 * (buffers: started on the exact sample; streams: started at the fade point),
 * so at most two passes ever exist. A loop without a fade-out loops natively
 * (gapless for decoded buffers).
 *
 * Timing is event-driven: one timer per fade point and the sources' own
 * "ended" events. Nothing polls (PERF-1); position() is read on demand.
 * Every way out (end, stop, error) goes through finish(), which releases
 * every node, layer and timer the voice made (BUG-4).
 */
import { TypedEmitter } from "tiny-typed-emitter";

import { EngineContext, GainLike, NodeLike, rampTo, Scheduler } from "../audio/types";
import type { BusId } from "../graph/mixer";
import { Layer, PlayableSource } from "../sources/layers";

export type VoiceState = "loading" | "playing" | "paused" | "stopping" | "stopped" | "ended" | "failed";

export const FINAL_STATES: readonly VoiceState[] = ["stopped", "ended", "failed"];

export interface VoiceOptions {
  /** 0 to 1. Default 1. */
  volume?: number;
  loop?: boolean;
  /** Fade in at the start (and on each cross-faded loop pass). Default 0. */
  fadeInSeconds?: number;
  /** Fade out before the end, the default stop fade, and the loop cross-fade length. Default 0. */
  fadeOutSeconds?: number;
  /** Start this many seconds into the media. Default 0. */
  startAt?: number;
}

export interface VoiceDeps {
  context: EngineContext;
  scheduler: Scheduler;
  /** Where the voice plays into: a bus input. */
  destination: NodeLike;
}

interface VoiceEvents {
  state: (state: VoiceState) => void;
  /** The media's length in seconds is known. */
  loaded: (duration: number) => void;
  /** Reached the end by itself (not stopped, not failed). */
  ended: () => void;
  /** Could not play; the message is for the log and for a plain-language toast. */
  error: (message: string) => void;
}

interface Pass {
  layer: Layer | null;
  gain: GainLike;
  started: boolean;
}

/** Volume moves are smoothed this much so they do not click. */
const SMOOTHING_SECONDS = 0.02;
/** How early the next loop pass is prepared before its fade point. */
const PREPARE_AHEAD_SECONDS = { buffer: 0.25, stream: 1.5 } as const;
/** An outgoing pass is released at the latest this long after its fade should have finished. */
const OUTGOING_GRACE_SECONDS = 0.5;

let voiceCounter = 0;

export class Voice extends TypedEmitter<VoiceEvents> {
  readonly id: string;
  /** The bus this voice plays on, when the engine made it. */
  readonly bus: BusId | null;
  state: VoiceState = "loading";
  /** Length in seconds; NaN until loaded or when a stream does not say. */
  duration = NaN;
  /** Why the voice failed, once its state is "failed". */
  errorMessage: string | null = null;
  /** How it plays once loaded: decoded into memory, or streamed from the file. */
  sourceKind: "buffer" | "stream" | null = null;

  private readonly context: EngineContext;
  private readonly scheduler: Scheduler;
  private readonly options: Required<VoiceOptions>;
  private readonly volume: GainLike;
  private readonly envelope: GainLike;
  private source: PlayableSource | null = null;
  private current: Pass | null = null;
  private next: Pass | null = null;
  private outgoing: Pass | null = null;
  private outgoingEndsAt = 0;
  private timers = new Set<unknown>();
  private stopping: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(
    deps: VoiceDeps,
    source: Promise<PlayableSource>,
    options: VoiceOptions,
    meta: { id?: string; bus?: BusId } = {},
  ) {
    super();
    this.id = meta.id ?? `voice-${++voiceCounter}`;
    this.bus = meta.bus ?? null;
    this.context = deps.context;
    this.scheduler = deps.scheduler;
    this.options = {
      volume: clamp01(options.volume ?? 1),
      loop: options.loop ?? false,
      fadeInSeconds: Math.max(0, options.fadeInSeconds ?? 0),
      fadeOutSeconds: Math.max(0, options.fadeOutSeconds ?? 0),
      startAt: Math.max(0, options.startAt ?? 0),
    };
    this.volume = this.context.createGain();
    this.envelope = this.context.createGain();
    this.volume.gain.setValueAtTime(this.options.volume, this.context.currentTime);
    this.envelope.connect(this.volume);
    this.volume.connect(deps.destination);

    source.then(
      (loaded) => this.begin(loaded),
      (error: unknown) => this.fail(messageOf(error, "The audio file could not be loaded")),
    );
  }

  isFinal(): boolean {
    return FINAL_STATES.includes(this.state);
  }

  /** Position in the media, in seconds. */
  position(): number {
    return this.current?.layer?.position() ?? this.options.startAt;
  }

  /** Passes holding audio right now (at most two). For tests and diagnostics. */
  layerCount(): number {
    return [this.outgoing, this.current, this.next].filter((pass) => pass !== null).length;
  }

  setVolume(volume: number, seconds = SMOOTHING_SECONDS): void {
    this.options.volume = clamp01(volume);
    if (!this.isFinal()) {
      rampTo(this.volume.gain, this.options.volume, this.context.currentTime, seconds);
    }
  }

  setLoop(loop: boolean): void {
    if (this.isFinal() || this.options.loop === loop) {
      return;
    }
    this.options.loop = loop;
    this.cancelTransition();
    this.current?.layer?.setNativeLoop(this.loopsNatively());
    this.armFadePoint();
  }

  /** Jump to `seconds`; the fade-out and the next loop pass move with it (BUG-5). */
  seek(seconds: number): void {
    if (this.state !== "playing" && this.state !== "paused") {
      return;
    }
    this.cancelTransition();
    this.releaseOutgoing();
    const pass = this.current;
    if (!pass?.layer) {
      return;
    }
    pass.layer.seek(seconds);
    rampTo(pass.gain.gain, 1, this.context.currentTime, SMOOTHING_SECONDS);
    this.armFadePoint();
  }

  pause(): void {
    if (this.state !== "playing") {
      return;
    }
    this.cancelTransition();
    this.releaseOutgoing();
    this.current?.layer?.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") {
      return;
    }
    this.setState("playing");
    const pass = this.current;
    if (pass?.layer) {
      // A pause during the closing fade would otherwise resume silent.
      rampTo(pass.gain.gain, 1, this.context.currentTime, SMOOTHING_SECONDS);
      pass.layer.resume();
    }
    this.armFadePoint();
  }

  /**
   * Stop, fading out over `fadeSeconds` (default: the voice's fade-out).
   * Resolves once everything is released. A second stop with 0 cuts a fade short.
   */
  stop(fadeSeconds: number = this.options.fadeOutSeconds): Promise<void> {
    if (this.isFinal()) {
      return Promise.resolve();
    }
    if (fadeSeconds <= 0 || this.state === "loading" || this.state === "paused" || !this.current?.layer) {
      this.finish("stopped");
      return Promise.resolve();
    }
    if (this.stopping) {
      return this.stopping;
    }
    this.cancelTransition();
    this.setState("stopping");
    rampTo(this.envelope.gain, 0, this.context.currentTime, fadeSeconds);
    this.stopping = new Promise((resolve) => (this.resolveStop = resolve));
    this.after(fadeSeconds, () => this.finish("stopped"));
    return this.stopping;
  }

  private async begin(source: PlayableSource) {
    if (this.isFinal()) {
      source.release();
      return;
    }
    this.source = source;
    this.sourceKind = source.kind;
    const pass = this.newPass();
    this.current = pass;
    await this.open(pass);
    if (this.current !== pass || !pass.layer || this.isFinal()) {
      return;
    }
    this.duration = pass.layer.duration;
    this.emit("loaded", this.duration);
    this.startPass(pass, this.context.currentTime, this.options.startAt, this.options.fadeInSeconds);
    this.setState("playing");
    this.armFadePoint();
  }

  private newPass(): Pass {
    const gain = this.context.createGain();
    gain.connect(this.envelope);
    return { layer: null, gain, started: false };
  }

  /** Open the pass's layer; on failure the voice fails. Drops the layer if the pass is no longer wanted. */
  private async open(pass: Pass): Promise<void> {
    let layer: Layer;
    try {
      layer = await this.source!.openLayer(pass.gain, {
        onEnded: () => this.onPassEnded(pass),
        onError: (message) => this.fail(message),
      });
    } catch (error) {
      if (this.current === pass || this.next === pass) {
        this.fail(messageOf(error, "The audio file could not be opened"));
      }
      return;
    }
    if (this.isFinal() || (this.current !== pass && this.next !== pass)) {
      layer.release();
      return;
    }
    pass.layer = layer;
    layer.setNativeLoop(this.loopsNatively());
  }

  private startPass(pass: Pass, when: number, offset: number, fadeIn: number) {
    const at = Math.max(when, this.context.currentTime);
    if (fadeIn > 0) {
      pass.gain.gain.setValueAtTime(0, at);
      pass.gain.gain.linearRampToValueAtTime(1, at + fadeIn);
    }
    pass.started = true;
    pass.layer!.start(at, offset);
  }

  private loopsNatively() {
    return this.options.loop && this.options.fadeOutSeconds <= 0;
  }

  /** Fade length actually used: a loop's cross-fade can be at most half a pass. */
  private fadeLength(): number {
    const { fadeOutSeconds, loop } = this.options;
    if (!Number.isFinite(this.duration)) {
      return fadeOutSeconds;
    }
    return Math.min(fadeOutSeconds, loop ? this.duration / 2 : this.duration);
  }

  /** Set the timer that prepares the closing fade, or the next loop pass, of the current pass. */
  private armFadePoint() {
    this.cancelTransition();
    const pass = this.current;
    if (this.state !== "playing" || !pass?.layer || this.options.fadeOutSeconds <= 0) {
      return;
    }
    const fadeAt = pass.layer.endsAt() - this.fadeLength();
    if (!Number.isFinite(fadeAt)) {
      return;
    }
    const prepareAt = Math.max(fadeAt - PREPARE_AHEAD_SECONDS[pass.layer.kind], this.outgoing ? this.outgoingEndsAt : 0);
    this.transitionTimer = this.after(prepareAt - this.context.currentTime, () => this.prepareTransition(pass));
  }

  private transitionTimer: unknown = null;
  private handoverTimer: unknown = null;

  private prepareTransition(pass: Pass) {
    this.transitionTimer = null;
    if (this.state !== "playing" || this.current !== pass || !pass.layer) {
      return;
    }
    // Normally silent by now; never keep a third pass.
    this.releaseOutgoing();
    const now = this.context.currentTime;
    const length = this.fadeLength();
    const fadeAt = Math.max(now, pass.layer.endsAt() - length);
    const gain = pass.gain.gain;
    gain.cancelScheduledValues(fadeAt);
    gain.setValueAtTime(gain.value, fadeAt);
    gain.linearRampToValueAtTime(0, fadeAt + length);

    if (!this.options.loop) {
      return; // The pass fades out and ends; onPassEnded finishes the voice.
    }
    const next = this.newPass();
    this.next = next;
    void this.open(next).then(() => {
      if (this.next === next && next.layer && next.layer.kind === "buffer") {
        // Buffers start on the exact sample, ahead of time.
        this.startPass(next, fadeAt, 0, this.options.fadeInSeconds);
      }
      if (this.current === next && next.layer && !next.started) {
        // A stream that opened after its fade point starts as soon as it can.
        this.startPass(next, now, 0, this.options.fadeInSeconds);
        this.armFadePoint();
      }
    });
    this.handoverTimer = this.after(fadeAt - now, () => this.handOver(pass, next, fadeAt + length));
  }

  /** At the fade point: the current pass becomes the outgoing one and the next pass takes over. */
  private handOver(from: Pass, to: Pass, fromEndsAt: number) {
    this.handoverTimer = null;
    if (this.current !== from || this.next !== to) {
      return;
    }
    this.outgoing = from;
    this.outgoingEndsAt = fromEndsAt;
    this.after(fromEndsAt + OUTGOING_GRACE_SECONDS - this.context.currentTime, () => {
      if (this.outgoing === from) {
        this.releaseOutgoing();
      }
    });
    this.current = to;
    this.next = null;
    if (to.layer && !to.started) {
      this.startPass(to, this.context.currentTime, 0, this.options.fadeInSeconds);
    }
    this.armFadePoint();
  }

  private onPassEnded(pass: Pass) {
    if (pass === this.outgoing) {
      this.releaseOutgoing();
      return;
    }
    if (pass !== this.current || this.isFinal()) {
      return;
    }
    if (this.state === "stopping") {
      this.finish("stopped");
    } else if (this.options.loop) {
      // The pass ended without a cross-fade (e.g. a stream that did not say
      // how long it is): start the next one at once.
      this.cancelTransition();
      pass.layer?.release();
      pass.gain.disconnect();
      const next = this.newPass();
      this.current = next;
      void this.open(next).then(() => {
        if (this.current === next && next.layer && this.state === "playing") {
          this.startPass(next, this.context.currentTime, 0, this.options.fadeInSeconds);
          this.armFadePoint();
        }
      });
    } else {
      this.finish("ended");
    }
  }

  /** Drop a prepared next pass and an armed fade; the current pass plays on at full level. */
  private cancelTransition() {
    if (this.transitionTimer !== null) {
      this.clear(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.handoverTimer !== null) {
      this.clear(this.handoverTimer);
      this.handoverTimer = null;
      // The closing fade was already scheduled on the current pass: undo it.
      if (this.current) {
        rampTo(this.current.gain.gain, 1, this.context.currentTime, SMOOTHING_SECONDS);
      }
    }
    if (this.next) {
      releasePass(this.next);
      this.next = null;
    }
  }

  private releaseOutgoing() {
    if (this.outgoing) {
      releasePass(this.outgoing);
      this.outgoing = null;
    }
  }

  private fail(message: string) {
    if (this.isFinal()) {
      return;
    }
    // Set before the state change, so a listener that sees "failed" can read why.
    this.errorMessage = message;
    this.finish("failed");
    if (this.listenerCount("error") > 0) {
      this.emit("error", message);
    }
  }

  private finish(state: "stopped" | "ended" | "failed") {
    if (this.isFinal()) {
      return;
    }
    for (const timer of this.timers) {
      this.scheduler.clearTimeout(timer);
    }
    this.timers.clear();
    this.transitionTimer = null;
    this.handoverTimer = null;
    for (const pass of [this.outgoing, this.current, this.next]) {
      if (pass) {
        releasePass(pass);
      }
    }
    this.outgoing = this.current = this.next = null;
    this.envelope.disconnect();
    this.volume.disconnect();
    this.source?.release();
    this.source = null;
    this.setState(state);
    if (state === "ended") {
      this.emit("ended");
    }
    this.resolveStop?.();
    this.resolveStop = null;
  }

  private setState(state: VoiceState) {
    if (this.state !== state) {
      this.state = state;
      this.emit("state", state);
    }
  }

  /** Run `callback` after `seconds`; every timer is cleared when the voice finishes. */
  private after(seconds: number, callback: () => void): unknown {
    const handle = this.scheduler.setTimeout(() => {
      this.timers.delete(handle);
      callback();
    }, Math.max(0, seconds) * 1000);
    this.timers.add(handle);
    return handle;
  }

  private clear(handle: unknown) {
    this.scheduler.clearTimeout(handle);
    this.timers.delete(handle);
  }
}

function releasePass(pass: Pass) {
  pass.layer?.release();
  pass.layer = null;
  pass.gain.disconnect();
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
