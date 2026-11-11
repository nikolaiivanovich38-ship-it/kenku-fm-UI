/**
 * FND-16 step 2: what the Lyre page tells the main process about the window's own buttons (src/main/window/
 * windowFrame.ts, src/lyre/window/windowFrame.ts). Kept free of Electron imports.
 */

/** Lyre page to main process: the buttons' colours (send, one TitleBarColours). */
export const LYRE_TITLE_BAR = "LYRE_TITLE_BAR";
/** Lyre page to main process: maximise the window, or put it back (send, no arguments). */
export const LYRE_WINDOW_MAXIMISE = "LYRE_WINDOW_MAXIMISE";

export interface TitleBarColours {
  color: string;
  symbolColor: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Exactly { color, symbolColor }, each "#rrggbb". */
export function isTitleBarColours(value: unknown): value is TitleBarColours {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && typeof v.color === "string" && HEX.test(v.color) && typeof v.symbolColor === "string" && HEX.test(v.symbolColor);
}

