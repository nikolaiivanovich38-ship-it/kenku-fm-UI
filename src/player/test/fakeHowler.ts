/**
 * Test double for the `howler` package (WP0 / S3 playback characterisation tests).
 *
 * Use it with `vi.mock("howler", () => import("<relative path>/test/fakeHowler"))`.
 * Every `new Howl(options)` is recorded in `FakeHowl.instances` with its options and
 * every method call, and nothing is played. Real Howler events are asynchronous and
 * driven by the browser; here a test drives them explicitly with `load()`,
 * `startPlaying()`, `end()`, `finishFade()` or `emit()`, so each step is deterministic.
 */

type Listener = { event: string; fn: (...args: unknown[]) => void; once: boolean };

/** Constructor options recorded from the code under test. */
export type FakeHowlOptions = {
  src?: string | string[];
  volume?: number;
  loop?: boolean;
  autoplay?: boolean;
  html5?: boolean;
  mute?: boolean;
  [key: string]: unknown;
};

/** One recorded method call, e.g. `["fade", 0, 1, 1000]`. */
export type FakeHowlCall = [method: string, ...args: unknown[]];

/** Fake `Howl`: records calls and lets tests emit Howler events. */
export class FakeHowl {
  /** Every instance created since the last `FakeHowl.reset()`, oldest first. */
  static instances: FakeHowl[] = [];
  /** Duration in seconds given to new instances. */
  static defaultDuration = 10;
  /** When true, the next instance is created with no internal sound, like a Howl whose source could not be set up. */
  static nextHasNoSound = false;
  /** When true, the next constructor call throws. */
  static nextThrows = false;

  /** Clear recorded instances and restore the defaults. Call in `beforeEach`. */
  static reset() {
    FakeHowl.instances = [];
    FakeHowl.defaultDuration = 10;
    FakeHowl.nextHasNoSound = false;
    FakeHowl.nextThrows = false;
  }

  /** The most recently created instance. */
  static get latest(): FakeHowl {
    return FakeHowl.instances[FakeHowl.instances.length - 1];
  }

  /** Instances that have not been unloaded. */
  static get alive(): FakeHowl[] {
    return FakeHowl.instances.filter((howl) => !howl.unloaded);
  }

  readonly options: FakeHowlOptions;
  readonly calls: FakeHowlCall[] = [];
  /** Mirrors Howler's private `_sounds`; the code under test checks `_sounds[0]`. */
  _sounds: object[];
  unloaded = false;
  isPlaying = false;
  durationSeconds = FakeHowl.defaultDuration;
  /** Arguments of the last `fade()` call. */
  lastFade?: { from: number; to: number; duration: number };
  /** True between a `fade()` call and `finishFade()`. */
  fading = false;
  private currentVolume: number;
  private position = 0;
  private looping: boolean;
  private listeners: Listener[] = [];

  constructor(options: FakeHowlOptions) {
    if (FakeHowl.nextThrows) {
      FakeHowl.nextThrows = false;
      throw new Error("FakeHowl constructor failure");
    }
    this.options = { ...options };
    this.currentVolume = options.volume ?? 1;
    this.looping = options.loop ?? false;
    this._sounds = FakeHowl.nextHasNoSound ? [] : [{}];
    FakeHowl.nextHasNoSound = false;
    FakeHowl.instances.push(this);
  }

  // ---- Howl API used by the app -------------------------------------------

  play() {
    this.calls.push(["play"]);
    this.isPlaying = true;
    return 1;
  }

  pause() {
    this.calls.push(["pause"]);
    this.isPlaying = false;
    return this;
  }

  stop() {
    this.calls.push(["stop"]);
    this.interruptFade();
    this.isPlaying = false;
    this.position = 0;
    return this;
  }

  unload() {
    this.calls.push(["unload"]);
    this.interruptFade();
    this.unloaded = true;
    this.isPlaying = false;
    this._sounds = [];
    return null as null;
  }

  playing() {
    return this.isPlaying;
  }

  duration() {
    return this.durationSeconds;
  }

  mute(muted: boolean) {
    this.calls.push(["mute", muted]);
    return this;
  }

  fade(from: number, to: number, duration: number) {
    this.interruptFade();
    this.fading = true;
    this.calls.push(["fade", from, to, duration]);
    this.currentVolume = from;
    this.lastFade = { from, to, duration };
    return this;
  }

  volume(): number;
  volume(value: number): this;
  volume(value?: number): number | this {
    if (value === undefined) {
      return this.currentVolume;
    }
    this.calls.push(["volume", value]);
    this.interruptFade();
    this.currentVolume = value;
    return this;
  }

  seek(): number;
  seek(to: number): this;
  seek(to?: number): number | this {
    if (to === undefined) {
      return this.position;
    }
    this.calls.push(["seek", to]);
    this.position = to;
    return this;
  }

  loop(): boolean;
  loop(value: boolean): this;
  loop(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.looping;
    }
    this.calls.push(["loop", value]);
    this.looping = value;
    return this;
  }

  on(event: string, fn: (...args: unknown[]) => void) {
    this.listeners.push({ event, fn, once: false });
    return this;
  }

  once(event: string, fn: (...args: unknown[]) => void) {
    this.listeners.push({ event, fn, once: true });
    return this;
  }

  off(event?: string, fn?: (...args: unknown[]) => void) {
    this.listeners = this.listeners.filter(
      (listener) =>
        !(
          (event === undefined || listener.event === event) &&
          (fn === undefined || listener.fn === fn)
        ),
    );
    return this;
  }

  /**
   * Howler ends a running fade, and emits "fade" for it, whenever stop(), unload(),
   * volume(x) or a new fade() is called. Mirrored here so `once("fade")` handlers
   * fire at the same points as in the real library (synchronously, for determinism).
   */
  private interruptFade() {
    if (this.fading) {
      this.fading = false;
      this.emit("fade", 1);
    }
  }

  // ---- Test controls -------------------------------------------------------

  /** Call every listener for `event` synchronously (once-listeners are removed first). */
  emit(event: string, ...args: unknown[]) {
    const matching = this.listeners.filter((listener) => listener.event === event);
    this.listeners = this.listeners.filter(
      (listener) => !(listener.event === event && listener.once),
    );
    for (const listener of matching) {
      listener.fn(...args);
    }
  }

  /** Number of listeners currently registered for `event`. */
  listenerCount(event: string) {
    return this.listeners.filter((listener) => listener.event === event).length;
  }

  /** Simulate the file finishing loading, optionally with a duration in seconds. */
  load(durationSeconds?: number) {
    if (durationSeconds !== undefined) {
      this.durationSeconds = durationSeconds;
    }
    this.emit("load");
  }

  /** Simulate playback starting (Howler's "play" event). */
  startPlaying() {
    this.isPlaying = true;
    this.emit("play", 1);
  }

  /** Simulate the end of the file. A non-looping sound stops playing. */
  end() {
    if (!this.looping) {
      this.isPlaying = false;
    }
    this.emit("end", 1);
  }

  /** Simulate the last `fade()` completing: volume reaches its target and "fade" is emitted. */
  finishFade() {
    this.fading = false;
    if (this.lastFade) {
      this.currentVolume = this.lastFade.to;
    }
    this.emit("fade", 1);
  }

  /** Simulate a running fade reaching `value` without ending it (no call is recorded). */
  setFadeProgress(value: number) {
    this.currentVolume = value;
  }

  /** Arguments of the last recorded call of one method, or undefined. */
  lastCallOf(method: string): unknown[] | undefined {
    const calls = this.callsOf(method);
    return calls[calls.length - 1];
  }

  /** All recorded calls of one method, without the method name. */
  callsOf(method: string): unknown[][] {
    return this.calls.filter(([name]) => name === method).map(([, ...args]) => args);
  }
}

/** Fake `Howler` global; only what the app may touch. */
export const Howler = {
  volume: () => 1,
  unload: (): undefined => undefined,
};

export { FakeHowl as Howl };
