import fs from "fs";
import { BrowserWindow } from "electron";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { LyreManager } from "./LyreManager";
import { PlaybackManager } from "./PlaybackManager";
import { PlayerManager } from "./PlayerManager";
import { WindowManager } from "./WindowManager";
import { DiagnosticsBridge } from "../diagnostics/diagnosticsBridge";
import type { LyreEvent } from "../../common/lyre/api";
import type { LyreInvoke } from "../../common/lyre/rpc";
import { computerSettingsFile, hasStreamingMode } from "../lyreApi/computerSettings";
import { SoundToDiscord } from "../soundToDiscord";
import { markTokenNoteSeen, moveOldWindowDataOnce, oldWindowRecordFile, type OldWindowRecord } from "../legacy/oldWindowMove";
import { readPageStorage } from "../legacy/pageStorage";
import { WindowFrame } from "../window/windowFrame";
import { RemoteOff } from "../remote/remoteOff";

/** True only in packages built with CUE_DESK_E2E_BUILD=1 (webpack.main.config.js). */
declare const __CUE_DESK_TEST_BUILD__: boolean;

/** The parts of Lyre's library (startLibrary.ts StartedLibrary) the window's managers use. */
export interface SessionLibrary {
  /** The library's folder (this-computer.json and old-window.json are kept there). */
  folder: string;
  service: { call: LyreInvoke };
  /** Hears every event of the library; answers a function that stops listening. */
  onEvent(listener: (event: LyreEvent) => void): () => void;
}

export interface SessionOptions {
  /** Lyre's library, when it started (src/index.ts). */
  library?: SessionLibrary;
  /** False for a test build's sample library, which has no old window behind it (default true). */
  moveOldWindowData?: boolean;
}

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
  /** FND-16: Settings › Sound to Discord, from this computer's settings to the capture window. */
  private soundToDiscord?: SoundToDiscord;
  private stopLibraryEvents?: () => void;
  private oldWindowMoveStarted = false;
  /** FND-16 step 2: the window's own buttons' colours, and maximise on a double-click of the strip. */
  private frame: WindowFrame;
  /** FND-16 step 6: remote control answers "off" until Stream Deck support (WP6). */
  private remote: RemoteOff;
  private readonly page: Electron.WebContents;
  private readonly joinPage = () => this.lyreManager.attachView(this.page);
  private readonly onPageLoaded = () => {
    this.joinPage();
    this.moveOldWindowData();
  };

  constructor(window: BrowserWindow, private readonly options: SessionOptions = {}) {
    this.page = window.webContents;
    this.frame = new WindowFrame(window);
    this.remote = new RemoteOff();
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
    const library = options.library;
    if (library) {
      this.soundToDiscord = new SoundToDiscord({
        file: computerSettingsFile(library.folder),
        apply: (mode) => this.playbackManager.audioCaptureManager.setStreamingMode(mode),
      });
      this.stopLibraryEvents = library.onEvent((event) => this.soundToDiscord?.onLibraryEvent(event));
      // FND-16: Got it on the note about the moved token is remembered for the next start.
      const recordFile = oldWindowRecordFile(library.folder);
      this.playbackManager.outputs.on("legacyTokenNoteSeen", () => {
        markTokenNoteSeen(recordFile).catch((error: unknown) => console.error("Could not remember that the token note was read", error));
      });
    }
    this.joinPage();
    this.page.on("did-finish-load", this.onPageLoaded);
    if (typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__) {
      // Test builds only: the specs' arriveFromKenkuFM (e2e/specs/support/target.ts).
      (globalThis as unknown as { __lyreLegacyTest: { arrive(from: unknown): Promise<void> } }).__lyreLegacyTest = {
        arrive: (from) => this.arriveFromKenkuFM(from as Parameters<SessionManager["arriveFromKenkuFM"]>[0]),
      };
    }
  }

  /**
   * FND-16: what the old main window kept in the page's storage is taken over once (legacy/oldWindowMove.ts), when
   * the page has first loaded (its storage can be read then). Not again on a reload.
   */
  private moveOldWindowData(): void {
    const library = this.options.library;
    if (!library || this.oldWindowMoveStarted || this.options.moveOldWindowData === false) return;
    this.oldWindowMoveStarted = true;
    void this.runOldWindowMove(library, () => readPageStorage(this.page, "persist:root"));
  }

  /** The move itself (legacy/oldWindowMove.ts), reading `read()`; then the note about a moved token, if it is due. */
  private async runOldWindowMove(library: SessionLibrary, read: () => Promise<unknown>): Promise<OldWindowRecord | null> {
    const computerFile = computerSettingsFile(library.folder);
    const outputs = this.playbackManager.outputs;
    const record = await moveOldWindowDataOnce({
      recordFile: oldWindowRecordFile(library.folder),
      read,
      hasStreamingMode: () => hasStreamingMode(computerFile),
      setStreamingMode: async (streamingMode) => {
        const result = (await library.service.call("settings", "setComputer", [{ streamingMode }]).catch((): null => null)) as { ok?: boolean } | null;
        return result?.ok === true;
      },
      importToken: (token) => {
        outputs.importLegacyToken(token);
        // The window may have shown already: the bot with the moved token logs in now.
        outputs.connectSaved();
      },
    });
    if (record?.tokenMoved && !record.tokenNoteSeen) outputs.setLegacyTokenNote(true);
    return record;
  }

  /**
   * Test builds only (e2e/specs/support/target.ts arriveFromKenkuFM): run the one-time move again as for someone coming
   * straight from Kenku FM, with a plain token if asked and these bookmarks, as if read from the old window's storage.
   * The record is made anew, so the page shows the result once it opens again.
   */
  async arriveFromKenkuFM(from: { plainToken?: boolean; bookmarks?: { title: string; url: string }[] }): Promise<void> {
    const library = this.options.library;
    if (!library) return;
    await fs.promises.rm(oldWindowRecordFile(library.folder), { force: true });
    const bookmarks = from.bookmarks ?? [];
    const raw = JSON.stringify({
      // Not shaped like a real token, so nothing mistakes the test's value for one.
      settings: JSON.stringify(from.plainToken ? { discordToken: "kenku-fm-plain-token-for-tests" } : {}),
      bookmarks: JSON.stringify({
        bookmarks: { byId: Object.fromEntries(bookmarks.map((b, i) => [`b${i}`, { id: `b${i}`, title: b.title, url: b.url }])), allIds: bookmarks.map((_, i) => `b${i}`) },
      }),
    });
    await this.runOldWindowMove(library, async () => raw);
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
    this.page.off("did-finish-load", this.onPageLoaded);
    this.stopLibraryEvents?.();
    this.frame.destroy();
    this.remote.destroy();
    this.playbackManager.destroy();
    this.viewManager.destroy();
    this.windowManager.destroy();
    this.playerManager.destroy();
    this.lyreManager.destroy();
    this.diagnostics.destroy();
  }
}
