/**
 * The parts of Web Audio and of <audio> the engine uses, as small structural
 * types. A real AudioContext fits them (see `fromAudioContext`); tests use the
 * fake in ../testing/fakeAudio.ts, which records nodes and connections so leaks
 * and routing can be checked without a browser.
 */

export interface ParamLike {
  /** The current value. In Chromium this reads the value of the last rendered block. */
  readonly value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface NodeLike {
  connect(destination: NodeLike): unknown;
  /** Without an argument, removes every outgoing connection. */
  disconnect(destination?: NodeLike): void;
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

export interface BufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
}

export interface BufferSourceLike extends NodeLike {
  buffer: BufferLike | null;
  loop: boolean;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

/** The subset of HTMLMediaElement used to stream long files. */
export interface MediaElementLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface EngineContext {
  readonly currentTime: number;
  createGain(): GainLike;
  createBufferSource(): BufferSourceLike;
  createMediaElementSource(element: MediaElementLike): NodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>;
}

/** Timers, injected so tests can run a 4-hour session in milliseconds. */
export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserScheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Use a real Web Audio context as the engine's context. */
export function fromAudioContext(context: BaseAudioContext & { createMediaElementSource?: AudioContext["createMediaElementSource"] }): EngineContext {
  return {
    get currentTime() {
      return context.currentTime;
    },
    createGain: () => context.createGain() as unknown as GainLike,
    createBufferSource: () => context.createBufferSource() as unknown as BufferSourceLike,
    createMediaElementSource: (element) => {
      if (!context.createMediaElementSource) {
        throw new Error("This audio context cannot stream media elements");
      }
      return context.createMediaElementSource(element as unknown as HTMLMediaElement) as unknown as NodeLike;
    },
    decodeAudioData: (data) => context.decodeAudioData(data),
  };
}

/**
 * Move a gain smoothly from where it is now to `target` over `seconds`
 * (at once when `seconds` is 0). Reading `value` first and pinning it keeps a
 * fade that interrupts another fade from jumping.
 */
export function rampTo(param: ParamLike, target: number, now: number, seconds: number): void {
  const held = param.value;
  param.cancelScheduledValues(now);
  if (seconds > 0) {
    param.setValueAtTime(held, now);
    param.linearRampToValueAtTime(target, now + seconds);
  } else {
    param.setValueAtTime(target, now);
  }
}
