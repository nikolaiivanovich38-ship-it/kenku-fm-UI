/**
 * FND-16 step 2 (0.5.1, design/prototype/ROUND8.md §1): Lyre is the whole window. Windows (and Linux) draw the
 * window's own buttons (minimise, maximise, close) at the top right, over the right end of Lyre's top strip
 * (Electron's titleBarOverlay); the Lyre page keeps that space free (src/lyre/window/windowFrame.ts) and drags the
 * window by the strips' empty parts. Two guarded channels from the Lyre page:
 *   LYRE_TITLE_BAR        { color, symbolColor }: the buttons take the colour of what is under them (each theme, Help
 *                         open beside the screen)
 *   LYRE_WINDOW_MAXIMISE  maximise or put back: a double-click on a drag area that reached the page (the specs'
 *                         clicks; Windows handles a real one itself and the page never hears it)
 * Until 0.5.1 the old main window's tab bar drew the drag area and its own buttons (WindowManager.ts).
 */
import { ipcMain } from "electron";

import { guardIpc } from "../security/ipcGuard";
import type { TitleBarColours } from "../../common/windowFrame";

export { isTitleBarColours } from "../../common/windowFrame";

/** The buttons' height in screen pixels: Windows' usual title bar (the strip is 44 px; ROUND8.md question 2). */
export const TITLE_BAR_HEIGHT = 36;

/** Fern and Brass (the default theme) until the page says otherwise: --bg and --ink in src/lyre/styles/tokens.css. */
const FIRST_COLOURS = { color: "#0d1d18", symbolColor: "#f1e4c8" };

/** The BrowserWindow options for the frame on this platform (macOS keeps its own title bar; Lyre ships for Windows). */
export function windowFrameOptions(platform: NodeJS.Platform = process.platform): Pick<Electron.BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  if (platform === "darwin") return {};
  return { titleBarStyle: "hidden", titleBarOverlay: { ...FIRST_COLOURS, height: TITLE_BAR_HEIGHT } };
}

/** The parts of BrowserWindow the frame uses. */
export interface FrameWindow {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  maximize(): void;
  unmaximize(): void;
  setTitleBarOverlay?(options: Electron.TitleBarOverlayOptions): void;
}

export class WindowFrame {
  /** SEC-8: each channel accepts only the Lyre page, with the arguments IPC_CHANNELS names. */
  private ipc = guardIpc(ipcMain);

  constructor(private readonly window: FrameWindow) {
    this.ipc.on("LYRE_TITLE_BAR", (_event, colours: TitleBarColours) => {
      if (this.window.isDestroyed()) return;
      // Not on macOS, and only where the window has the overlay.
      this.window.setTitleBarOverlay?.({ color: colours.color, symbolColor: colours.symbolColor, height: TITLE_BAR_HEIGHT });
    });
    this.ipc.on("LYRE_WINDOW_MAXIMISE", () => {
      if (this.window.isDestroyed()) return;
      if (this.window.isMaximized()) this.window.unmaximize();
      else this.window.maximize();
    });
  }

  destroy(): void {
    this.ipc.dispose();
  }
}
