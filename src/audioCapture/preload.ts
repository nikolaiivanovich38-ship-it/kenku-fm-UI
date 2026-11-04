import { ipcRenderer } from "electron";

import {
  AudioCaptureManagerPreload,
  StreamingMode,
} from "../preload/managers/AudioCaptureManagerPreload";
import { toLoopbackWebSocketUrl } from "../common/security/loopback";

/**
 * Opus packets go to the main process over the loopback audio socket (SEC-2).
 * The socket opens when the window loads; packets sent before it is open are
 * dropped, which only happens if a broadcast starts in the first instant.
 */
let socket: WebSocket | undefined;
void ipcRenderer.invoke("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS").then((address: { port: number }) => {
  socket = new WebSocket(toLoopbackWebSocketUrl(address.port));
  socket.binaryType = "arraybuffer";
});

const audioCaptureManager = new AudioCaptureManagerPreload((packet) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(packet);
  }
});

ipcRenderer.on("AUDIO_CAPTURE_BROADCAST_START", (_, streamingMode: StreamingMode) => {
  void audioCaptureManager.startBroadcast(streamingMode);
});

ipcRenderer.on("AUDIO_CAPTURE_BROADCAST_STOP", () => {
  void audioCaptureManager.stopBroadcast();
});

ipcRenderer.on(
  "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM",
  (_, viewId: number, mediaSourceId: string) => {
    void audioCaptureManager.startBrowserViewStream(viewId, mediaSourceId);
  }
);

ipcRenderer.on(
  "AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM",
  (_, viewId: number) => {
    audioCaptureManager.stopBrowserViewStream(viewId);
  }
);

ipcRenderer.on("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS", () => {
  audioCaptureManager.stopAllBrowserViewStreams();
});

ipcRenderer.on(
  "AUDIO_CAPTURE_BROWSER_VIEW_MUTED",
  (_, viewId: number, muted: boolean) => {
    audioCaptureManager.setMuted(viewId, muted);
  }
);

ipcRenderer.on("AUDIO_CAPTURE_SET_LOOPBACK", (_, loopback: boolean) => {
  audioCaptureManager.setLoopback(loopback);
});

ipcRenderer.on(
  "AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE",
  (_, deviceId: string) => {
    void audioCaptureManager.startExternalAudioCapture(deviceId);
  }
);

ipcRenderer.on(
  "AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE",
  (_, deviceId: string) => {
    audioCaptureManager.stopExternalAudioCapture(deviceId);
  }
);
