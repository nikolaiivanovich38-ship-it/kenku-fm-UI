import { ipcRenderer } from "electron";

import {
  AudioCaptureManagerPreload,
  StreamingMode,
} from "../preload/managers/AudioCaptureManagerPreload";

/**
 * SEC-2: Opus packets go to the main process over a private message channel
 * whose other end only the main process holds. It arrives when the window
 * has loaded, long before any broadcast can start.
 */
let audioPort: MessagePort | undefined;
ipcRenderer.on("AUDIO_CAPTURE_PORT", (event) => {
  audioPort?.close();
  audioPort = event.ports[0];
});

const audioCaptureManager = new AudioCaptureManagerPreload((packet) => {
  // Copied, not transferred: a buffer in the transfer list arrives in the
  // main process as null (Electron passes only ports that way).
  audioPort?.postMessage(packet);
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
