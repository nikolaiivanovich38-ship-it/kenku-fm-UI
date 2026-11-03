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

export function getSavedBounds(
  minWidth: number,
  minHeight: number,
): {
  bounds: Partial<Rectangle>;
  maximized: boolean;
} {
  const bounds = store().get("bounds");
  const maximized = store().get("maximized");
  const savedBounds: Partial<Rectangle> = {};
  if (bounds) {
    const area = screen.getDisplayMatching(bounds).workArea;
    // If the saved position still valid (the window is entirely inside the display area), use it.
    if (
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height
    ) {
      savedBounds.x = bounds.x;
      savedBounds.y = bounds.y;
    }
    // If the saved size is still valid, use it.
    if (bounds.width <= area.width || bounds.height <= area.height) {
      // If the saved width and height are smaller than the window min then return the window min
      savedBounds.width = Math.max(bounds.width, minWidth);
      savedBounds.height = Math.max(bounds.height, minHeight);
    }
  }
  return { bounds: savedBounds, maximized };
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
