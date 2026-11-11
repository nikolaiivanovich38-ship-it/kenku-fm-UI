import { BrowserWindow } from "electron";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { LyreManager } from "./LyreManager";
import { PlaybackManager } from "./PlaybackManager";
import { PlayerManager } from "./PlayerManager";
import { WindowManager } from "./WindowManager";
import { DiagnosticsBridge } from "../diagnostics/diagnosticsBridge";
import { WindowSettingsBridge } from "../windowSettings/windowSettingsBridge";

/**
 * The managers of the one window, made once for the window's whole life (src/index.ts). FND-16 (0.5.1): the window's
 * own page is the Lyre page (trusted as "lyre-view" before this is made); it is joined to the audio channel and the
 * outputs now and again each time it finishes loading, so a reload keeps the bots and their voice connections.
 */
export class SessionManager {
  private playbackManager: PlaybackManager;
  private playerManager: PlayerManager;
  private viewManager: BrowserViewManagerMain;
  private windowManager: WindowManager;
  /** WP5: the Lyre page. */
  private lyreManager: LyreManager;
  /** FND-9: Help › Save diagnostics. */
  private diagnostics: DiagnosticsBridge;
  /** OUT-8 (w6-rooms): the main window's Sound to Discord and Website tabs settings in Settings in Lyre. */
  private windowSettings: WindowSettingsBridge;
  private readonly page: Electron.WebContents;
  private readonly joinPage = () => this.lyreManager.attachView(this.page);

  constructor(window: BrowserWindow) {
    this.page = window.webContents;
    this.playbackManager = new PlaybackManager(window);
    this.lyreManager = new LyreManager();
    this.viewManager = new BrowserViewManagerMain(window);
    this.windowManager = new WindowManager(window);
    this.playerManager = new PlayerManager();
    // --- w3-host wiring --- the Lyre page takes the private audio channel and hears the outputs:
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
    this.joinPage();
    this.page.on("did-finish-load", this.joinPage);
  }

  /** FND-16: logs in every saved bot that has a token (src/index.ts calls this once the window shows). */
  connectSavedBots(): void {
    this.playbackManager.outputs.connectSaved();
  }

  /** PERF-6: lets the player save changes it is holding back; see saveBeforeClose.ts. */
  saveBeforeClose(): Promise<void> {
    return this.playerManager.saveBeforeClose();
  }

  destroy() {
    this.page.off("did-finish-load", this.joinPage);
    this.playbackManager.destroy();
    this.viewManager.destroy();
    this.windowManager.destroy();
    this.playerManager.destroy();
    this.lyreManager.destroy();
    this.diagnostics.destroy();
    this.windowSettings.destroy();
  }
}
