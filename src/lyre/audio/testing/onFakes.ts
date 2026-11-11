/**
 * LyreAudio built from its real parts on the engine's fake audio graph
 * (src/player/engine/testing/fakeAudio.ts): the engine, Director, room
 * mixer, RoomStreams with fake frame taps on a fake channel to the capture
 * window, and the PreviewPlayer in an audio context of its own. Tests listen
 * to each room, this page's speakers (which no room may reach, BUG-19) and the preview, and play the capture
 * window's side of the channel (`broadcast`).
 */
import { DEFAULT_LIBRARY_NORMALISE, type DomainTrack, type Room } from "../../../common/domain";
import type { AudioPortLike } from "../../../common/playerAudio";
import { PlaybackEngine } from "../../../player/engine/engine";
import { OutputDeviceChooser, type OutputDeviceInfo } from "../../../player/engine/preview/outputDevices";
import { PreviewPlayer } from "../../../player/engine/preview/previewPlayer";
import { fakePreviewOutput } from "../../../player/engine/preview/testing/fakePreviewOutput";
import { nextSceneIn, type PadSound, type ShowData } from "../../../player/engine/queue/library";
import { PlayerAudioLink, RoomMixer, RoomStreams, type FrameTap, type TapFrame } from "../../../player/engine/rooms";
import { SourceLoader, type MediaRequest } from "../../../player/engine/sources/sourceLoader";
import { FakeAudioContext, FakeBuffer, type FakeGain } from "../../../player/engine/testing/fakeAudio";
import { EngineLyreAudio, type LyreAudioLibrary, type LyrePad } from "../lyreAudio";

/** Library data for tests: the show engine's ShowData, pads with a name. */
export interface AudioTestData extends Omit<ShowData, "pads"> {
  pads?: (PadSound & { boardId: string; padId: string; label: string })[];
}

/** A LyreAudioLibrary over plain data, read on every call (a test may change it while things play). */
export function staticAudioLibrary(data: AudioTestData): LyreAudioLibrary {
  return {
    track: (id) => data.tracks.find((t) => t.id === id),
    playlist: (id) => data.playlists.find((p) => p.id === id),
    tracks: () => data.tracks,
    scene: (ref) =>
      data.campaigns
        .find((c) => c.id === ref.campaignId)
        ?.sessions.find((s) => s.id === ref.sessionId)
        ?.scenes.find((sc) => sc.id === ref.sceneId),
    profileOverrides: () => data.profiles ?? {},
    media: (track) => {
      const known = data.tracks.find((t) => t.id === track.id);
      return known ? { url: known.url, trackId: known.id, sizeBytes: known.sizeBytes } : null;
    },
    pad: (boardId, padId): LyrePad | undefined => data.pads?.find((p) => p.boardId === boardId && p.padId === padId),
    playOrders: () => data.playOrders ?? {},
    normaliseSettings: () => data.normalise ?? DEFAULT_LIBRARY_NORMALISE,
    trackOrders: () => data.trackOrders ?? {},
    repeatOnes: () => data.repeatOnes ?? {},
    crossfade: () => data.crossfade ?? { ms: 3000, curve: "even" },
    nextScene: (ref) => nextSceneIn(data.campaigns, ref),
  };
}

/** A test track of `seconds`, at file:///<id>.ogg. */
export function testTrack(id: string, seconds: number, over: Partial<DomainTrack> = {}): DomainTrack & { url: string } {
  return {
    id,
    kind: "music",
    title: id.toUpperCase(),
    metaTitle: "",
    fileName: `${id}.ogg`,
    durationMs: seconds * 1000,
    role: null,
    loop: null,
    energy: null,
    tags: {},
    url: `file:///${id}.ogg`,
    ...over,
  };
}

/** The player page's end of the channel: records what is sent; `deliver` plays the capture window. */
export class FakeAudioPort implements AudioPortLike {
  posted: Record<string, unknown>[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  postMessage(message: unknown) {
    this.posted.push(message as Record<string, unknown>);
  }
  start() {}
  close() {
    this.closed = true;
  }
  deliver(data: unknown) {
    this.onmessage?.({ data });
  }
}

export function lyreAudioOnFakes(data: AudioTestData, options: { devices?: OutputDeviceInfo[]; startRoomVolume?: number; resumePositions?: Map<string, number> } = {}) {
  const context = new FakeAudioContext();
  const previewContext = new FakeAudioContext();
  for (const track of data.tracks) {
    context.mediaDurations.set(track.url, track.durationMs / 1000);
    previewContext.mediaDurations.set(track.url, track.durationMs / 1000);
  }
  const loader = new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes: async () => null });
  const engine = new PlaybackEngine({ context, scheduler: context.clock, loader });
  const mixer = new RoomMixer(context);
  const link = new PlayerAudioLink();
  const port = new FakeAudioPort();
  const streams = new RoomStreams({
    mixer,
    link,
    // A tap only listens here; the worklet that cuts frames is checked in e2e/rooms.spec.ts.
    createTap: (_onFrame: (frame: TapFrame) => void): FrameTap => {
      const input = context.createGain();
      return { input, dispose: () => input.disconnect() };
    },
  });
  link.connect(port);

  const previewOutput = fakePreviewOutput(previewContext);
  const previewLoader = new SourceLoader({
    context: previewContext,
    createElement: () => previewContext.createMediaElement(),
    fetchBytes: async () => null,
  });
  const preview = new PreviewPlayer({ output: previewOutput, load: (media) => previewLoader.load(media), scheduler: previewContext.clock });
  let deviceList = options.devices ?? [];
  const deviceListeners = new Set<() => void>();
  const sinkIds: string[] = [];
  const saved: { value: unknown } = { value: {} };
  const previewDevices = new OutputDeviceChooser({
    devices: {
      list: async () => deviceList,
      onChange: (listener) => {
        deviceListeners.add(listener);
        return () => deviceListeners.delete(listener);
      },
    },
    store: { load: () => saved.value as never, save: (choices) => (saved.value = choices) },
  });
  void previewDevices.attach("preview", {
    setSinkId: async (deviceId) => {
      sinkIds.push(deviceId);
    },
  });

  // What the browser host joins rooms to so the graph keeps running (a silent gain into the speakers).
  const keepAlive = context.createGain();
  keepAlive.gain.setValueAtTime(0, 0);
  keepAlive.connect(context.destination);
  const wanted: MediaRequest[][] = [];
  /** OUT-10: the room meters open now (an AnalyserNode each in the app). */
  const meters = { open: 0 };
  const audio = new EngineLyreAudio({
    engine,
    mixer,
    streams,
    keepAlive,
    preview,
    previewDevices,
    library: staticAudioLibrary(data),
    readAhead: { want: (requests) => wanted.push([...requests]) },
    random: () => 0,
    // The Test chime: 1.5 s of sound into the room's bus.
    chime: (into) => {
      const source = context.createBufferSource();
      source.buffer = new FakeBuffer(1.5);
      source.connect(into);
      source.start(context.currentTime);
    },
    startRoomVolume: options.startRoomVolume,
    resumePositions: options.resumePositions,
    meter: (output) => {
      meters.open++;
      let open = true;
      return {
        level: () => (open ? context.signalAt(output as FakeGain) : 0),
        dispose: () => {
          if (open) meters.open--;
          open = false;
        },
      };
    },
  });

  return {
    audio,
    /** The library's data, read on every call: a test may change it while things play. */
    data,
    engine,
    context,
    previewContext,
    mixer,
    keepAlive,
    port,
    sinkIds,
    wanted,
    meters,
    /** The capture window says a bot is in a voice channel (true) or the last one left. */
    broadcast(active: boolean) {
      port.deliver({ kind: "broadcast", active });
    },
    /** The bots in voice channels (OutputManager → PLAYER_ROOMS → mixer). */
    setRooms(rooms: Room[]) {
      mixer.setRooms(rooms);
    },
    /** Plug sound devices in or out. */
    setDevices(devices: OutputDeviceInfo[]) {
      deviceList = devices;
      deviceListeners.forEach((listener) => listener());
    },
    /** What a room sends towards Discord now ("table" for the first room). */
    hearRoom(roomId: string) {
      return context.signalAt(mixer.output(roomId) as FakeGain);
    },
    /** What this page's speakers play now: nothing from a room, ever (BUG-19). */
    hearSpeakers() {
      return context.signalAt(context.destination);
    },
    /** What the game master's headphones get from the preview. */
    hearPreview() {
      return previewContext.signalAt(previewContext.destination);
    },
    /** Move both clocks (the page's and the preview's) forward. */
    async advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 0.25) {
        const step = Math.min(0.25, seconds - t);
        await context.advance(step);
        await previewContext.advance(step);
      }
    },
    async flush() {
      await context.flush();
      await previewContext.flush();
    },
  };
}
