import { ipcRenderer } from "electron";

import {
  AudioCaptureManagerPreload,
  StreamingMode,
} from "../preload/managers/AudioCaptureManagerPreload";
import type { CaptureRoute } from "../common/outputs";

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

const audioCaptureManager = new AudioCaptureManagerPreload((packet, room) => {
  // Copied, not transferred: a buffer in the transfer list arrives in the
  // main process as null (Electron passes only ports that way). OUT-5: a
  // room's packet says which room (bot) it is for.
  audioPort?.postMessage(room === undefined ? packet : { room, packet });
});

ipcRenderer.on("AUDIO_CAPTURE_BROADCAST_START", (_, streamingMode: StreamingMode) => {
  void audioCaptureManager.startBroadcast(streamingMode);
});

// w51-audio: the main process (Save diagnostics, test builds) asks how Lyre's frames have fared here.
ipcRenderer.on("AUDIO_CAPTURE_TIMING", () => {
  console.info(`Audio timing: ${JSON.stringify(audioCaptureManager.audioTiming())}`);
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

// --- Rooms and buses (OUT-5): one mix per room, and where each source goes ---
ipcRenderer.on("AUDIO_CAPTURE_SET_ROOMS", (_, rooms: string[]) => {
  audioCaptureManager.setRooms(rooms);
});

ipcRenderer.on("AUDIO_CAPTURE_SET_ROOM_VOLUME", (_, room: string, volume: number) => {
  audioCaptureManager.setRoomVolume(room, volume);
});

ipcRenderer.on("AUDIO_CAPTURE_ROUTE_VIEW", (_, viewId: number, route: CaptureRoute) => {
  audioCaptureManager.routeView(viewId, route);
});

ipcRenderer.on("AUDIO_CAPTURE_SET_DEFAULT_ROUTE", (_, route: CaptureRoute) => {
  audioCaptureManager.setDefaultRoute(route);
});

// OUT-5, PRV-1: the private channel to the player page (engine rooms and the
// preview), handed over by the main process whenever either page loads.
ipcRenderer.on("AUDIO_CAPTURE_PLAYER_PORT", (event) => {
  const port = event.ports[0];
  if (port) {
    audioCaptureManager.setPlayerPort(port);
  }
});
