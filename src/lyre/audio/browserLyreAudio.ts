/**
 * Starts LyreAudio in the new interface's page, wired as docs/ARCHITECTURE.md
 * "Host wiring for wave 3" says:
 *
 * - the engine's audio context runs at 48 kHz (the frames are 20 ms of
 *   Discord's Opus only at that rate);
 * - each room's mix reaches its bot only through RoomStreams over the private
 *   channel; this page is never tab-captured (role "lyre-view");
 * - this page's speakers play the first room only while no broadcast runs;
 * - the preview plays in a sink-less audio context of its own and reaches the
 *   game master's chosen device through the capture window, never a room.
 *
 * `startLyreAudio` makes the real browser parts; `assembleLyreAudio` joins
 * them and is what the unit tests check with fakes.
 */
import { DEFAULT_LIBRARY_NORMALISE, type DomainLookup } from "../../common/domain";
import { fromAudioContext, type EngineContext, type GainLike, type NodeLike, type Scheduler } from "../../player/engine/audio/types";
import { createBrowserEngine } from "../../player/engine/browser";
import type { PlaybackEngine } from "../../player/engine/engine";
import {
  browserDeviceSource,
  OutputDeviceChooser,
  storageChoiceStore,
  type ChoiceStore,
  type DeviceSource,
} from "../../player/engine/preview/outputDevices";
import { PreviewPlayer } from "../../player/engine/preview/previewPlayer";
import {
  PlayerAudioLink,
  RoomMixer,
  RoomStreams,
  type BridgedPreviewOutput,
  type FrameTapFactory,
} from "../../player/engine/rooms";
import {
  BRIDGE_SAMPLE_RATE,
  createBrowserBridgedPreview,
  createBrowserFrameTaps,
  listenForPlayerAudioPort,
} from "../../player/engine/rooms/browserBridge";
import type { PlayableSource } from "../../player/engine/sources/layers";
import { MainMediaResolver } from "../../player/engine/sources/mainMediaResolver";
import { browserObjectUrls, ReadAhead } from "../../player/engine/sources/readAhead";
import { readBytes } from "../../player/engine/sources/readBytes";
import { SourceLoader, type MediaRequest } from "../../player/engine/sources/sourceLoader";
import { EngineLyreAudio, type LyreAudioLibrary } from "./lyreAudio";
import type { LyreAudioBridge } from "./preloadAudio";

export interface LyreAudioPieces {
  window: Window;
  /** `window.lyre.audio` (preloadAudio.ts). */
  bridge: LyreAudioBridge;
  library: LyreAudioLibrary;
  /** The engine's audio context (48 kHz), with its speakers. */
  context: EngineContext & { readonly destination: NodeLike };
  engine: PlaybackEngine;
  link: PlayerAudioLink;
  createTap: FrameTapFactory;
  previewOutput: BridgedPreviewOutput;
  /** Makes sources in the preview's own context. */
  previewLoad: (media: MediaRequest) => Promise<PlayableSource>;
  previewScheduler?: Scheduler;
  devices: DeviceSource;
  store: ChoiceStore;
  readAhead?: { want(requests: readonly MediaRequest[]): void };
  /** Closes the engine's audio context. */
  closeContext: () => Promise<void>;
  /** w4-outputs: plays the Outputs screen's Test chime into a room's bus. */
  chime?: (into: GainLike) => void;
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
    speakers: pieces.context.destination,
    preview,
    previewDevices,
    library: pieces.library,
    readAhead: pieces.readAhead,
    chime: pieces.chime,
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
    // The page's speakers, used outside a broadcast only.
    context: Object.assign(fromAudioContext(audioContext), { destination: audioContext.destination as unknown as NodeLike }),
    engine,
    link,
    createTap,
    previewOutput,
    previewLoad: (media) => previewLoader.load(media),
    devices: browserDeviceSource(target.navigator.mediaDevices),
    store: storageChoiceStore(safeStorage(target)),
    readAhead,
    closeContext: async () => {
      readAhead.clear();
      await audioContext.close();
    },
    chime: (into) => playChime(audioContext, into),
  });
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
};
