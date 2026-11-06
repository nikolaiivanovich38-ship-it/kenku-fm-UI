/**
 * FND-9: Help › Save diagnostics, the main process's side (docs/security.md "w4-guide"). The Lyre page asks
 * (LYRE_DIAGNOSTICS_SAVE, no arguments); the main process asks the game master for a folder, gathers what it knows
 * (diagnosticsZip.ts sources), writes the zip there and answers with the folder's and the file's names only.
 * LYRE_DIAGNOSTICS_SHOW (no arguments) shows the last saved file in its folder; the page never names a path.
 * Test builds of the sample library save into the data folder's Documents without asking (Playwright cannot click
 * native dialogs), as the transfer screens' dialogs do.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { app, dialog, ipcMain, shell, type BrowserWindow, type WebContents } from "electron";
import type { OutputsState } from "../../common/outputs";
import type { DiagnosticsResult } from "../../common/lyreDiagnostics";
import { guardIpc } from "../security/ipcGuard";
import { wantsSeededLibrary } from "../lyreApi/wiring";
import { saveDiagnostics, type DiagnosticsSources } from "./diagnosticsZip";
import { diagnosticsLog } from "./diagnosticsLog";

declare const __CUE_DESK_TEST_BUILD__: boolean;

/** How long a page may take to answer with its settings before the zip is written without them. */
const PAGE_WAIT_MS = 2000;

export interface DiagnosticsDeps {
  window: BrowserWindow;
  lyreView: () => WebContents | undefined;
  outputs: () => OutputsState;
}

/** One value from a page's own storage, read by the main process (never sent by the page). */
async function pageStorage(contents: WebContents | undefined, key: string): Promise<unknown> {
  if (!contents || contents.isDestroyed()) return null;
  const read = contents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`, false) as Promise<unknown>;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PAGE_WAIT_MS));
  const raw = await Promise.race([read, timeout]);
  return typeof raw === "string" ? JSON.parse(raw) : null;
}

/** The main window's Settings (remote, streaming, address bar): only the "settings" part of its saved state. */
async function mainWindowSettings(window: BrowserWindow): Promise<unknown> {
  const root = (await pageStorage(window.isDestroyed() ? undefined : window.webContents, "persist:root")) as Record<string, unknown> | null;
  return root && typeof root.settings === "string" ? JSON.parse(root.settings) : null;
}

/** Each bot's state in plain values: no token, no server, channel or people's names. */
function botsOf(state: OutputsState) {
  return {
    encryption: state.encryption,
    thisComputerMuted: state.local.muted,
    bots: state.bots.map((b) => ({
      name: b.name,
      hasToken: b.hasToken,
      tokenRemembered: b.tokenRemembered,
      status: b.status,
      error: b.error ?? null,
      notice: b.notice ?? null,
      servers: b.guilds.length,
      voice: b.voice.map((v) => v.status),
      muted: b.muted,
      volume: b.volume ?? 1,
    })),
  };
}

export function diagnosticsSources(deps: DiagnosticsDeps): DiagnosticsSources {
  return {
    about: () => ({
      lyre: app.getVersion(),
      packaged: String(app.isPackaged),
      electron: process.versions.electron ?? "",
      chrome: process.versions.chrome ?? "",
      os: `${os.type()} ${os.release()}`,
      osVersion: typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "",
      arch: os.arch(),
      language: app.getLocale(),
      memory: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    }),
    log: () => diagnosticsLog.log.lines(),
    blocked: () => diagnosticsLog.blocked.lines(),
    settings: async () => ({
      mainWindow: await mainWindowSettings(deps.window).catch((e: unknown) => ({ unreadable: String(e) })),
      lyrePage: await pageStorage(deps.lyreView(), "lyre-shell").catch((e: unknown) => ({ unreadable: String(e) })),
      discord: botsOf(deps.outputs()),
    }),
    home: os.homedir(),
  };
}

export class DiagnosticsBridge {
  private readonly ipc = guardIpc(ipcMain);
  private lastSaved: string | null = null;

  constructor(private readonly deps: DiagnosticsDeps) {
    this.ipc.handle("LYRE_DIAGNOSTICS_SAVE", () => this.save());
    this.ipc.on("LYRE_DIAGNOSTICS_SHOW", () => {
      if (this.lastSaved && fs.existsSync(this.lastSaved)) shell.showItemInFolder(this.lastSaved);
    });
  }

  private async chooseFolder(): Promise<string | null> {
    const testBuild = typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__;
    if (wantsSeededLibrary(process.env, testBuild)) {
      const folder = path.join(app.getPath("userData"), "Documents");
      await fs.promises.mkdir(folder, { recursive: true });
      return folder;
    }
    const window = this.deps.window.isDestroyed() ? undefined : this.deps.window;
    const options: Electron.OpenDialogOptions = {
      title: "Save diagnostics in…",
      buttonLabel: "Save here",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    };
    const answer = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return answer.canceled ? null : (answer.filePaths[0] ?? null);
  }

  async save(): Promise<DiagnosticsResult> {
    const folder = await this.chooseFolder();
    if (!folder) return { ok: false, cancelled: true };
    try {
      const file = await saveDiagnostics({ folder, sources: diagnosticsSources(this.deps) });
      this.lastSaved = file;
      return { ok: true, folder: path.basename(folder) || folder, file: path.basename(file) };
    } catch (error) {
      console.error("Could not save diagnostics", error);
      return { ok: false, cancelled: false, message: "Lyre could not write there. Try another folder." };
    }
  }

  destroy(): void {
    this.ipc.dispose();
  }
}
