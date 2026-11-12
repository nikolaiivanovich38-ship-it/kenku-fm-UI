/**
 * Starts LyreAudio in the new interface's page, wired as docs/ARCHITECTURE.md
 * "Host wiring for wave 3" says:
 *
 * - the engine's audio context runs at 48 kHz (the frames are 20 ms of
 *   Discord's Opus only at that rate);
 * - each room's mix reaches its bot only through RoomStreams over the private
 *   channel; this page is never tab-captured (role "lyre-view");
 * - no room ever plays on this page's speakers (BUG-19: the players' sound is
 *   heard only through Discord);
 * - the preview plays in a sink-less audio context of its own and reaches the
 *   game master's chosen device through the capture window, never a room.
 *
 * `startLyreAudio` makes the real browser parts; `assembleLyreAudio` joins
 * them and is what the unit tests check with fakes.
 */
import { DEFAULT_LIBRARY_NORMALISE, type DomainLookup } from "../../common/domain";
import { fromAudioContext, type EngineContext, type GainLike, type NodeLike, type Scheduler } from "../../engine/audio/types";
import { createBrowserEngine } from "../../engine/browser";
import type { PlaybackEngine } from "../../engine/engine";
import {
  OutputDeviceChooser,
  storageChoiceStore,
  type ChoiceStore,
  type DeviceSource,
} from "../../engine/preview/outputDevices";
import { PreviewPlayer } from "../../engine/preview/previewPlayer";
import {
  PlayerAudioLink,
  RoomMixer,
  RoomStreams,
  type BridgedPreviewOutput,
  type FrameTapFactory,
} from "../../engine/rooms";
import {
  BRIDGE_SAMPLE_RATE,
  createBrowserBridgedPreview,
  createBrowserFrameTaps,
  listenForPlayerAudioPort,
} from "../../engine/rooms/browserBridge";
import type { PlayableSource } from "../../engine/sources/layers";
import { MainMediaResolver } from "../../engine/sources/mainMediaResolver";
import { browserObjectUrls, ReadAhead } from "../../engine/sources/readAhead";
import { readBytes } from "../../engine/sources/readBytes";
import { SourceLoader, type MediaRequest } from "../../engine/sources/sourceLoader";
import { storedResumePositions } from "../../engine/queue/resumePositions";
import { outputDeviceSource } from "./deviceSource";
import { EngineLyreAudio, type LyreAudioLibrary, type RoomMeter } from "./lyreAudio";
import type { LyreAudioBridge } from "./preloadAudio";

export interface LyreAudioPieces {
  window: Window;
  /** `window.lyre.audio` (preloadAudio.ts). */
  bridge: LyreAudioBridge;
  library: LyreAudioLibrary;
  /** The engine's audio context (48 kHz). */
  context: EngineContext;
  /** BUG-19: a gain of 0 into the context's speakers, so the rooms' graph runs with no bot in a voice channel. */
  keepAlive?: NodeLike;
  engine: PlaybackEngine;
  link: PlayerAudioLink;
  createTap: FrameTapFactory;
  previewOutput: BridgedPreviewOutput;
  /** Makes sources in the preview's own context. */
  previewLoad: (media: MediaRequest) => Promise<PlayableSource>;
  previewScheduler?: Scheduler;
  devices: DeviceSource;
  store: ChoiceStore;
  /** PLY-4: where Pick up tracks stopped, kept on this computer across restarts. */
  resumePositions?: Map<string, number>;
  readAhead?: { want(requests: readonly MediaRequest[]): void };
  /** Closes the engine's audio context. */
  closeContext: () => Promise<void>;
  /** w4-outputs: plays the Outputs screen's Test chime into a room's bus. */
  chime?: (into: GainLike) => void;
  /** OUT-10: a level meter on a room's mix. */
  meter?: (output: GainLike) => RoomMeter;
}

/** Joins the parts. Everything it starts, `dispose()` stops. */
export function assembleLyreAudio(pieces: LyreAudioPieces): EngineLyreAudio {
  const { bridge, link, previewOutput } = pieces;
  const mixer = new RoomMixer(pieces.context);
  const streams = new RoomStreams({ mixer, link, createTap: pieces.createTap });
  const preview = new PreviewPlayer({ output: previewOutput, load: pieces.previewLoad, scheduler: pieces.previewScheduler });
  const previewDevices = new OutputDeviceChooser({ devices: pieces.devices, store: pieces.store });
  // The capture window plays the preview; it needs the device each time a
  // channel to it starts (the first time, and after either page reloads).
  const onReset = (): void => {
    void previewDevices.attach("preview", previewOutput).catch((): undefined => undefined);
  };
  link.on("reset", onReset);
  const stopRooms = bridge.onRooms((rooms) => mixer.setRooms(rooms));

  const audio = new EngineLyreAudio({
    engine: pieces.engine,
    mixer,
    streams,
    keepAlive: pieces.keepAlive,
    preview,
    previewDevices,
    library: pieces.library,
    readAhead: pieces.readAhead,
    chime: pieces.chime,
    meter: pieces.meter,
    setPreviewEar: previewOutput.setEar ? (ear) => previewOutput.setEar?.(ear) : undefined,
    resumePositions: pieces.resumePositions,
    // Rooms start at full level: a room's volume is its bot's (Outputs), so the page does not lower it twice.
    onDispose: async () => {
      stopPort();
      stopRooms();
      link.off("reset", onReset);
      streams.dispose();
      pieces.engine.dispose();
      mixer.dispose();
      link.close();
      await Promise.allSettled([previewOutput.close(), pieces.closeContext()]);
    },
  });
  // Last, so every listener is in place when the first end arrives.
  const stopPort = listenForPlayerAudioPort(pieces.window, link, () => bridge.connect());
  return audio;
}

/**
 * LyreAudio with the real browser parts. Call once in the page root and
 * `dispose()` when the page goes; `library` is the screens' data layer.
 */
export async function startLyreAudio(options: { window: Window; bridge: LyreAudioBridge; library: LyreAudioLibrary }): Promise<EngineLyreAudio> {
  const { window: target, bridge } = options;
  const audioContext = new AudioContext({ latencyHint: "playback", sampleRate: BRIDGE_SAMPLE_RATE });
  const readAhead = new ReadAhead({
    inner: new MainMediaResolver(bridge.media),
    fetchBytes: (url, limit) => readBytes(url, limit),
    makeObjectUrl: browserObjectUrls.make,
    revokeObjectUrl: browserObjectUrls.revoke,
  });
  // Library files arrive as lyre-media: addresses (security review 6), another origin than the page's own.
  const { engine } = createBrowserEngine({ audioContext, resolver: readAhead, crossOrigin: "anonymous" });
  const link = new PlayerAudioLink();
  const createTap = await createBrowserFrameTaps(audioContext);
  const previewOutput = await createBrowserBridgedPreview(link);
  const previewLoader = new SourceLoader({
    context: previewOutput.context,
    createElement: () => {
      const element = target.document.createElement("audio");
      element.controls = false;
      element.crossOrigin = "anonymous";
      return element;
    },
    fetchBytes: (url, limit) => readBytes(url, limit),
    resolver: readAhead,
  });
  return assembleLyreAudio({
    window: target,
    bridge,
    library: options.library,
    context: fromAudioContext(audioContext),
    keepAlive: silentSink(audioContext),
    engine,
    link,
    createTap,
    previewOutput,
    previewLoad: (media) => previewLoader.load(media),
    // Test builds add the prototype's stand-in devices (standInDevices.ts); a release build lists real ones only.
    devices: outputDeviceSource(target.navigator.mediaDevices),
    store: storageChoiceStore(safeStorage(target)),
    resumePositions: storedResumePositions(safeStorage(target)),
    readAhead,
    closeContext: async () => {
      readAhead.clear();
      await audioContext.close();
    },
    chime: (into) => playChime(audioContext, into),
    meter: (output) => analyserMeter(audioContext, output),
  });
}

/**
 * OUT-10: a room's level meter, an AnalyserNode beside the room's mix (it only listens: nothing it hears goes on).
 * The level is the peak of the last 1,024 samples (about 21 ms at 48 kHz).
 */
export function analyserMeter(context: BaseAudioContext, output: GainLike): RoomMeter {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const samples = new Float32Array(analyser.fftSize);
  (output as unknown as AudioNode).connect(analyser);
  return {
    level: () => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      return peak;
    },
    dispose: () => {
      try {
        (output as unknown as AudioNode).disconnect(analyser);
      } catch {
        // The room's mix has gone already.
      }
    },
  };
}

/**
 * w4-outputs: the Test chime, a soft bell (A5 with two overtones) that rings out over about 1.5 seconds. Made on the
 * spot, so no sound file ships for it; every node is let go when it ends.
 */
export function playChime(context: BaseAudioContext, into: GainLike): void {
  const now = context.currentTime;
  const ring = context.createGain();
  ring.gain.setValueAtTime(0.0001, now);
  ring.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
  ring.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
  ring.connect(into as unknown as AudioNode);
  const partials: [number, number][] = [
    [880, 1],
    [1760, 0.35],
    [2640, 0.15],
  ];
  partials.forEach(([frequency, level], i) => {
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = frequency;
    gain.gain.value = level;
    tone.connect(gain).connect(ring);
    tone.start(now);
    tone.stop(now + 1.6);
    if (i === 0) tone.onended = () => ring.disconnect();
  });
}

/** A gain of 0 into the speakers: rooms joined to it keep running and are never heard (BUG-19). */
function silentSink(context: AudioContext): NodeLike {
  const silent = context.createGain();
  silent.gain.value = 0;
  silent.connect(context.destination);
  return silent as unknown as NodeLike;
}

/** localStorage, or a stand-in that remembers nothing when the page may not use it. */
function safeStorage(target: Window): Pick<Storage, "getItem" | "setItem"> {
  try {
    return target.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

/** For the screens' data layer: an empty library to start with, before anything has loaded. */
export const EMPTY_LIBRARY: LyreAudioLibrary = {
  track: () => undefined,
  playlist: () => undefined,
  tracks: () => [] as ReturnType<DomainLookup["tracks"]>,
  scene: () => undefined,
  profileOverrides: () => ({}),
  media: () => null,
  pad: () => undefined,
  playOrders: () => ({}),
  normaliseSettings: () => DEFAULT_LIBRARY_NORMALISE,
  trackOrders: () => ({}),
  repeatOnes: () => ({}),
};
