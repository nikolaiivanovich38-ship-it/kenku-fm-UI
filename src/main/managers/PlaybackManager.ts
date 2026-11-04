import { app, BrowserWindow, safeStorage } from "electron";
import { BotTokenStore } from "../broadcast/botTokenStore";
import { OutputManager } from "../broadcast/OutputManager";
import { AudioCaptureManagerMain } from "./AudioCaptureManagerMain";

/**
 * Connects tab capture to the outputs. PERF-4: capture runs only while an
 * output is in a voice channel. OUT-1: every output hears the same mix.
 */
export class PlaybackManager {
  outputs: OutputManager;
  audioCaptureManager: AudioCaptureManagerMain;

  constructor(window: BrowserWindow) {
    // SEC-5: bot tokens live here, encrypted, not in the main window's storage.
    const tokens = new BotTokenStore(BotTokenStore.fileIn(app.getPath("userData")), safeStorage);
    this.outputs = new OutputManager(window, tokens);
    this.audioCaptureManager = new AudioCaptureManagerMain();
    this.outputs.on("activeChange", (active) => {
      if (active) {
        this.audioCaptureManager.startBroadcast();
      } else {
        this.audioCaptureManager.stopBroadcast();
      }
    });
    this.outputs.on("localMutedChange", (muted) => {
      this.audioCaptureManager.setLocalMuted(muted);
    });
    this.audioCaptureManager.on("packet", (packet) => {
      this.outputs.sendPacket(packet);
    });
  }

  destroy() {
    this.outputs.destroy();
    this.audioCaptureManager.destroy();
  }
}
