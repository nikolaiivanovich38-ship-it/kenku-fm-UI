/**
 * A voice: one playing item (a track, a sound, a preview) with its own volume,
 * fades and loop. See the state diagram in docs/playback-engine.md.
 *
 * Graph per voice:
 *   pass layer -> pass gain ┐                      (the pass's shape: fades, End, loop crossfade)
 *   pass layer -> pass gain ┴> envelope -> volume -> bus input
 *                              (crossfade in, stop fades)  (the item's own volume)
 *
 * A "pass" is one play-through, from Start (or Loop start) to End. How passes
 * play is a PassPlan (passPlan.ts): the original straight fades, or a track's
 * audio profile (PLY-12). A pass's gain is written on the audio timeline when
 * the pass starts (and again after a seek, pause or loop switch), so fades
 * and the silence at End land on the exact sample.
 *
 * A loop that needs passes (a crossfade, a Loop start or End inside the
 * media, a fade-out) opens the next pass shortly before the current one
 * reaches End minus the overlap: buffers are started on the exact sample,
 * streams at that moment. At most two passes ever exist. Any other loop loops
 * natively (gapless for decoded buffers).
 *
 * Timing is event-driven: one timer per hand-over or End inside the media and
 * the sources' own "ended" events. Nothing polls (PERF-1); position() is read
 * on demand. Every way out (end, stop, error) goes through finish(), which
 * releases every node, layer and timer the voice made (BUG-4).
 */
import { TypedEmitter } from "tiny-typed-emitter";

import type { AudioProfile } from "../../../common/domain";
import { EngineContext, GainLike, NodeLike, rampTo, Scheduler } from "../audio/types";
import type { BusId } from "../graph/mixer";
import { Layer, PlayableSource } from "../sources/layers";
import { PassPlan, plainPlan, points, profilePlan } from "./passPlan";

export type VoiceState = "loading" | "playing" | "paused" | "stopping" | "stopped" | "ended" | "failed";

export const FINAL_STATES: readonly VoiceState[] = ["stopped", "ended", "failed"];

export interface VoiceOptions {
  /** 0 to 1. Default 1. */
  volume?: number;
  /** Without a profile: loop the whole media. With one, the profile's "after" decides; setLoop changes it. */
  loop?: boolean;
  /** Without a profile: fade in at the start (and on each cross-faded loop pass). Default 0. */
  fadeInSeconds?: number;
  /**
   * The default stop fade. Without a profile also the fade-out before the end
   * and the loop cross-fade length. Default 0.
   */
  fadeOutSeconds?: number;
  /** Start this many seconds into the media. Default 0, or the profile's Start. */
  startAt?: number;
  /**
   * PLY-12: play the media as this audio profile says: from Start to End, its
   * shaped fades, and back to Loop start with the loop crossfade when "after"
   * is "loop". With "next" or "stop" the voice ends at End; what follows is
   * up to whoever started it.
   */
  profile?: AudioProfile;
  /** Fade the whole voice in from silence when it starts (a crossfade from what played before). Default 0. */
  crossfadeInSeconds?: number;
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
  /** Every pass after the first: the profile's fade-in is not played again. */
  looped: boolean;
}

/** Volume moves are smoothed this much so they do not click. */
const SMOOTHING_SECONDS = 0.02;
/** How early the next loop pass is prepared before its hand-over. */
const PREPARE_AHEAD_SECONDS = { buffer: 0.25, stream: 1.5 } as const;
/** An outgoing pass is released at the latest this long after its End. */
const OUTGOING_GRACE_SECONDS = 0.5;

let voiceCounter = 0;

export class Voice extends TypedEmitter<VoiceEvents> {
  readonly id: string;
  /** The bus this voice plays on, when the engine made it. */
  readonly bus: BusId | null;
  /** The room this voice plays in, when it was sent to one (PLY-8). */
  readonly room: string | null;
  state: VoiceState = "loading";
  /** Length in seconds; NaN until loaded or when a stream does not say. */
  duration = NaN;
  /** Why the voice failed, once its state is "failed". */
  errorMessage: string | null = null;
  /** How it plays once loaded: decoded into memory, or streamed from the file. */
  sourceKind: "buffer" | "stream" | null = null;

  private readonly context: EngineContext;
  private readonly scheduler: Scheduler;
  private readonly options: Required<Omit<VoiceOptions, "profile">>;
  private readonly profile: AudioProfile | null;
  private plan: PassPlan | null = null;
  private readonly volume: GainLike;
  private readonly envelope: GainLike;
  private source: PlayableSource | null = null;
  private current: Pass | null = null;
  private next: Pass | null = null;
  private outgoing: Pass | null = null;
  private outgoingEndsAt = 0;
  private timers = new Set<unknown>();
  private transitionTimer: unknown = null;
  private handoverTimer: unknown = null;
  private stopping: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(
    deps: VoiceDeps,
    source: Promise<PlayableSource>,
    options: VoiceOptions,
    meta: { id?: string; bus?: BusId; room?: string } = {},
  ) {
    super();
    this.id = meta.id ?? `voice-${++voiceCounter}`;
    this.bus = meta.bus ?? null;
    this.room = meta.room ?? null;
    this.context = deps.context;
    this.scheduler = deps.scheduler;
    this.profile = options.profile ?? null;
    this.options = {
      volume: clamp01(options.volume ?? 1),
      loop: this.profile ? this.profile.after === "loop" : (options.loop ?? false),
      fadeInSeconds: Math.max(0, options.fadeInSeconds ?? 0),
      fadeOutSeconds: Math.max(0, options.fadeOutSeconds ?? 0),
      startAt: Math.max(0, options.startAt ?? (this.profile ? this.profile.startMs / 1000 : 0)),
      crossfadeInSeconds: Math.max(0, options.crossfadeInSeconds ?? 0),
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
    if (this.plan) {
      this.plan = this.makePlan();
    }
    this.current?.layer?.setNativeLoop(this.loopsNatively());
    this.reshape();
    this.armPassTimers();
  }

  /** Jump to `seconds`; the fades, End and the next loop pass move with it (BUG-5). */
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
    if (this.state === "playing") {
      this.reshape();
      this.armPassTimers();
    }
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
      pass.layer.resume();
      this.reshape();
    }
    this.armPassTimers();
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
    // Keep a pending End timer (the pass may reach End during the fade); drop any next loop pass.
    this.dropNextPass();
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
    const pass = this.newPass(false);
    this.current = pass;
    await this.open(pass);
    if (this.current !== pass || !pass.layer || this.isFinal()) {
      return;
    }
    this.duration = pass.layer.duration;
    this.plan = this.makePlan();
    pass.layer.setNativeLoop(this.loopsNatively());
    this.emit("loaded", this.duration);
    const now = this.context.currentTime;
    if (this.options.crossfadeInSeconds > 0) {
      this.envelope.gain.setValueAtTime(0, now);
      this.envelope.gain.linearRampToValueAtTime(1, now + this.options.crossfadeInSeconds);
    }
    this.startPass(pass, now, this.plan.startAt);
    this.setState("playing");
    this.armPassTimers();
  }

  private makePlan(): PassPlan {
    if (this.profile) {
      // setLoop can switch a profile's loop on or off; "next" and "stop" both end the voice at End.
      const after = this.options.loop ? "loop" : this.profile.after === "loop" ? "next" : this.profile.after;
      return profilePlan({ ...this.profile, after }, this.duration, this.options.startAt);
    }
    return plainPlan(this.options, this.duration);
  }

  private newPass(looped: boolean): Pass {
    const gain = this.context.createGain();
    gain.connect(this.envelope);
    return { layer: null, gain, started: false, looped };
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

  private startPass(pass: Pass, when: number, offset: number) {
    const at = Math.max(when, this.context.currentTime);
    this.shape(pass, offset, at, false);
    pass.started = true;
    pass.layer!.start(at, offset);
  }

  /**
   * Write the pass's gain on the timeline from media `position` at context time
   * `when` up to its End. `smooth` glides from the level heard now (after a
   * seek or resume) instead of jumping.
   */
  private shape(pass: Pass, position: number, when: number, smooth: boolean) {
    const plan = this.plan!;
    const param = pass.gain.gain;
    const held = param.value;
    param.cancelScheduledValues(when);
    const end = Number.isFinite(plan.endAt) ? Math.max(position, plan.endAt) : position;
    let list = points(plan, position, end, pass.looped);
    if (smooth) {
      const glideTo = Math.min(position + SMOOTHING_SECONDS, end);
      param.setValueAtTime(held, when);
      param.linearRampToValueAtTime(plan.gainAt(glideTo, pass.looped), when + (glideTo - position));
      list = list.filter((point) => point.position > glideTo);
    } else {
      param.setValueAtTime(list[0].gain, when);
      list = list.slice(1);
    }
    for (const point of list) {
      param.linearRampToValueAtTime(point.gain, when + (point.position - position));
    }
    if (!this.loopsNatively() && this.endsInsideMedia()) {
      // Silent from End on, to the sample, whatever the timers do.
      param.setValueAtTime(0, when + (end - position));
    }
  }

  /** Re-write the current pass's gain from where it is now. */
  private reshape() {
    const pass = this.current;
    if (pass?.layer && this.plan && this.state === "playing") {
      this.shape(pass, pass.layer.position(), this.context.currentTime, true);
    }
  }

  private loopsNatively() {
    return Boolean(this.plan?.native) && this.options.loop;
  }

  /** End is before the end of the media, so the voice must stop each pass itself. */
  private endsInsideMedia(): boolean {
    const plan = this.plan;
    return plan !== null && Number.isFinite(plan.endAt) && !(plan.endAt >= this.duration);
  }

  /** Context time at which the pass reaches End; Infinity when it will not (paused, native loop, unknown). */
  private passEndsAt(pass: Pass): number {
    const layer = pass.layer;
    const plan = this.plan;
    if (!layer || !plan || this.loopsNatively()) {
      return Infinity;
    }
    const natural = layer.endsAt();
    if (Number.isFinite(natural)) {
      return Number.isFinite(plan.endAt) && Number.isFinite(layer.duration) ? natural - (layer.duration - plan.endAt) : natural;
    }
    if (this.state === "playing" && Number.isFinite(plan.endAt)) {
      return this.context.currentTime + Math.max(0, plan.endAt - layer.position());
    }
    return Infinity;
  }

  /** Set the timer for what happens next to the current pass: the next loop pass, or End inside the media. */
  private armPassTimers() {
    this.cancelTransition();
    const pass = this.current;
    if (this.state !== "playing" || !pass?.layer || !this.plan) {
      return;
    }
    const endsAt = this.passEndsAt(pass);
    if (!Number.isFinite(endsAt)) {
      return;
    }
    const now = this.context.currentTime;
    if (this.options.loop) {
      const handoverAt = endsAt - this.plan.overlap;
      const prepareAt = Math.max(handoverAt - PREPARE_AHEAD_SECONDS[pass.layer.kind], this.outgoing ? this.outgoingEndsAt : 0);
      this.transitionTimer = this.after(prepareAt - now, () => this.prepareTransition(pass));
    } else if (this.endsInsideMedia()) {
      this.transitionTimer = this.after(endsAt - now, () => {
        this.transitionTimer = null;
        this.onPassEnded(pass);
      });
    }
  }

  private prepareTransition(pass: Pass) {
    this.transitionTimer = null;
    if (this.state !== "playing" || this.current !== pass || !pass.layer || !this.plan) {
      return;
    }
    // Normally silent by now; never keep a third pass.
    this.releaseOutgoing();
    const now = this.context.currentTime;
    const endsAt = this.passEndsAt(pass);
    const handoverAt = Math.max(now, endsAt - this.plan.overlap);
    const loopFrom = this.plan.loopFrom;
    const next = this.newPass(true);
    this.next = next;
    void this.open(next).then(() => {
      if (this.next === next && next.layer && next.layer.kind === "buffer") {
        // Buffers start on the exact sample, ahead of time.
        this.startPass(next, handoverAt, loopFrom);
      }
      if (this.current === next && next.layer && !next.started) {
        // A stream that opened after its hand-over starts as soon as it can.
        this.startPass(next, this.context.currentTime, loopFrom);
        this.armPassTimers();
      }
    });
    this.handoverTimer = this.after(handoverAt - now, () => this.handOver(pass, next, endsAt));
  }

  /** At the hand-over: the current pass becomes the outgoing one and the next pass takes over. */
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
      this.startPass(to, this.context.currentTime, this.plan!.loopFrom);
    }
    this.armPassTimers();
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
      // The pass ended without a hand-over (e.g. a stream that did not say
      // how long it is): start the next one at once.
      this.cancelTransition();
      releasePass(pass);
      const next = this.newPass(true);
      this.current = next;
      void this.open(next).then(() => {
        if (this.current === next && next.layer && this.state === "playing") {
          this.startPass(next, this.context.currentTime, this.plan!.loopFrom);
          this.armPassTimers();
        }
      });
    } else {
      this.finish("ended");
    }
  }

  /** Drop the armed timers and a prepared next pass; callers re-write the current pass's gain. */
  private cancelTransition() {
    if (this.transitionTimer !== null) {
      this.clear(this.transitionTimer);
      this.transitionTimer = null;
    }
    this.dropNextPass();
  }

  private dropNextPass() {
    if (this.handoverTimer !== null) {
      this.clear(this.handoverTimer);
      this.handoverTimer = null;
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
