import { app, BrowserWindow, safeStorage, type WebContents } from "electron";
import { BotTokenStore } from "../broadcast/botTokenStore";
import { OutputManager } from "../broadcast/OutputManager";
import { PlayerAudioBridge } from "../broadcast/playerAudioBridge";
import { AudioCaptureManagerMain } from "./AudioCaptureManagerMain";

/**
 * Connects tab capture to the outputs. PERF-4: capture runs only while an
 * output is in a voice channel. OUT-5: every bot in a voice channel is a room;
 * the capture window encodes one mix per room and each room's packets go to
 * that room's bot only. The player page sends each engine room's mix (and the
 * preview) to the capture window over a private channel (PlayerAudioBridge).
 */
export class PlaybackManager {
  outputs: OutputManager;
  audioCaptureManager: AudioCaptureManagerMain;
  /** OUT-5, PRV-1: the private channel between the player page and the capture window. */
  playerAudio = new PlayerAudioBridge();

  constructor(window: BrowserWindow) {
    // SEC-5: bot tokens live here, encrypted, not in the main window's storage.
    const tokens = new BotTokenStore(BotTokenStore.fileIn(app.getPath("userData")), safeStorage);
    this.outputs = new OutputManager(window, tokens);
    this.audioCaptureManager = new AudioCaptureManagerMain();
    this.playerAudio.setCapture(this.audioCaptureManager._browserWindow.webContents);
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
    this.outputs.on("roomsChange", (rooms) => {
      this.audioCaptureManager.setRooms(rooms.map((room) => room.botId));
      this.playerAudio.setRooms(rooms);
    });
    this.outputs.on("roomVolumeChange", (room, volume) => {
      this.audioCaptureManager.setRoomVolume(room, volume);
    });
    this.audioCaptureManager.on("packet", (packet, room) => {
      this.outputs.sendPacket(packet, room);
    });
  }

  /** The main window registered the player page (PLAYER_REGISTER_VIEW). */
  setPlayerView(view: WebContents) {
    this.playerAudio.setPlayer(view);
  }

  destroy() {
    this.playerAudio.destroy();
    this.outputs.destroy();
    this.audioCaptureManager.destroy();
  }
}
