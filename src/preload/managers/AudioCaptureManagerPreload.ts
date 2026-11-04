// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PCMStream from "./PCMStream.worklet";

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

/** Receives each encoded Opus packet (one 20 ms frame). */
export type PacketSink = (packet: Uint8Array) => void;

/** One frame from the PCM worklet (see PCMStream.worklet.js). */
type WorkletFrame = { index: number; samples: Float32Array<ArrayBuffer>; last?: boolean };

/**
 * How many 20 ms frames the worklet collects before posting them.
 * "performance" posts half a second at a time, which delays the broadcast by
 * that much (PERF-8).
 */
export function framesPerMessage(mode: StreamingMode): number {
  return mode === "performance" ? 25 : 1;
}

/**
 * WebCodecs Opus settings (PERF-4: Opus is encoded here, in the capture
 * window, instead of on the main process).
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
 */
export class AudioCaptureManagerPreload {
  /** Audio context to mix media streams into one audio output */
  _audioContext?: AudioContext;
  /** Audio output node that streams will connect to */
  _audioOutputNode?: AudioNode;
  /** Cuts the mix into 20 ms frames for the encoder. */
  _pcmNode?: AudioWorkletNode;
  /** Opus encoder (WebCodecs). */
  _encoder?: AudioEncoder;
  /** Set while broadcasting; resolves true once sources can be connected. */
  _ready?: Promise<boolean>;

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
    this._audioOutputNode = context.createGain();
    this._setupLoopback();
    this._encoder = this._createEncoder(streamingMode);

    await context.audioWorklet.addModule(PCMStream);
    if (this._audioContext !== context) {
      // Stopped while the worklet was loading.
      return false;
    }
    this._pcmNode = new AudioWorkletNode(context, "pcm-stream", {
      processorOptions: { framesPerMessage: framesPerMessage(streamingMode) },
    });
    this._pcmNode.port.onmessage = (event: MessageEvent<WorkletFrame[]>) => {
      for (const frame of event.data) {
        this._encode(frame);
      }
    };
    this._audioOutputNode.connect(this._pcmNode);
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
    for (const id of Object.keys(this._mediaStreams)) {
      this._releaseBrowserViewStream(Number(id));
    }
    this._browserViewRequests = {};
    for (const deviceId of Object.keys(this._externalAudioStreams)) {
      this._releaseExternalDevice(deviceId);
    }
    this._pcmNode?.disconnect();
    this._pcmNode = undefined;
    if (this._encoder && this._encoder.state !== "closed") {
      this._encoder.close();
    }
    this._encoder = undefined;
    if (this._audioOutputElement) {
      this._audioOutputElement.pause();
      this._audioOutputElement.srcObject = null;
      this._audioOutputElement = undefined;
    }
    const context = this._audioContext;
    this._audioContext = undefined;
    this._audioOutputNode = undefined;
    await context?.close().catch((): void => undefined);
    console.info("Broadcast audio stopped");
  }

  _createEncoder(streamingMode: StreamingMode): AudioEncoder {
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const packet = new Uint8Array(chunk.byteLength);
        chunk.copyTo(packet);
        this.sendPacket(packet);
      },
      error: (error) => {
        console.error("Unable to encode broadcast audio", error);
      },
    });
    encoder.configure(opusEncoderConfig(streamingMode));
    return encoder;
  }

  _encode({ index, samples, last }: WorkletFrame): void {
    const encoder = this._encoder;
    if (!encoder || encoder.state !== "configured") {
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
    if (!context || !this._pcmNode) {
      return;
    }
    const sources =
      Object.keys(this._mediaStreamSources).length +
      Object.keys(this._externalAudioStreamSources).length +
      Object.keys(this._browserViewRequests).length;
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

      output.connect(this._audioOutputNode);
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
    this._audioOutputNode.connect(mediaDestination);

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

      output.connect(this._audioOutputNode);
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
