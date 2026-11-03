import { Howl } from "howler";
import { TypedEmitter } from "tiny-typed-emitter";

export interface SoundEvents {
  error: () => void;
  load: (duration: number) => void;
  end: () => void;
}

type SoundOptions = {
  src: string;
  volume: number;
  loop: boolean;
  /** Fade-in length in ms when the sound starts (and on each cross-faded loop). 0 = none. */
  fadeIn: number;
  /** Fade-out length in ms before the end, on stop, and the cross-fade length for loops. 0 = none. */
  fadeOut: number;
};

/** Extra time after a stop fade-out before the sound is unloaded regardless. */
const STOP_FADE_GRACE_MS = 1000;

/**
 * One soundboard sound, wrapping Howler with fades and loops.
 *
 * - `fadeIn > 0`: every start fades from silence to the sound's volume (BUG-3).
 * - `fadeOut > 0`: the sound fades out `fadeOut` ms before its end. When looping,
 *   a new Howl is started at that point and the two cross-fade. This needs HTML5
 *   audio, so separate Howl instances can overlap.
 * - `fadeOut = 0`: Web Audio is used and Howler loops natively, so loops are gapless;
 *   `fadeIn` then applies only to the first start.
 *
 * At most two Howl instances exist per sound: the current one and, during a
 * loop cross-fade, the outgoing one, which is unloaded when its fade ends (BUG-4).
 */
export class Sound extends TypedEmitter<SoundEvents> {
  options: SoundOptions;
  /** Timer for the next fade-out / loop cross-fade point. */
  _timeout?: ReturnType<typeof setTimeout>;
  /** Howl playing the current loop iteration. Undefined only if Howler failed to start. */
  _howl?: Howl;
  /** Howl fading out during a loop cross-fade; unloaded when its fade ends. */
  _outgoing?: Howl;
  /** Set once stop() has been called, so late Howler events do not restart anything. */
  private stopped = false;

  constructor(options: SoundOptions) {
    super();
    this.options = options;
    try {
      this._howl = this.createHowl();
    } catch {
      this.reportErrorLater();
    }
  }

  async stop(fadeOut: boolean): Promise<void> {
    this.stopped = true;
    this.clearFadeOutTimer();
    const howl = this._howl;
    // Howler never emits "fade" for a fade from 0 to 0, so a silent sound is unloaded at once.
    if (
      !fadeOut ||
      this.options.fadeOut <= 0 ||
      !howl?.playing() ||
      howl.volume() <= 0
    ) {
      this.unloadAll();
      return;
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(safetyTimer);
        this.unloadAll();
        resolve();
      };
      // An HTML5 Howl reports playing() while play() is still pending. If that
      // play then fails, Howler never runs the queued fade and never emits
      // "fade", so stop anyway shortly after the fade should have ended.
      const safetyTimer = setTimeout(
        finish,
        this.options.fadeOut + STOP_FADE_GRACE_MS,
      );
      howl.fade(howl.volume(), 0, this.options.fadeOut);
      // Listen after calling fade(): Howler emits "fade" for a fade-in that the
      // call above interrupts, and that must not end the stop early.
      howl.once("fade", finish);
    });
  }

  playing() {
    return this._howl?.playing() ?? false;
  }

  progress() {
    return this._howl?.seek() ?? 0;
  }

  /** Jump to `to` seconds and move the pending fade-out to match (BUG-5). */
  seek(to: number) {
    const howl = this._howl;
    if (!howl) {
      return;
    }
    howl.seek(to);
    if (this._timeout !== undefined) {
      this.scheduleFadeOut(howl, to);
    }
  }

  volume(volume: number) {
    this.options.volume = volume;
    this._howl?.volume(volume);
  }

  loop(loop: boolean) {
    this.options.loop = loop;
    // Howler only loops by itself when Kenku does not cross-fade the loop.
    if (this.options.fadeOut <= 0) {
      this._howl?.loop(loop);
    }
  }

  /** Create and autoplay a Howl for one play-through (or a whole native loop). */
  private createHowl(): Howl {
    const { fadeIn, fadeOut, loop, volume, src } = this.options;
    const crossFadeLoops = fadeOut > 0;
    const howl = new Howl({
      src,
      volume: fadeIn > 0 ? 0 : volume,
      loop: crossFadeLoops ? false : loop,
      autoplay: true,
      // HTML5 audio lets two instances overlap for the cross-fade. Without a
      // fade-out, Web Audio is used, which loops without a gap.
      html5: crossFadeLoops,
    });

    // "once": a Web Audio loop emits "play" again on every loop.
    howl.once("play", () => {
      if (this.stopped || howl !== this._howl) {
        return;
      }
      if (this.options.fadeIn > 0) {
        howl.fade(0, this.options.volume, this.options.fadeIn);
      }
      this.scheduleFadeOut(howl, howl.seek());
    });
    howl.on("load", () => {
      this.emit("load", howl.duration());
    });
    howl.on("end", () => {
      // The outgoing half of a cross-fade also ends; only the current Howl counts.
      if (howl === this._howl && !this.options.loop) {
        this.emit("end");
      }
    });
    howl.on("loaderror", () => this.emitError());
    howl.on("playerror", () => this.emitError());

    const internals = howl as unknown as { _sounds: unknown[] };
    if (!internals._sounds[0]) {
      this.reportErrorLater();
    }
    return howl;
  }

  /** Arm the fade-out timer so it fires `fadeOut` ms before the end, given the position in seconds. */
  private scheduleFadeOut(howl: Howl, positionSeconds: number) {
    this.clearFadeOutTimer();
    if (this.options.fadeOut <= 0) {
      return;
    }
    const remainingMs =
      Math.floor((howl.duration() - positionSeconds) * 1000) -
      this.options.fadeOut;
    this._timeout = setTimeout(
      () => this.handleFadeOutPoint(howl),
      Math.max(0, remainingMs),
    );
  }

  /** Fade out the current Howl; when looping, start the next iteration so the two cross-fade. */
  private handleFadeOutPoint(howl: Howl) {
    this._timeout = undefined;
    howl.fade(howl.volume(), 0, this.options.fadeOut);
    if (!this.options.loop) {
      return;
    }
    // Never keep more than one outgoing Howl, even if its fade event was lost.
    this.releaseOutgoing(this._outgoing);
    this._outgoing = howl;
    // Listen after calling fade(), as in stop().
    howl.once("fade", () => this.releaseOutgoing(howl));
    try {
      this._howl = this.createHowl();
    } catch {
      this.reportErrorLater();
    }
  }

  /** Unload the outgoing Howl if `howl` is still it. */
  private releaseOutgoing(howl: Howl | undefined) {
    if (!howl || howl !== this._outgoing) {
      return;
    }
    this._outgoing = undefined;
    howl.unload();
  }

  private unloadAll() {
    this.clearFadeOutTimer();
    this.releaseOutgoing(this._outgoing);
    const current = this._howl;
    this._howl = undefined;
    current?.unload();
  }

  private clearFadeOutTimer() {
    clearTimeout(this._timeout);
    this._timeout = undefined;
  }

  /**
   * Report an error after the caller has had a chance to attach listeners.
   * Emitting inside the constructor was lost, and an "error" event without a
   * listener makes EventEmitter throw.
   */
  private reportErrorLater() {
    queueMicrotask(() => this.emitError());
  }

  private emitError() {
    if (this.listenerCount("error") > 0) {
      this.emit("error");
    }
  }
}
