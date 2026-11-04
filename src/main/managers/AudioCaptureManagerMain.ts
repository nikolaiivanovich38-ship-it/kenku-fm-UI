import { BrowserWindow, ipcMain, webContents } from "electron";
import { TypedEmitter } from "tiny-typed-emitter";
import { WebSocketServer, WebSocket } from "ws";
import { LOOPBACK_HOST } from "../../common/security/loopback";
import { guardIpc } from "../security/ipcGuard";
import { lockAppPage } from "../security/navigationGuards";
import { captureTargets } from "../security/captureTargets";
import { trustedContents } from "../security/trustedContents";

declare const AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: string;
declare const AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export type StreamingMode = "lowLatency" | "performance";

interface AudioCaptureManagerEvents {
  /** One encoded Opus packet (20 ms of the mix). */
  packet: (packet: Buffer) => void;
}

/**
 * PERF-4: how long a captured view may stay silent before its capture stops.
 * Long enough to bridge the gap between two tracks, so a playlist keeps one
 * capture; short enough that a tab that has gone quiet stops costing anything.
 */
export const SILENCE_HOLD_MS = 30_000;

/**
 * Largest Opus packet accepted from the capture window. One 20 ms frame is at
 * most 1275 bytes per stream; anything larger is not audio from our encoder.
 */
export const MAX_OPUS_PACKET_BYTES = 4000;

/**
 * SEC-2: the socket that carries encoded audio from the hidden capture
 * window to the Discord outputs. Bound to the loopback interface so other
 * machines on the network cannot connect and inject audio. Port 0 lets the
 * operating system pick a free port.
 */
export function createAudioSocketServer(): WebSocketServer {
  return new WebSocketServer({ host: LOOPBACK_HOST, port: 0 });
}

/** The parts of a WebContents this manager uses. */
interface CapturableContents {
  id: number;
  isDestroyed(): boolean;
  isCurrentlyAudible(): boolean;
  setAudioMuted(muted: boolean): void;
  getMediaSourceId(requestWebContents: Electron.WebContents): string;
  on(event: "audio-state-changed", listener: (event: { audible: boolean }) => void): unknown;
  on(event: "media-started-playing", listener: () => void): unknown;
  off(event: "audio-state-changed", listener: (event: { audible: boolean }) => void): unknown;
  off(event: "media-started-playing", listener: () => void): unknown;
  once(event: "destroyed", listener: () => void): unknown;
}

/** A website tab or the player that may be captured while broadcasting. */
interface WatchedView {
  contents: CapturableContents;
  captured: boolean;
  silenceTimer?: ReturnType<typeof setTimeout>;
  stopWatching(): void;
}

/**
 * Manager to capture audio from browser views and external audio devices
 * This class is to be run on the main thread
 * For the render thread counterpart see `AudioCaptureManagerPreload.ts`
 *
 * PERF-4: capture runs only during a broadcast (`startBroadcast` when the
 * first output joins a voice channel, `stopBroadcast` when the last leaves),
 * and only for views that are playing sound: a view's capture starts when
 * Chromium reports it audible and stops after `SILENCE_HOLD_MS` of silence.
 * Outside a broadcast, views play on this computer directly.
 */
export class AudioCaptureManagerMain extends TypedEmitter<AudioCaptureManagerEvents> {
  _browserWindow: BrowserWindow;
  _wss: WebSocketServer;
  _streamingMode: StreamingMode = "performance";
  _broadcasting = false;
  /** "This Computer" switched off: views play nothing locally. */
  _localMuted = false;
  /** Views the main window asked to have captured, by web contents id. */
  _views = new Map<number, WatchedView>();
  /** Views the user muted in the tab bar (kept for views not yet watched). */
  _mutedViews = new Set<number>();

  /** SEC-8: message listeners that only accept the app's own pages. */
  private _ipc = guardIpc(ipcMain);

  constructor() {
    super();
    this._browserWindow = new BrowserWindow({
      webPreferences: {
        preload: AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY,
        // SEC-12: the capture preload needs only `ipcRenderer` and browser
        // audio APIs (the PCM worklet is bundled and loaded from a blob: URL),
        // so it runs sandboxed like the other app pages. Forge already builds
        // every preload in this app for the sandbox (no nodeIntegration).
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // PERF-4: the window is hidden, and Chromium slows hidden pages down;
        // frames from the audio thread then reach the encoder in bursts every
        // few hundred milliseconds, which Discord hears as gaps.
        backgroundThrottling: false,
      },
      minimizable: false,
      frame: false,
      show: false
    });
    lockAppPage(this._browserWindow.webContents, "audio-capture");
    // SEC-3: tab capture is granted only to requests from this page's origin.
    captureTargets.setCapturer(AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY);
    this._browserWindow.webContents.loadURL(AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY);
    this._wss = createAudioSocketServer();

    // SEC-8: commands from the main window.
    this._ipc.on("AUDIO_CAPTURE_SET_STREAMING_MODE", this._handleSetStreamingMode);
    this._ipc.on("AUDIO_CAPTURE_SET_LOOPBACK", this._handleSetLoopback);
    this._ipc.on("AUDIO_CAPTURE_SET_MUTED", this._handleSetMuted);
    this._ipc.on("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", this._handleStartExternalAudioCapture);
    this._ipc.on("AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE", this._handleStopExternalAudioCapture);
    this._ipc.on("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", this._handleStartBrowserViewStream);
    this._ipc.on("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", this._handleStopBrowserViewStream);
    this._ipc.on("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS", this._handleStopAllBrowserViewStreams);
    // SEC-8: messages from the hidden capture window.
    this._ipc.handle("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS", this._handleGetWebsocketAddress);

    this._wss.on("connection", this._handleWebsocketConnection);
  }

  destroy() {
    this._ipc.dispose();
    this.stopBroadcast();
    for (const viewId of [...this._views.keys()]) {
      this._unwatch(viewId);
    }
    this._browserWindow.webContents.close();
    (this._browserWindow.webContents as any).destroy();
    this._wss.close();
  }

  get broadcasting(): boolean {
    return this._broadcasting;
  }

  /** An output joined a voice channel: start capturing views that play sound. */
  startBroadcast() {
    if (this._broadcasting) {
      return;
    }
    this._broadcasting = true;
    this._sendToCapture("AUDIO_CAPTURE_BROADCAST_START", this._streamingMode);
    for (const view of this._views.values()) {
      if (view.contents.isCurrentlyAudible()) {
        this._startCapture(view);
      }
    }
  }

  /** The last output left: release every capture and the audio context. */
  stopBroadcast() {
    if (!this._broadcasting) {
      return;
    }
    this._broadcasting = false;
    for (const view of this._views.values()) {
      this._clearSilenceTimer(view);
      if (view.captured) {
        view.captured = false;
        captureTargets.revoke(view.contents);
      }
    }
    this._sendToCapture("AUDIO_CAPTURE_BROADCAST_STOP");
  }

  _sendToCapture(channel: string, ...args: unknown[]) {
    const contents = this._browserWindow.webContents;
    if (!contents.isDestroyed()) {
      contents.send(channel, ...args);
    }
  }

  _handleWebsocketConnection = (ws: WebSocket) => {
    ws.on("message", this._handlePacket);
  };

  _handlePacket = (data: Buffer, isBinary = true) => {
    if (!isBinary || !Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_OPUS_PACKET_BYTES) {
      return;
    }
    if (this._broadcasting) {
      this.emit("packet", data);
    }
  };

  /** Applies from the next broadcast; the encoder is set up when one starts. */
  _handleSetStreamingMode = (_: Electron.IpcMainEvent, streamingMode: StreamingMode) => {
    this._streamingMode = streamingMode;
  };

  _handleSetLoopback = (_: Electron.IpcMainEvent, loopback: boolean) => {
    this.setLocalMuted(!loopback);
  };

  /** "This Computer" on or off. */
  setLocalMuted(muted: boolean) {
    this._localMuted = muted;
    this._sendToCapture("AUDIO_CAPTURE_SET_LOOPBACK", !muted);
    for (const view of this._views.values()) {
      this._applyLocalMute(view);
    }
  }

  _handleSetMuted = (
    _: Electron.IpcMainEvent,
    viewId: number,
    muted: boolean
  ) => {
    if (muted) {
      this._mutedViews.add(viewId);
    } else {
      this._mutedViews.delete(viewId);
    }
    const view = this._views.get(viewId);
    if (view) {
      this._applyLocalMute(view);
    }
    this._sendToCapture("AUDIO_CAPTURE_BROWSER_VIEW_MUTED", viewId, muted);
  };

  /**
   * A view that is not being captured plays on this computer by itself, so
   * the tab's mute button and "This Computer" being off must silence it
   * there. Muting a page does not mute its captured audio (checked in WP2),
   * so Discord still hears an unmuted view.
   */
  _applyLocalMute(view: WatchedView) {
    if (!view.contents.isDestroyed()) {
      view.contents.setAudioMuted(this._localMuted || this._mutedViews.has(view.contents.id));
    }
  }

  _handleStartExternalAudioCapture = (
    _: Electron.IpcMainEvent,
    deviceId: string
  ) => {
    this._sendToCapture("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", deviceId);
  };

  _handleStopExternalAudioCapture = (
    _: Electron.IpcMainEvent,
    deviceId: string
  ) => {
    this._sendToCapture("AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE", deviceId);
  };

  _handleGetWebsocketAddress = async () => {
    return this._wss.address();
  };

  /**
   * The main window offers a view whose audio may go to Discord (sent when
   * the view has loaded). PERF-4: it is captured only while broadcasting and
   * while it plays sound. SEC-8: a view that no longer exists is ignored.
   */
  _handleStartBrowserViewStream = (
    _: Electron.IpcMainEvent,
    viewId: number
  ) => {
    this._watch(viewId);
  };

  _handleStopBrowserViewStream = (_: Electron.IpcMainEvent, viewId: number) => {
    this._unwatch(viewId);
  };

  /**
   * The main window removed every view (for example after an error): stop
   * capturing all of their audio. Previously this message had no handler, so
   * the streams kept running.
   */
  _handleStopAllBrowserViewStreams = () => {
    for (const viewId of [...this._views.keys()]) {
      this._unwatch(viewId);
    }
    captureTargets.revokeAll();
    this._sendToCapture("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS");
  };

  _watch(viewId: number) {
    if (this._views.has(viewId)) {
      return;
    }
    const contents = webContents.fromId(viewId) as unknown as CapturableContents | undefined;
    if (!contents || contents.isDestroyed()) {
      return;
    }
    // Only website tabs and the player are sent to Discord; the main window
    // and the capture window itself are never captured.
    const role = trustedContents.roleOf(contents);
    if (role !== null && role !== "player-view") {
      console.error(`Refused to capture audio from app page ${viewId}`);
      return;
    }
    const onAudioState = (event: { audible: boolean }) => {
      this._handleAudible(view, event.audible);
    };
    const onMediaStarted = () => {
      this._handleMediaStarted(view);
    };
    const view: WatchedView = {
      contents,
      captured: false,
      stopWatching: () => {
        contents.off("audio-state-changed", onAudioState);
        contents.off("media-started-playing", onMediaStarted);
      },
    };
    contents.on("audio-state-changed", onAudioState);
    contents.on("media-started-playing", onMediaStarted);
    contents.once("destroyed", () => this._unwatch(viewId));
    this._views.set(viewId, view);
    this._applyLocalMute(view);
    if (this._broadcasting && contents.isCurrentlyAudible()) {
      this._startCapture(view);
    }
  }

  _unwatch(viewId: number) {
    const view = this._views.get(viewId);
    if (!view) {
      return;
    }
    this._views.delete(viewId);
    view.stopWatching();
    this._clearSilenceTimer(view);
    if (view.captured) {
      this._stopCapture(view);
    }
  }

  /**
   * Chromium's audible flag for a view changed. It checks the volume 15 times
   * a second, so this comes up to about 70 ms after a sound starts: the most
   * the start of a Web Audio sound can lose (measured in e2e/broadcast.spec.ts).
   */
  _handleAudible(view: WatchedView, audible: boolean) {
    if (!this._broadcasting) {
      return;
    }
    if (audible) {
      this._clearSilenceTimer(view);
      if (!view.captured) {
        this._startCapture(view);
      }
    } else {
      this._armSilenceTimer(view);
    }
  }

  /**
   * An audio or video element started playing. This comes before Chromium
   * reports the view audible (it checks the volume 15 times a second), so
   * capture starts sooner for tracks, YouTube and the like. If the element
   * turns out to be silent, the silence timer stops the capture again.
   */
  _handleMediaStarted(view: WatchedView) {
    if (!this._broadcasting) {
      return;
    }
    if (!view.captured) {
      this._startCapture(view);
    }
    if (!view.contents.isCurrentlyAudible()) {
      this._armSilenceTimer(view);
    }
  }

  _armSilenceTimer(view: WatchedView) {
    if (view.silenceTimer || !view.captured) {
      return;
    }
    view.silenceTimer = setTimeout(() => {
      view.silenceTimer = undefined;
      this._stopCapture(view);
    }, SILENCE_HOLD_MS);
  }

  _clearSilenceTimer(view: WatchedView) {
    if (view.silenceTimer) {
      clearTimeout(view.silenceTimer);
      view.silenceTimer = undefined;
    }
  }

  _startCapture(view: WatchedView) {
    const { contents } = view;
    if (contents.isDestroyed()) {
      return;
    }
    // SEC-3: Chromium asks the captured page for permission; allow it for
    // this page only, before the capture window asks.
    captureTargets.allow(contents as unknown as Electron.WebContents);
    let mediaSourceId: string;
    try {
      mediaSourceId = contents.getMediaSourceId(this._browserWindow.webContents);
    } catch (err) {
      console.error(`Unable to capture audio from view ${contents.id}`, err);
      captureTargets.revoke(contents);
      return;
    }
    view.captured = true;
    this._sendToCapture("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", contents.id, mediaSourceId);
  }

  _stopCapture(view: WatchedView) {
    view.captured = false;
    captureTargets.revoke(view.contents);
    this._sendToCapture("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", view.contents.id);
  }
}
