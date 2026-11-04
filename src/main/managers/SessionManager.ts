import { BrowserWindow } from "electron";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { PlaybackManager } from "./PlaybackManager";
import { PlayerManager } from "./PlayerManager";
import { WindowManager } from "./WindowManager";

export class SessionManager {
  private playbackManager: PlaybackManager;
  private playerManager: PlayerManager;
  private viewManager: BrowserViewManagerMain;
  private windowManager: WindowManager;

  constructor(window: BrowserWindow) {
    this.playbackManager = new PlaybackManager(window);
    this.viewManager = new BrowserViewManagerMain(window);
    this.windowManager = new WindowManager(window);
    this.playerManager = new PlayerManager();
    // OUT-5, PRV-1: the player page's private audio channel to the capture window.
    this.playerManager.onRegisterView = (view) => this.playbackManager.setPlayerView(view);
  }

  /** PERF-6: lets the player save changes it is holding back; see saveBeforeClose.ts. */
  saveBeforeClose(): Promise<void> {
    return this.playerManager.saveBeforeClose();
  }

  destroy() {
    this.playbackManager.destroy();
    this.viewManager.destroy();
    this.windowManager.destroy();
    this.playerManager.destroy();
  }
}
