import { app, safeStorage, type WebContents } from "electron";
import { BotTokenStore, wantsFakeKeyring, type SafeStorageLike } from "../broadcast/botTokenStore";
import { OutputManager } from "../broadcast/OutputManager";
import { LyreOutputsBridge } from "../broadcast/lyreOutputsBridge";
import { PlayerAudioBridge } from "../broadcast/playerAudioBridge";
import { AudioCaptureManagerMain } from "./AudioCaptureManagerMain";
import { wantsPrototypeDiscord } from "../broadcast/discordDriver";

/** True only in packages built with CUE_DESK_E2E_BUILD=1 (webpack.main.config.js). */
declare const __CUE_DESK_TEST_BUILD__: boolean;

/** Electron's safeStorage; in test builds asked for it, a fake one (a test machine has no keyring). */
function keyring(): SafeStorageLike {
  if (typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__ && wantsFakeKeyring(process.env, __CUE_DESK_TEST_BUILD__)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("../broadcast/testing/fakeKeyring") as typeof import("../broadcast/testing/fakeKeyring")).fakeKeyring;
  }
  return safeStorage;
}

/**
 * Connects tab capture to the outputs. PERF-4: capture runs only while an
 * output is in a voice channel. OUT-5: every bot in a voice channel is a room;
 * the capture window encodes one mix per room and each room's packets go to
 * that room's bot only. The Lyre page sends each engine room's mix (and the
 * preview) to the capture window over a private channel (PlayerAudioBridge).
 */
export class PlaybackManager {
  outputs: OutputManager;
  audioCaptureManager: AudioCaptureManagerMain;
  /** OUT-5, PRV-1: the private channel between the Lyre page and the capture window. */
  playerAudio = new PlayerAudioBridge();
  /** w4-outputs: the Lyre page's Outputs screen reads and moves the bots through this. */
  lyreOutputs: LyreOutputsBridge;

  constructor() {
    // SEC-5: bot tokens live here, encrypted, not in the main window's storage.
    const tokens = new BotTokenStore(BotTokenStore.fileIn(app.getPath("userData")), keyring());
    this.outputs = new OutputManager(tokens);
    this.lyreOutputs = new LyreOutputsBridge(this.outputs);
    if (typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__ && wantsPrototypeDiscord(process.env, __CUE_DESK_TEST_BUILD__)) {
      // Test builds only (w4-outputs): the acceptance specs' bots on the prototype's Discord.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { startPrototypeOutputs } = require("../broadcast/testing/prototypeWorld") as typeof import("../broadcast/testing/prototypeWorld");
      startPrototypeOutputs(this.outputs);
    }
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

  /** The Lyre page (role "lyre-view", the window's own page) opened or loaded again: it takes the private channel. */
  setLyreView(view: WebContents) {
    this.playerAudio.setLyre(view);
    this.lyreOutputs.setView(view);
  }

  destroy() {
    this.lyreOutputs.destroy();
    this.playerAudio.destroy();
    this.outputs.destroy();
    this.audioCaptureManager.destroy();
  }
}
