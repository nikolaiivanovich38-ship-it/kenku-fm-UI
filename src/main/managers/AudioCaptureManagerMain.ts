import { BrowserWindow, ipcMain, MessageChannelMain, webContents } from "electron";
import type { MessageEvent as MainMessageEvent, MessagePortMain } from "electron";
import { TypedEmitter } from "tiny-typed-emitter";
import { guardIpc } from "../security/ipcGuard";
import { lockAppPage } from "../security/navigationGuards";
import { captureTargets } from "../security/captureTargets";
import { trustedContents } from "../security/trustedContents";
import {
  DEFAULT_CAPTURE_ROUTE,
  MAX_ROOM_ID_LENGTH,
  type CaptureRoute,
} from "../../common/outputs";

declare const AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: string;
declare const AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export type StreamingMode = "lowLatency" | "performance";

interface AudioCaptureManagerEvents {
  /**
   * One encoded Opus packet (20 ms of a room's mix, OUT-5). `room` is the
   * room's bot id; missing while the capture window has been told no rooms.
   */
  packet: (packet: Buffer, room?: string) => void;
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
 * SEC-2: encoded audio reaches the main process over a private message
 * channel. The main process creates it and hands one end to the capture
 * window each time that window loads; no network socket exists, so nothing
 * else on this computer or the network can send audio into Discord.
 */
export const AUDIO_PORT_CHANNEL = "AUDIO_CAPTURE_PORT";

/**
 * OUT-5: a message from the capture window: one packet of the table (bytes),
 * or `{ room, packet }` for one room. Undefined if it is neither.
 */
export function roomPacketFrom(data: unknown): { packet: Buffer; room?: string } | undefined {
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const packet = packetFrom(data);
    return packet && { packet };
  }
  const { room, packet: bytes } = (data ?? {}) as { room?: unknown; packet?: unknown };
  if (typeof room !== "string" || room.length === 0 || room.length > MAX_ROOM_ID_LENGTH) {
    return undefined;
  }
  const packet = packetFrom(bytes);
  return packet && { packet, room };
}

/** The packet as bytes, or undefined if the message is not one packet. */
export function packetFrom(data: unknown): Buffer | undefined {
  let packet: Buffer | undefined;
  if (data instanceof ArrayBuffer) {
    packet = Buffer.from(data);
  } else if (ArrayBuffer.isView(data) && data instanceof Uint8Array) {
    packet = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!packet || packet.length === 0 || packet.length > MAX_OPUS_PACKET_BYTES) {
    return undefined;
  }
  return packet;
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
  /** Main-process end of the audio channel to the capture window. */
  _port?: MessagePortMain;
  _streamingMode: StreamingMode = "performance";
  _broadcasting = false;
  /** "This Computer" switched off: views play nothing locally. */
  _localMuted = false;
  /** Views the main window asked to have captured, by web contents id. */
  _views = new Map<number, WatchedView>();
  /** Views the user muted in the tab bar (kept for views not yet watched). */
  _mutedViews = new Set<number>();
  /** OUT-5: the rooms (bot ids), first room first, as last told to the capture window. */
  _rooms: string[] = [];
  /** OUT-5: room volumes that are not 1. */
  _roomVolumes = new Map<string, number>();
  /** OUT-5: where each view's audio goes, when not the default. */
  _routes = new Map<number, CaptureRoute>();
  _defaultRoute: CaptureRoute = DEFAULT_CAPTURE_ROUTE;

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
    this._browserWindow.webContents.on("did-finish-load", this._openAudioChannel);
    this._browserWindow.webContents.loadURL(AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY);

    // SEC-8: commands from the main window.
    this._ipc.on("AUDIO_CAPTURE_SET_MUTED", this._handleSetMuted);
    this._ipc.on("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", this._handleStartExternalAudioCapture);
    this._ipc.on("AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE", this._handleStopExternalAudioCapture);
    this._ipc.on("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", this._handleStartBrowserViewStream);
    this._ipc.on("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", this._handleStopBrowserViewStream);
    this._ipc.on("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS", this._handleStopAllBrowserViewStreams);
  }

  destroy() {
    this._ipc.dispose();
    this.stopBroadcast();
    for (const viewId of [...this._views.keys()]) {
      this._unwatch(viewId);
    }
    this._port?.close();
    this._port = undefined;
    this._browserWindow.webContents.close();
    (this._browserWindow.webContents as any).destroy();
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

  /** Give the (re)loaded capture window a fresh end of the audio channel. */
  _openAudioChannel = () => {
    this._port?.close();
    const { port1, port2 } = new MessageChannelMain();
    port1.on("message", (event: MainMessageEvent) => this._handlePacket(event.data));
    port1.start();
    this._port = port1;
    this._browserWindow.webContents.postMessage(AUDIO_PORT_CHANNEL, null, [port2]);
    this._sendRoomsToCapture();
  };

  _handlePacket = (data: unknown) => {
    const message = roomPacketFrom(data);
    if (message && this._broadcasting) {
      this.emit("packet", message.packet, message.room);
    }
  };

  /** OUT-5: the rooms changed (a bot joined, left or moved): one mix per room. */
  setRooms(rooms: readonly string[]) {
    this._rooms = [...rooms];
    for (const id of [...this._roomVolumes.keys()]) {
      if (!rooms.includes(id)) {
        this._roomVolumes.delete(id);
      }
    }
    this._sendToCapture("AUDIO_CAPTURE_SET_ROOMS", this._rooms);
  }

  /** OUT-5: a room's volume (everything sent to it), 0 to 1. */
  setRoomVolume(room: string, volume: number) {
    if (volume === 1) {
      this._roomVolumes.delete(room);
    } else {
      this._roomVolumes.set(room, volume);
    }
    this._sendToCapture("AUDIO_CAPTURE_SET_ROOM_VOLUME", room, volume);
  }

  /** OUT-5: send one view's audio to every room, the table or one room. */
  routeView(viewId: number, route: CaptureRoute) {
    this._routes.set(viewId, route);
    this._sendToCapture("AUDIO_CAPTURE_ROUTE_VIEW", viewId, route);
  }

  /** OUT-5: where views without a route of their own, and input devices, go. */
  setDefaultRoute(route: CaptureRoute) {
    this._defaultRoute = route;
    this._sendToCapture("AUDIO_CAPTURE_SET_DEFAULT_ROUTE", route);
  }

  /** A (re)loaded capture window starts empty: tell it the rooms and routes. */
  _sendRoomsToCapture() {
    if (this._rooms.length > 0) {
      this._sendToCapture("AUDIO_CAPTURE_SET_ROOMS", this._rooms);
    }
    if (this._defaultRoute !== DEFAULT_CAPTURE_ROUTE) {
      this._sendToCapture("AUDIO_CAPTURE_SET_DEFAULT_ROUTE", this._defaultRoute);
    }
    for (const [room, volume] of this._roomVolumes) {
      this._sendToCapture("AUDIO_CAPTURE_SET_ROOM_VOLUME", room, volume);
    }
    for (const [viewId, route] of this._routes) {
      this._sendToCapture("AUDIO_CAPTURE_ROUTE_VIEW", viewId, route);
    }
  }

  /**
   * FND-16: Settings › Sound to Discord, from this computer's settings (src/main/soundToDiscord.ts). Applies from
   * the next broadcast; the encoder is set up when one starts.
   */
  setStreamingMode(streamingMode: StreamingMode) {
    this._streamingMode = streamingMode;
  }

  /** "This Computer" on or off (OUT-1: chosen in the output list, via OutputManager). */
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
    // Only website tabs are sent to Discord this way; the app's own pages and
    // the capture window itself are never captured.
    const role = trustedContents.roleOf(contents);
    if (role !== null) {
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
    contents.once("destroyed", () => {
      // OUT-5: a closed tab's route is not kept for a later view with its id.
      this._routes.delete(viewId);
      this._unwatch(viewId);
    });
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
