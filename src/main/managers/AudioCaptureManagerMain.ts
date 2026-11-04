import { BrowserWindow, ipcMain, webContents } from "electron";
import { TypedEmitter } from "tiny-typed-emitter";
import { Readable } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import prism from "prism-media";
import { LOOPBACK_HOST } from "../../common/security/loopback";
import { guardIpc } from "../security/ipcGuard";
import { lockAppPage } from "../security/navigationGuards";
import { captureTargets } from "../security/captureTargets";
import { trustedContents } from "../security/trustedContents";

declare const AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: string;
declare const AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

interface AudioCaptureManagerEvents {
  streamStart: (stream: Readable) => void;
  streamEnd: () => void;
}

/**
 * SEC-2: the socket that carries captured PCM audio from the hidden capture
 * window to the Discord encoder. Bound to the loopback interface so other
 * machines on the network cannot connect and inject audio. Port 0 lets the
 * operating system pick a free port.
 */
export function createAudioSocketServer(): WebSocketServer {
  return new WebSocketServer({ host: LOOPBACK_HOST, port: 0 });
}

/**
 * Manager to capture audio from browser views and external audio devices
 * This class is to be run on the main thread
 * For the render thread counterpart see `AudioCaptureManagerPreload.ts`
 */
export class AudioCaptureManagerMain extends TypedEmitter<AudioCaptureManagerEvents> {
  _browserWindow: BrowserWindow;
  _encoder?: prism.opus.Encoder;
  _wss: WebSocketServer;

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
    this._ipc.on("AUDIO_CAPTURE_START", this._handleStart);
    this._ipc.on("AUDIO_CAPTURE_SET_LOOPBACK", this._handleSetLoopback);
    this._ipc.on("AUDIO_CAPTURE_SET_MUTED", this._handleSetMuted);
    this._ipc.on("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", this._handleStartExternalAudioCapture);
    this._ipc.on("AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE", this._handleStopExternalAudioCapture);
    this._ipc.on("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", this._handleStartBrowserViewStream);
    this._ipc.on("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", this._handleStopBrowserViewStream);
    this._ipc.on("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS", this._handleStopAllBrowserViewStreams);
    // SEC-8: messages from the hidden capture window.
    this._ipc.on("AUDIO_CAPTURE_STREAM_START", this._handleStreamStart);
    this._ipc.on("AUDIO_CAPTURE_STREAM_END", this._handleStreamEnd);
    this._ipc.handle("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS", this._handleGetWebsocketAddress);

    this._wss.on("connection", this._handleWebsocketConnection);
  }

  destroy() {
    this._ipc.dispose();
    this._browserWindow.webContents.close();
    (this._browserWindow.webContents as any).destroy();
    this._handleStreamEnd();
    this._wss.close();
  }

  _handleWebsocketConnection = (ws: WebSocket) => {
    ws.on("message", this._handleStreamData);
  };

  _handleStart = (
    _: Electron.IpcMainEvent,
    streamingMode: "lowLatency" | "performance"
  ) => {
    this._browserWindow.webContents.send("AUDIO_CAPTURE_START", streamingMode);
  };

  _handleSetLoopback = (_: Electron.IpcMainEvent, loopback: boolean) => {
    this._browserWindow.webContents.send("AUDIO_CAPTURE_SET_LOOPBACK", loopback);
  };

  _handleSetMuted = (
    _: Electron.IpcMainEvent,
    viewId: number,
    muted: boolean
  ) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_BROWSER_VIEW_MUTED",
      viewId,
      muted
    );
  };

  _handleStartExternalAudioCapture = (
    _: Electron.IpcMainEvent,
    deviceId: string
  ) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE",
      deviceId
    );
  };

  _handleStopExternalAudioCapture = (
    _: Electron.IpcMainEvent,
    deviceId: string
  ) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE",
      deviceId
    );
  };

  _handleStreamStart = (
    _: Electron.IpcMainEvent,
    channels: number,
    frameSize: number,
    sampleRate: number
  ) => {
    this._encoder?.end();

    // Create a pipeline for converting raw PCM data into opus packets
    const encoder = new prism.opus.Encoder({
      channels: channels,
      frameSize: frameSize,
      rate: sampleRate,
    });
    this._encoder = encoder;

    // Setup any listener streams
    this.emit("streamStart", encoder);
  };

  _handleStreamData = async (data: Buffer) => {
    this._encoder?.write(data);
  };

  _handleStreamEnd = () => {
    this._encoder?.end();
    this._encoder = undefined;
    this.emit("streamEnd");
  };

  _handleGetWebsocketAddress = async () => {
    return this._wss.address();
  };

  /**
   * Start capturing a view's audio. SEC-8: a view that no longer exists
   * (closed before it finished loading, or an unknown id) is ignored.
   */
  _handleStartBrowserViewStream = (
    _: Electron.IpcMainEvent,
    viewId: number
  ) => {
    const contents = webContents.fromId(viewId);
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
    // SEC-3: Chromium asks the captured page for permission; allow it for
    // this page only, before the capture window asks.
    captureTargets.allow(contents);
    let mediaSourceId: string;
    try {
      mediaSourceId = contents.getMediaSourceId(this._browserWindow.webContents);
    } catch (err) {
      console.error(`Unable to capture audio from view ${viewId}`, err);
      captureTargets.revoke(contents);
      return;
    }
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM",
      viewId,
      mediaSourceId
    );
  };

  _handleStopBrowserViewStream = (_: Electron.IpcMainEvent, viewId: number) => {
    captureTargets.revoke({ id: viewId });
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM",
      viewId
    );
  };

  /**
   * The main window removed every view (for example after an error): stop
   * capturing all of their audio. Previously this message had no handler, so
   * the streams kept running.
   */
  _handleStopAllBrowserViewStreams = () => {
    captureTargets.revokeAll();
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS"
    );
  };
}
