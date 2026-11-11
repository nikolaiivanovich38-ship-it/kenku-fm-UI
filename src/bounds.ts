import { BrowserWindow, Rectangle, screen } from "electron";
import Store from "electron-store";
import throttle from "lodash.throttle";

type BoundsStore = Store<{
  bounds: Rectangle;
  maximized: boolean;
}>;

let cachedStore: BoundsStore | null = null;

/**
 * FND-1: open config.json on first use, not on import. electron-store reads
 * and may write the file as soon as it is created, which must not happen
 * before the Kenku FM carry-over has copied the old config.json across.
 */
function store(): BoundsStore {
  cachedStore ??= new Store();
  return cachedStore;
}

/**
 * FND-16: the window's saved place and size, brought inside the display's work area (the screen less its taskbar).
 * Nik's 0.5.0 window ran past a bottom taskbar and the screen's right edge; a size larger than the work area (for
 * example a maximised window's, which includes Windows' invisible borders) is shrunk to fit it, and a window hanging
 * off an edge is moved back inside, keeping its size. Never smaller than Lyre's smallest size unless the screen is.
 */
export function clampToWorkArea(bounds: Rectangle, area: Rectangle, minWidth: number, minHeight: number): Rectangle {
  const width = Math.min(Math.max(bounds.width, minWidth), area.width);
  const height = Math.min(Math.max(bounds.height, minHeight), area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function getSavedBounds(
  minWidth: number,
  minHeight: number,
): {
  bounds: Partial<Rectangle>;
  maximized: boolean;
} {
  const bounds = store().get("bounds");
  const maximized = store().get("maximized");
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(isNumber)) return { bounds: {}, maximized };
  return { bounds: clampToWorkArea(bounds, screen.getDisplayMatching(bounds).workArea, minWidth, minHeight), maximized };
}

export function saveWindowBounds(window: BrowserWindow) {
  function handleResizeOrMove() {
    if (!window.isDestroyed()) {
      store().set("bounds", window.getNormalBounds());
      store().set("maximized", false);
    }
  }
  const throttledResizeOrMove = throttle(handleResizeOrMove, 1000);
  window.on("resized", throttledResizeOrMove);
  window.on("moved", throttledResizeOrMove);

  function handleMaximize() {
    store().set("maximized", true);
  }
  function handleUnmaximize() {
    store().set("maximized", false);
  }
  window.on("maximize", handleMaximize);
  window.on("unmaximize", handleUnmaximize);
}
