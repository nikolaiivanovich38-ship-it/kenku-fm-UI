/**
 * PLY-10: the playback engine the new interface (WP5) uses. It owns the mixer
 * (buses, master, outputs) and every voice, and reports what happens as
 * events. It does not poll: voices report their own state changes, and the
 * optional progress ticker runs only while something plays and someone listens
 * (PERF-1).
 *
 * The engine never connects its outputs anywhere; see docs/playback-engine.md
 * for how the host wires the table, whisper and preview outputs.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import { browserScheduler, EngineContext, GainLike, Scheduler } from "./audio/types";
import { BusId, Mixer, OutputId } from "./graph/mixer";
import { PlayableSource } from "./sources/layers";
import { Voice, VoiceOptions, VoiceState } from "./voice/voice";

export interface PlayRequest extends VoiceOptions {
  bus: BusId;
  /** What to play: a source, or one that is still loading. */
  media: PlayableSource | Promise<PlayableSource>;
  /** Optional id, e.g. to match a voice to a queue entry or a pad. */
  id?: string;
}

export interface VoiceProgress {
  id: string;
  bus: BusId;
  state: VoiceState;
  position: number;
  duration: number;
}

interface EngineEvents {
  /** A voice changed state (playing, paused, stopping, stopped, ended, failed). */
  voice: (voice: Voice, state: VoiceState) => void;
  /** A voice could not play. Named "voice-error" because an unheard "error" event would throw. */
  "voice-error": (voice: Voice, message: string) => void;
}

/** How often the progress ticker reports while something plays. */
const PROGRESS_INTERVAL_MS = 1000;

export class PlaybackEngine extends TypedEmitter<EngineEvents> {
  readonly mixer: Mixer;
  private readonly context: EngineContext;
  private readonly scheduler: Scheduler;
  private readonly live: Voice[] = [];
  private readonly progressListeners = new Set<(report: VoiceProgress[]) => void>();
  private progressTimer: unknown = null;

  constructor({ context, scheduler = browserScheduler }: { context: EngineContext; scheduler?: Scheduler }) {
    super();
    this.context = context;
    this.scheduler = scheduler;
    this.mixer = new Mixer(context);
  }

  /** The table, whisper and preview outputs, for the host to connect. */
  get outputs(): Readonly<Record<OutputId, GainLike>> {
    return this.mixer.outputs;
  }

  play(request: PlayRequest): Voice {
    const { bus, media, id, ...options } = request;
    const voice = new Voice(
      { context: this.context, scheduler: this.scheduler, destination: this.mixer.input(bus) },
      Promise.resolve(media),
      options,
      { id, bus },
    );
    this.live.push(voice);
    voice.on("state", (state) => {
      if (voice.isFinal()) {
        this.live.splice(this.live.indexOf(voice), 1);
      }
      this.emit("voice", voice, state);
      this.updateTicker();
    });
    voice.on("error", (message) => this.emit("voice-error", voice, message));
    return voice;
  }

  /** Voices not yet stopped, ended or failed, oldest first; only those on `bus` if given. */
  voices(bus?: BusId): Voice[] {
    return this.live.filter((voice) => bus === undefined || voice.bus === bus);
  }

  /**
   * Fade every voice out over `seconds`, then release them. Faders stay where
   * they are, so whatever plays next is heard at once. Used by Panic (SHW-2).
   */
  fadeAll(seconds: number, { except = [] }: { except?: readonly BusId[] } = {}): Promise<void> {
    return Promise.all(
      this.voices()
        .filter((voice) => !except.includes(voice.bus!))
        .map((voice) => voice.stop(seconds)),
    ).then((): void => undefined);
  }

  /** Stop every voice at once, including any that are fading or still loading. */
  stopAll({ except = [] }: { except?: readonly BusId[] } = {}): void {
    for (const voice of this.voices().filter((v) => !except.includes(v.bus!))) {
      void voice.stop(0);
    }
  }

  /**
   * Hear about positions once a second while anything plays. The timer runs
   * only while there is a listener and a playing voice. Returns an unsubscribe.
   */
  onProgress(listener: (report: VoiceProgress[]) => void): () => void {
    this.progressListeners.add(listener);
    this.updateTicker();
    return () => {
      this.progressListeners.delete(listener);
      this.updateTicker();
    };
  }

  progress(): VoiceProgress[] {
    return this.live.map((voice) => ({
      id: voice.id,
      bus: voice.bus!,
      state: voice.state,
      position: voice.position(),
      duration: voice.duration,
    }));
  }

  dispose(): void {
    this.stopAll();
    this.progressListeners.clear();
    this.updateTicker();
    this.mixer.dispose();
    this.removeAllListeners();
  }

  private updateTicker() {
    const wanted = this.progressListeners.size > 0 && this.live.some((voice) => voice.state === "playing");
    if (wanted && this.progressTimer === null) {
      this.scheduleTick();
    } else if (!wanted && this.progressTimer !== null) {
      this.scheduler.clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private scheduleTick() {
    this.progressTimer = this.scheduler.setTimeout(() => {
      this.progressTimer = null;
      const report = this.progress();
      for (const listener of [...this.progressListeners]) {
        listener(report);
      }
      this.updateTicker();
    }, PROGRESS_INTERVAL_MS);
  }
}
