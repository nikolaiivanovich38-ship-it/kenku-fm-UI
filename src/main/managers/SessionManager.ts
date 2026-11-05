import { BrowserWindow } from "electron";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { LyreManager } from "./LyreManager";
import { PlaybackManager } from "./PlaybackManager";
import { PlayerManager } from "./PlayerManager";
import { WindowManager } from "./WindowManager";

export class SessionManager {
  private playbackManager: PlaybackManager;
  private playerManager: PlayerManager;
  private viewManager: BrowserViewManagerMain;
  private windowManager: WindowManager;
  /** WP5: the new interface page in the "Lyre" tab. */
  private lyreManager: LyreManager;

  constructor(window: BrowserWindow) {
    this.playbackManager = new PlaybackManager(window);
    this.lyreManager = new LyreManager();
    this.viewManager = new BrowserViewManagerMain(window, {
      onLyreView: (view) => this.lyreManager.attachView(view),
    });
    this.windowManager = new WindowManager(window);
    this.playerManager = new PlayerManager();
    // --- w3-host wiring --- the new interface page takes the private audio channel:
    this.lyreManager.onAttachView = (view) => this.playbackManager.setLyreView(view);
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
    this.lyreManager.destroy();
  }
}
