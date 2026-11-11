import { BrowserWindow } from "electron";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { LyreManager } from "./LyreManager";
import { PlaybackManager } from "./PlaybackManager";
import { PlayerManager } from "./PlayerManager";
import { WindowManager } from "./WindowManager";
import { DiagnosticsBridge } from "../diagnostics/diagnosticsBridge";
import { WindowSettingsBridge } from "../windowSettings/windowSettingsBridge";

export class SessionManager {
  private playbackManager: PlaybackManager;
  private playerManager: PlayerManager;
  private viewManager: BrowserViewManagerMain;
  private windowManager: WindowManager;
  /** WP5: the new interface page in the "Lyre" tab. */
  private lyreManager: LyreManager;
  /** FND-9: Help › Save diagnostics. */
  private diagnostics: DiagnosticsBridge;
  /** OUT-8 (w6-rooms): the main window's Sound to Discord and Website tabs settings in Settings in Lyre. */
  private windowSettings: WindowSettingsBridge;

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
    // --- w4-guide wiring --- Save diagnostics reads the windows' settings and the bots' state:
    this.diagnostics = new DiagnosticsBridge({
      window,
      lyreView: () => this.lyreManager.getView(),
      outputs: () => this.playbackManager.outputs.state(),
    });
    // --- w6-rooms wiring ---
    this.windowSettings = new WindowSettingsBridge({ mainWindow: () => (window.isDestroyed() ? undefined : window.webContents), lyreView: () => this.lyreManager.getView() });
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
    this.diagnostics.destroy();
    this.windowSettings.destroy();
  }
}
