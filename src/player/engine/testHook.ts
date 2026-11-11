/**
 * Test builds only: lets the end-to-end test (e2e/engine.spec.ts) drive the
 * new engine inside the packaged player page without any interface for it.
 * `src/player/renderer.ts` installs it only when __CUE_DESK_TEST_BUILD__ is
 * true; release builds leave this module out entirely.
 *
 * Analysers listen to the music bus, the table mix, the whisper mix and the
 * preview output. They feed the context's speakers through a silent gain only
 * so the browser keeps processing them; nothing here is audible or broadcast.
 *
 * Wave 2 (PLY-8): `loadShow`, `run` and `rooms` drive the show engine
 * (queue/director.ts) with a library given as plain data, and report what
 * each room plays. Rooms come from `options.rooms` when the host wires the
 * Rooms stream's implementation; otherwise there is one room, the table,
 * playing into the engine's own buses.
 */
import { createBrowserEngine, BrowserEngine } from "./browser";
import type { PlaybackEngine } from "./engine";
import type { BusId, OutputId } from "./graph/mixer";
import type { CueAction, CueOutcome } from "./queue/actions";
import { Director } from "./queue/director";
import { ShowData, staticLibrary } from "./queue/library";
import type { RoomReport } from "./queue/roomPlayer";
import { RoomsAudio, tableOnlyRooms } from "./rooms.contract";
import type { VoiceOptions, VoiceState } from "./voice/voice";

type Probe = "musicBus" | OutputId;

export interface EngineTestApi {
  start(): Promise<string>;
  play(
    url: string,
    bus: BusId,
    options?: VoiceOptions & { preferBuffer?: boolean },
  ): Promise<{ state: VoiceState; error?: string; duration: number; sourceKind: string | null }>;
  /** Loudest RMS level seen on each probe over `ms` milliseconds. */
  listen(ms: number): Promise<Record<Probe, number>>;
  stopAll(): void;
  /** Start the show engine on the started engine with this library (track `url`s are the files to play). */
  loadShow(data: ShowData): void;
  /** Run a cue action, as a button, hotkey or the remote API would. */
  run(action: CueAction): CueOutcome;
  /** What each room plays now, in the rooms' order. */
  rooms(): RoomReport[];
  /** Messages the show engine would show as toasts, oldest first. */
  errors(): string[];
  close(): Promise<void>;
}

export interface EngineTestHookOptions {
  /** The rooms the show plays in; default: one room, the table. */
  rooms?: (engine: PlaybackEngine) => RoomsAudio;
}

declare global {
  interface Window {
    __cueDeskEngineTest?: EngineTestApi;
  }
}

export function installEngineTestHook(target: Window, options: EngineTestHookOptions = {}): void {
  let current: (BrowserEngine & { probes: Record<Probe, AnalyserNode> }) | null = null;
  let show: { director: Director; errors: string[] } | null = null;

  const api: EngineTestApi = {
    async start() {
      await api.close();
      const browserEngine = createBrowserEngine();
      const { audioContext, engine } = browserEngine;
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      silent.connect(audioContext.destination);
      const probe = (node: unknown) => {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        (node as AudioNode).connect(analyser);
        analyser.connect(silent);
        return analyser;
      };
      current = {
        ...browserEngine,
        probes: {
          musicBus: probe(engine.mixer.input("music")),
          table: probe(engine.outputs.table),
          whisper: probe(engine.outputs.whisper),
          preview: probe(engine.outputs.preview),
        },
      };
      await audioContext.resume();
      return audioContext.state;
    },

    play(url, bus, options = {}) {
      const engine = requireEngine().engine;
      const { preferBuffer, ...voiceOptions } = options;
      const voice = engine.play({ bus, media: { url, preferBuffer }, ...voiceOptions });
      return new Promise((resolve) => {
        const settle = () => {
          if (voice.state !== "loading") {
            resolve({
              state: voice.state,
              error: voice.errorMessage ?? undefined,
              duration: voice.duration,
              sourceKind: voice.sourceKind,
            });
          }
        };
        voice.on("state", settle);
        settle();
      });
    },

    async listen(ms) {
      const { probes } = requireEngine();
      const loudest: Record<Probe, number> = { musicBus: 0, table: 0, whisper: 0, preview: 0 };
      const samples = new Float32Array(2048);
      const deadline = performance.now() + ms;
      while (performance.now() < deadline) {
        for (const [name, analyser] of Object.entries(probes) as [Probe, AnalyserNode][]) {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            sum += sample * sample;
          }
          loudest[name] = Math.max(loudest[name], Math.sqrt(sum / samples.length));
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return loudest;
    },

    stopAll() {
      requireEngine().engine.stopAll();
    },

    loadShow(data) {
      const { engine } = requireEngine();
      show?.director.dispose();
      const director = new Director({ engine, rooms: (options.rooms ?? ((e) => tableOnlyRooms(e.mixer)))(engine), library: staticLibrary(data) });
      const errors: string[] = [];
      director.on("error", (message) => errors.push(message));
      show = { director, errors };
    },

    run(action) {
      return requireShow().director.run(action);
    },

    rooms() {
      return requireShow().director.report();
    },

    errors() {
      return [...requireShow().errors];
    },

    async close() {
      show?.director.dispose();
      show = null;
      const engine = current;
      current = null;
      await engine?.close();
    },
  };

  function requireShow() {
    if (!show) {
      throw new Error("Call loadShow() first");
    }
    return show;
  }

  function requireEngine() {
    if (!current) {
      throw new Error("Call start() first");
    }
    return current;
  }

  target.__cueDeskEngineTest = api;
}
