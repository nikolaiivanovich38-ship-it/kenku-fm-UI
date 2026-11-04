// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PCMStream from "./PCMStream.worklet";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PlayerFrameInlet from "./PlayerFrameInlet.worklet";
import {
  isPlayerAudioMessage,
  type AudioPortLike,
  type CaptureAudioMessage,
  type PlayerAudioMessage,
} from "../../common/playerAudio";
import {
  DEFAULT_CAPTURE_ROUTE,
  MAX_ROOM_ID_LENGTH,
  isCaptureRoute,
  type CaptureRoute,
} from "../../common/outputs";

/** Sample rate of the audio context and of the Opus stream Discord expects. */
export const SAMPLE_RATE = 48000;
/** Discord voice is stereo. */
export const NUM_CHANNELS = 2;
/** Opus frame length: Discord plays one 20 ms packet per step. */
export const FRAME_DURATION_MS = 20;
/** Samples per channel in one frame. */
export const FRAME_LENGTH = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
/** Music-quality Opus; Discord passes packets on without re-encoding them. */
export const OPUS_BITRATE = 128_000;

export type StreamingMode = "lowLatency" | "performance";

/** AudioContext.setSinkId (Chromium 110+); not yet in TypeScript's DOM types. */
type SinkableContext = AudioContext & { setSinkId?: (deviceId: string) => Promise<void> };

/**
 * Receives each encoded Opus packet (one 20 ms frame) and the room (bot id)
 * whose mix it is; no room while the main process has named none.
 */
export type PacketSink = (packet: Uint8Array, room?: string) => void;

/**
 * OUT-5: one room's mix: every source sent to the room connects to `input`;
 * `volume` is the room's volume; the worklet cuts it into frames for the
 * room's own Opus encoder, so each bot gets its own stream.
 */
export interface RoomMix {
  /** The room's bot id, or "" for the single mix used while no rooms are named. */
  id: string;
  input: GainNode;
  volume: GainNode;
  pcmNode: AudioWorkletNode;
  encoder: AudioEncoder;
}

/** Key of the one mix used before the main process names any room. */
const UNNAMED_ROOM = "";

/** OUT-5: a room's inlet is freed after this long without frames from the player page. */
export const PLAYER_INLET_IDLE_MS = 5_000;
/** PRV-1: the preview's audio context is closed after this long without frames. */
export const PREVIEW_IDLE_MS = 10_000;
/** PRV-2: what the player page is told when a device cannot be used. */
export const PREVIEW_DEVICE_REFUSED =
  "That sound device is not available. The preview stays on the device it was on.";

/** An engine room's frames from the player page, played into the room's mix. */
interface PlayerInlet {
  node: AudioWorkletNode;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * PRV-1: the preview, played on the game master's device by an audio context
 * of its own. It is a different context from the broadcast's, so no preview
 * node can ever be connected to a room's mix, and this window is never
 * recorded.
 */
interface PreviewPlayback {
  context: AudioContext;
  ready: Promise<AudioWorkletNode | undefined>;
  timer?: ReturnType<typeof setTimeout>;
}

/** One frame from the PCM worklet (see PCMStream.worklet.js). */
type WorkletFrame = { index: number; samples: Float32Array<ArrayBuffer>; last?: boolean };

/**
 * WebCodecs Opus settings (PERF-4: Opus is encoded here, in the capture
 * window, instead of on the main process). PERF-8: both streaming modes send
 * each frame at once; "performance" only asks the encoder for less work.
 * (It used to hold back half a second of audio, adding that much delay.)
 */
export function opusEncoderConfig(mode: StreamingMode): AudioEncoderConfig {
  return {
    codec: "opus",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: NUM_CHANNELS,
    bitrate: OPUS_BITRATE,
    opus: {
      frameDuration: FRAME_DURATION_MS * 1000,
      // Lower complexity costs a little quality and less processor time.
      complexity: mode === "performance" ? 5 : 9,
    },
  };
}

/**
 * Captures audio from browser views and external audio devices, mixes it and
 * encodes it to Opus for Discord. Runs in the hidden capture window; for the
 * main-process counterpart see `AudioCaptureManagerMain.ts`.
 *
 * PERF-4: nothing runs until the main process starts a broadcast (an output
 * joined a voice channel). The audio context is created then and closed when
 * the broadcast stops; while no source is connected it is suspended, so the
 * audio thread is idle. The main process asks for a view's audio only while
 * that view plays sound.
 *
 * OUT-5: one mix, worklet and encoder per room (every bot in a voice channel),
 * so each bot hears its own room. Each source (a tab, an input device) goes
 * to the rooms its route names: every room, the first room (the table) or
 * one room. "This Computer" plays the first room.
 */
export class AudioCaptureManagerPreload {
  /** Audio context to mix media streams into one audio output */
  _audioContext?: AudioContext;
  /** OUT-5: one mix per room, first room first (built once the worklet has loaded). */
  _mixes = new Map<string, RoomMix>();
  /** Feeds "This Computer": the first room's mix. */
  _loopbackNode?: GainNode;
  _streamingMode: StreamingMode = "performance";
  /** Set while broadcasting; resolves true once sources can be connected. */
  _ready?: Promise<boolean>;
  /** The frame worklet has loaded in the current audio context. */
  _graphReady = false;

  /** OUT-5: the rooms (bot ids) the main process named, first room first. */
  _rooms: string[] = [];
  /** OUT-5: room volumes that are not 1, kept across broadcasts. */
  _roomVolumes = new Map<string, number>();
  /** OUT-5: where each view's audio goes, when not `_defaultRoute`. */
  _routes = new Map<number, CaptureRoute>();
  /** OUT-5: where views without a route, and input devices, go. */
  _defaultRoute: CaptureRoute = DEFAULT_CAPTURE_ROUTE;

  /** OUT-5, PRV-1: the private channel to the player page (engine rooms and preview). */
  _playerPort?: AudioPortLike;
  /** Engine rooms' frames, one inlet per room that is sending. */
  _playerInlets = new Map<string, PlayerInlet>();
  _preview?: PreviewPlayback;
  /** PRV-2: the preview's device ("" is the default), kept while its context comes and goes. */
  _previewSinkId = "";

  /** Audio DOM element for the current output / local playback */
  _audioOutputElement?: HTMLAudioElement;
  /** Whether the mix plays on this computer ("This Computer" output). */
  _loopback = true;

  /** Raw media streams for each browser view containing webp/opus audio */
  _mediaStreams: Record<number, MediaStream> = {};
  _mediaStreamSources: Record<number, MediaStreamAudioSourceNode> = {};
  _mediaStreamOutputs: Record<number, GainNode> = {};
  /** Views the user muted; applied whenever their capture (re)starts. */
  _mutedViews = new Set<number>();
  /**
   * Latest start request for each captured view, removed when the view's
   * capture stops. A capture that finishes starting after a stop or a newer
   * start is dropped, so a tab stopped mid-start does not keep streaming.
   */
  _browserViewRequests: Record<number, number> = {};
  _nextBrowserViewRequest = 1;

  /** Input devices the user switched on; captured only while broadcasting. */
  _externalDevices = new Set<string>();
  /** Raw media stream for each external audio source e.g. microphone or virtual audio cables */
  _externalAudioStreams: Record<string, MediaStream> = {};
  _externalAudioStreamSources: Record<string, MediaStreamAudioSourceNode> = {};
  _externalAudioStreamOutputs: Record<string, GainNode> = {};

  constructor(private readonly sendPacket: PacketSink) {}

  /**
   * Start a broadcast: create the audio context, the frame worklet and the
   * Opus encoder, and open the input devices that are switched on.
   */
  startBroadcast(streamingMode: StreamingMode): Promise<boolean> {
    if (!this._ready) {
      this._sendToPlayer({ kind: "broadcast", active: true });
      this._ready = this._startBroadcast(streamingMode).catch((error: unknown) => {
        console.error("Unable to start the broadcast audio", error);
        return false;
      });
    }
    return this._ready;
  }

  async _startBroadcast(streamingMode: StreamingMode): Promise<boolean> {
    const context = new AudioContext({
      // Setting the latency hint to `playback` fixes audio glitches on some Windows 11 machines.
      latencyHint: "playback",
      sampleRate: SAMPLE_RATE,
    });
    this._audioContext = context;
    this._streamingMode = streamingMode;
    this._setupLoopback();

    await context.audioWorklet.addModule(PCMStream);
    await context.audioWorklet.addModule(PlayerFrameInlet);
    if (this._audioContext !== context) {
      // Stopped while the worklet was loading.
      return false;
    }
    this._graphReady = true;
    this._syncRooms();
    console.info("Broadcast audio started");

    for (const deviceId of this._externalDevices) {
      void this._captureExternalDevice(deviceId);
    }
    this._updateRunning();
    return true;
  }

  /** Stop the broadcast: release every capture and close the audio context. */
  async stopBroadcast(): Promise<void> {
    if (!this._ready) {
      return;
    }
    this._ready = undefined;
    this._sendToPlayer({ kind: "broadcast", active: false });
    for (const room of [...this._playerInlets.keys()]) {
      this._releasePlayerInlet(room);
    }
    for (const id of Object.keys(this._mediaStreams)) {
      this._releaseBrowserViewStream(Number(id));
    }
    this._browserViewRequests = {};
    for (const deviceId of Object.keys(this._externalAudioStreams)) {
      this._releaseExternalDevice(deviceId);
    }
    for (const mix of this._mixes.values()) {
      this._releaseMix(mix);
    }
    this._mixes.clear();
    this._graphReady = false;
    this._loopbackNode?.disconnect();
    this._loopbackNode = undefined;
    if (this._audioOutputElement) {
      this._audioOutputElement.pause();
      this._audioOutputElement.srcObject = null;
      this._audioOutputElement = undefined;
    }
    const context = this._audioContext;
    this._audioContext = undefined;
    await context?.close().catch((): void => undefined);
    console.info("Broadcast audio stopped");
  }

  /**
   * OUT-5: bring the mixes in line with the rooms: a mix for each new room,
   * the mix of a room that has gone stopped and freed, then every source and
   * "This Computer" connected again where their routes now point.
   */
  _syncRooms(): void {
    const context = this._audioContext;
    if (!context || !this._graphReady) {
      return;
    }
    const wanted = this._rooms.length > 0 ? this._rooms : [UNNAMED_ROOM];
    const mixes = new Map<string, RoomMix>();
    for (const id of wanted) {
      mixes.set(id, this._mixes.get(id) ?? this._createMix(context, id));
    }
    for (const [id, mix] of this._mixes) {
      if (!mixes.has(id)) {
        this._releaseMix(mix);
      }
    }
    this._mixes = mixes;

    for (const [id, output] of Object.entries(this._mediaStreamOutputs)) {
      this._connectSource(output, this._routes.get(Number(id)) ?? this._defaultRoute);
    }
    for (const output of Object.values(this._externalAudioStreamOutputs)) {
      this._connectSource(output, this._defaultRoute);
    }
    const loopback = this._loopbackNode;
    if (loopback) {
      let first = true;
      for (const mix of this._mixes.values()) {
        if (first) {
          mix.volume.connect(loopback);
        } else {
          try {
            mix.volume.disconnect(loopback);
          } catch {
            // Was not connected: nothing to undo.
          }
        }
        first = false;
      }
    }
  }

  _createMix(context: AudioContext, id: string): RoomMix {
    const input = context.createGain();
    const volume = context.createGain();
    volume.gain.value = this._roomVolumes.get(id) ?? 1;
    const pcmNode = new AudioWorkletNode(context, "pcm-stream");
    const mix: RoomMix = { id, input, volume, pcmNode, encoder: this._createEncoder(id) };
    pcmNode.port.onmessage = (event: MessageEvent<WorkletFrame[]>) => {
      // Frames still on their way from a room that has gone are dropped.
      if (this._mixes.get(id) !== mix) {
        return;
      }
      for (const frame of event.data) {
        this._encode(mix.encoder, frame);
      }
    };
    input.connect(volume);
    volume.connect(pcmNode);
    return mix;
  }

  _releaseMix(mix: RoomMix): void {
    this._releasePlayerInlet(mix.id);
    mix.input.disconnect();
    mix.volume.disconnect();
    mix.pcmNode.disconnect();
    if (mix.encoder.state !== "closed") {
      mix.encoder.close();
    }
  }

  /** The rooms a route names now: every room, the first, or one (a gone room: the first). */
  _mixesFor(route: CaptureRoute): RoomMix[] {
    const mixes = [...this._mixes.values()];
    if (route === "all") {
      return mixes;
    }
    const chosen = route === "table" ? undefined : this._mixes.get(route.room);
    return chosen ? [chosen] : mixes.slice(0, 1);
  }

  _connectSource(output: AudioNode, route: CaptureRoute): void {
    output.disconnect();
    for (const mix of this._mixesFor(route)) {
      output.connect(mix.input);
    }
  }

  /**
   * OUT-5, PRV-1: the main process hands over a new end of the player channel
   * (either page loaded again). The player page learns at once whether a
   * broadcast is running, since it sends room frames only then.
   */
  setPlayerPort(port: AudioPortLike): void {
    this._playerPort?.close?.();
    this._playerPort = port;
    port.onmessage = (event) => {
      if (this._playerPort === port && isPlayerAudioMessage(event.data)) {
        this._handlePlayerMessage(event.data);
      }
    };
    port.start?.();
    this._sendToPlayer({ kind: "broadcast", active: Boolean(this._ready) });
  }

  _sendToPlayer(message: CaptureAudioMessage): void {
    this._playerPort?.postMessage(message);
  }

  _handlePlayerMessage(message: PlayerAudioMessage): void {
    switch (message.kind) {
      case "room":
        this._playRoomFrame(message.room, message.index, message.samples);
        break;
      case "preview":
        void this._playPreviewFrame(message.index, message.samples);
        break;
      case "preview-sink":
        void this._setPreviewSink(message.id, message.deviceId);
        break;
    }
  }

  /** OUT-5: 20 ms of an engine room, into that room's mix (only while broadcasting, only a room it has). */
  _playRoomFrame(room: string, index: number, samples: Float32Array): void {
    const context = this._audioContext;
    const mix = this._mixes.get(room);
    if (!context || !this._graphReady || !mix || room === UNNAMED_ROOM) {
      return;
    }
    let inlet = this._playerInlets.get(room);
    if (!inlet) {
      const node = new AudioWorkletNode(context, "player-frame-inlet", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.connect(mix.input);
      inlet = { node };
      this._playerInlets.set(room, inlet);
      this._updateRunning();
    }
    if (inlet.timer) {
      clearTimeout(inlet.timer);
    }
    // Silence is not sent, so a room that stays quiet frees its inlet.
    inlet.timer = setTimeout(() => {
      this._releasePlayerInlet(room);
      this._updateRunning();
    }, PLAYER_INLET_IDLE_MS);
    inlet.node.port.postMessage({ index, samples }, [samples.buffer]);
  }

  _releasePlayerInlet(room: string): void {
    const inlet = this._playerInlets.get(room);
    if (!inlet) {
      return;
    }
    this._playerInlets.delete(room);
    if (inlet.timer) {
      clearTimeout(inlet.timer);
    }
    inlet.node.port.onmessage = null;
    inlet.node.disconnect();
  }

  /** PRV-1: the preview's own context, made when the preview first plays and closed when it has been quiet. */
  _ensurePreview(): PreviewPlayback {
    if (this._preview) {
      return this._preview;
    }
    const context = new AudioContext({ latencyHint: "interactive", sampleRate: SAMPLE_RATE });
    const preview: PreviewPlayback = {
      context,
      ready: (async () => {
        try {
          if (this._previewSinkId) {
            await (context as SinkableContext).setSinkId?.(this._previewSinkId).catch(() => {
              // The device chosen earlier is gone: play on the default device.
            });
          }
          await context.audioWorklet.addModule(PlayerFrameInlet);
          if (this._preview !== preview) {
            return undefined;
          }
          const node = new AudioWorkletNode(context, "player-frame-inlet", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          node.connect(context.destination);
          return node;
        } catch (error) {
          console.error("Unable to play the preview", error);
          return undefined;
        }
      })(),
    };
    this._preview = preview;
    this._armPreviewTimer(preview);
    return preview;
  }

  _armPreviewTimer(preview: PreviewPlayback): void {
    if (preview.timer) {
      clearTimeout(preview.timer);
    }
    preview.timer = setTimeout(() => {
      if (this._preview === preview) {
        this._preview = undefined;
        void preview.ready.then((node) => node?.disconnect());
        void preview.context.close().catch((): void => undefined);
      }
    }, PREVIEW_IDLE_MS);
  }

  async _playPreviewFrame(index: number, samples: Float32Array): Promise<void> {
    const preview = this._ensurePreview();
    this._armPreviewTimer(preview);
    const node = await preview.ready;
    node?.port.postMessage({ index, samples }, [samples.buffer]);
  }

  /** PRV-2: play the preview on another device; the player page is told whether it worked. */
  async _setPreviewSink(id: number, deviceId: string): Promise<void> {
    const preview = this._ensurePreview();
    try {
      await (preview.context as SinkableContext).setSinkId?.(deviceId);
      this._previewSinkId = deviceId;
      this._sendToPlayer({ kind: "preview-sink-done", id });
    } catch (error) {
      console.error("Unable to play the preview on that device", error);
      this._sendToPlayer({ kind: "preview-sink-done", id, error: PREVIEW_DEVICE_REFUSED });
    }
  }

  /** OUT-5: the rooms changed (a bot joined, left or moved). Odd lists are ignored. */
  setRooms(rooms: string[]): void {
    if (
      !Array.isArray(rooms) ||
      new Set(rooms).size !== rooms.length ||
      !rooms.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ROOM_ID_LENGTH)
    ) {
      console.error("Ignored an odd list of rooms");
      return;
    }
    this._rooms = [...rooms];
    this._syncRooms();
  }

  /** OUT-5: a room's volume, 0 to 1. */
  setRoomVolume(room: string, volume: number): void {
    if (typeof room !== "string" || !Number.isFinite(volume)) {
      return;
    }
    const level = Math.max(0, Math.min(1, volume));
    this._roomVolumes.set(room, level);
    const mix = this._mixes.get(room);
    if (mix) {
      mix.volume.gain.value = level;
    }
  }

  /** OUT-5: send a view's audio to every room, the table or one room. */
  routeView(viewId: number, route: CaptureRoute): void {
    if (!Number.isSafeInteger(viewId) || !isCaptureRoute(route)) {
      return;
    }
    this._routes.set(viewId, route);
    const output = this._mediaStreamOutputs[viewId];
    if (output && this._graphReady) {
      this._connectSource(output, route);
    }
  }

  /** OUT-5: where views without a route of their own, and input devices, go. */
  setDefaultRoute(route: CaptureRoute): void {
    if (isCaptureRoute(route)) {
      this._defaultRoute = route;
      this._syncRooms();
    }
  }

  _createEncoder(room: string): AudioEncoder {
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const packet = new Uint8Array(chunk.byteLength);
        chunk.copyTo(packet);
        this.sendPacket(packet, room === UNNAMED_ROOM ? undefined : room);
      },
      error: (error) => {
        console.error("Unable to encode broadcast audio", error);
      },
    });
    encoder.configure(opusEncoderConfig(this._streamingMode));
    return encoder;
  }

  _encode(encoder: AudioEncoder, { index, samples, last }: WorkletFrame): void {
    if (encoder.state !== "configured") {
      return;
    }
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: SAMPLE_RATE,
      numberOfFrames: FRAME_LENGTH,
      numberOfChannels: NUM_CHANNELS,
      timestamp: index * FRAME_DURATION_MS * 1000,
      data: samples,
    });
    try {
      encoder.encode(data);
    } finally {
      data.close();
    }
    if (last) {
      // A silence follows: send out what the encoder still holds, so the end
      // of this sound is not prepended to the next one.
      encoder.flush().catch((error: unknown) => {
        console.error("Unable to encode broadcast audio", error);
      });
    }
  }

  /**
   * PERF-4: with no source connected the audio thread has nothing to do, so
   * the context is suspended; it resumes as soon as a source starts opening.
   */
  _updateRunning(): void {
    const context = this._audioContext;
    if (!context || !this._graphReady) {
      return;
    }
    const sources =
      Object.keys(this._mediaStreamSources).length +
      Object.keys(this._externalAudioStreamSources).length +
      Object.keys(this._browserViewRequests).length +
      this._playerInlets.size;
    if (sources > 0) {
      void context.resume();
    } else {
      void context.suspend();
    }
  }

  setMuted(id: number, muted: boolean): void {
    if (muted) {
      this._mutedViews.add(id);
    } else {
      this._mutedViews.delete(id);
    }
    // Mute the audio context node
    // Note: we can't use `webContents.setAudioMuted()` as we are capturing a
    // separate audio stream then what is being sent to the user
    if (this._mediaStreamOutputs[id]) {
      this._mediaStreamOutputs[id].gain.value = muted ? 0 : 1;
    }
  }

  /**
   * Toggle the playback of the view audio in the current window
   * @param {boolean} loopback
   */
  setLoopback(loopback: boolean): void {
    this._loopback = loopback;
    if (this._audioOutputElement) {
      this._audioOutputElement.muted = !loopback;
    }
  }

  /** The user switched an input device on; it is captured while broadcasting. */
  async startExternalAudioCapture(deviceId: string): Promise<void> {
    this._externalDevices.add(deviceId);
    if (this._ready && (await this._ready)) {
      await this._captureExternalDevice(deviceId);
    }
  }

  async _captureExternalDevice(deviceId: string): Promise<void> {
    try {
      const streamConfig: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId,
          noiseSuppression: false,
          autoGainControl: false,
          echoCancellation: false,
        },
        video: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(streamConfig);

      this._releaseExternalDevice(deviceId);
      if (!this._externalDevices.has(deviceId) || !this._audioContext) {
        // Switched off, or the broadcast stopped, while the device was opening.
        releaseCapture(stream);
        return;
      }
      this._externalAudioStreams[deviceId] = stream;

      const output = this._audioContext.createGain();
      this._externalAudioStreamOutputs[deviceId] = output;

      const audioSource = this._audioContext.createMediaStreamSource(stream);
      this._externalAudioStreamSources[deviceId] = audioSource;
      audioSource.connect(output);

      this._connectSource(output, this._defaultRoute);
      this._updateRunning();
    } catch (error) {
      console.error(
        `Unable to start stream for external audio device ${deviceId}`
      );
      console.error(error);
    }
  }

  /**
   * Stop capturing an input device.
   * PERF-5: its audio nodes are disconnected so they do not pile up in the
   * audio context each time a device is switched on and off.
   */
  stopExternalAudioCapture(deviceId: string): void {
    this._externalDevices.delete(deviceId);
    this._releaseExternalDevice(deviceId);
    this._updateRunning();
  }

  _releaseExternalDevice(deviceId: string): void {
    releaseCapture(
      this._externalAudioStreams[deviceId],
      this._externalAudioStreamSources[deviceId],
      this._externalAudioStreamOutputs[deviceId]
    );
    delete this._externalAudioStreams[deviceId];
    delete this._externalAudioStreamSources[deviceId];
    delete this._externalAudioStreamOutputs[deviceId];
  }

  /**
   * The mix plays on this computer through an audio element, because a
   * captured tab no longer plays its own sound.
   */
  _setupLoopback(): void {
    const mediaDestination = this._audioContext.createMediaStreamDestination();
    this._loopbackNode = this._audioContext.createGain();
    this._loopbackNode.connect(mediaDestination);

    const element = document.createElement("audio");
    this._audioOutputElement = element;
    element.muted = !this._loopback;
    element.srcObject = mediaDestination.stream;
    element.onloadedmetadata = () => {
      void element.play();
    };
  }

  /**
   * Start an audio capture for the given browser view. The main process asks
   * for it while broadcasting, when the view starts to play sound.
   * @param viewId Browser view id
   * @param mediaSourceId The media source id to use with `getUserMedia`
   */
  async startBrowserViewStream(
    viewId: number,
    mediaSourceId: string
  ): Promise<void> {
    if (!this._ready) {
      // Late message from a broadcast that has already stopped.
      return;
    }
    const request = this._nextBrowserViewRequest++;
    this._browserViewRequests[viewId] = request;
    // Wake the audio thread while the capture opens, not after.
    this._updateRunning();
    try {
      const streamConfig = {
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: mediaSourceId,
          },
        },
        video: false,
      };
      const [stream, ready] = await Promise.all([
        navigator.mediaDevices.getUserMedia(
          // Reason
          // We use custom chromium MediaStreamConfig values here to capture the tabs audio
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          streamConfig as any
        ),
        this._ready ?? Promise.resolve(false),
      ]);
      if (this._browserViewRequests[viewId] !== request || !ready || !this._audioContext) {
        // Stopped or restarted while starting, or no broadcast is running.
        releaseCapture(stream);
        return;
      }
      this._releaseBrowserViewStream(viewId);
      this._mediaStreams[viewId] = stream;

      const output = this._audioContext.createGain();
      output.gain.value = this._mutedViews.has(viewId) ? 0 : 1;
      this._mediaStreamOutputs[viewId] = output;

      const audioSource = this._audioContext.createMediaStreamSource(stream);
      this._mediaStreamSources[viewId] = audioSource;
      audioSource.connect(output);

      this._connectSource(output, this._routes.get(viewId) ?? this._defaultRoute);
      console.info(`Capturing audio of view ${viewId}`);
    } catch (error) {
      if (this._browserViewRequests[viewId] !== request) {
        // The tab was closed while its capture was starting; nothing to report.
        return;
      }
      delete this._browserViewRequests[viewId];
      this._updateRunning();
      console.error(`Unable to start stream for web view ${viewId}`);
      console.error(error);
    }
  }

  /**
   * Stop an audio capture for the given browser view.
   * PERF-5: its audio nodes are disconnected so closed tabs do not leave
   * nodes behind in the audio context.
   * @param viewId Browser view id
   */
  stopBrowserViewStream(viewId: number): void {
    // A capture still starting sees its request gone and drops itself.
    delete this._browserViewRequests[viewId];
    this._releaseBrowserViewStream(viewId);
    this._updateRunning();
  }

  /** Disconnect and forget the current capture of a view, if any. */
  _releaseBrowserViewStream(viewId: number): void {
    releaseCapture(
      this._mediaStreams[viewId],
      this._mediaStreamSources[viewId],
      this._mediaStreamOutputs[viewId]
    );
    delete this._mediaStreams[viewId];
    delete this._mediaStreamSources[viewId];
    delete this._mediaStreamOutputs[viewId];
  }

  /** Stop the audio capture of every browser view (all views were removed). */
  stopAllBrowserViewStreams(): void {
    const ids = new Set([
      ...Object.keys(this._mediaStreams),
      ...Object.keys(this._mediaStreamOutputs),
      ...Object.keys(this._browserViewRequests),
    ]);
    for (const id of ids) {
      this.stopBrowserViewStream(Number(id));
    }
  }
}

/**
 * PERF-5: end a capture completely: stop the stream's tracks and unplug its
 * nodes from the audio graph so they can be garbage-collected.
 */
function releaseCapture(
  stream: MediaStream | undefined,
  ...nodes: (AudioNode | undefined)[]
): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
  for (const node of nodes) {
    node?.disconnect();
  }
}
