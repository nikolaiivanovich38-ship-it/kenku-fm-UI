/**
 * UX-11 (design round 7, r7shell.js): Look and feel › Display, kept per computer (`settings.setComputer`). Density and
 * high contrast mark the page (`data-density`, `data-contrast` on <html>, read by ui.css); the text size zooms the
 * whole page, so text, controls and the space around them grow together (the contracts: webFrame.setZoomFactor).
 */
import type { DisplaySettings } from "../../common/domain";

/** The page's zoom for a text size in per cent, kept between 100 and 200 %. */
export function zoomFactorOf(textSize: number): number {
  if (!Number.isFinite(textSize)) return 1;
  return Math.min(2, Math.max(1, textSize / 100));
}

/** Shows the display settings on the page; `zoom` is the page's (window.lyre.display), absent in tests. */
export function applyDisplay(display: DisplaySettings, zoom?: (factor: number) => void): void {
  const root = document.documentElement;
  root.dataset.density = display.density;
  if (display.highContrast) root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  zoom?.(zoomFactorOf(display.textSize));
}

/** The preload's `display` (preload.ts): zooming the page only, within 1 to 2. No IPC. */
export function createLyreDisplayBridge(frame: { setZoomFactor(factor: number): void }) {
  return {
    setZoom(factor: number): void {
      if (typeof factor !== "number" || !Number.isFinite(factor)) return;
      frame.setZoomFactor(Math.min(2, Math.max(1, factor)));
    },
  };
}

export type LyreDisplayBridge = ReturnType<typeof createLyreDisplayBridge>;

/** The page's zoom, when the page has the bridge (not in component tests or the browser preview). */
export function pageZoom(): ((factor: number) => void) | undefined {
  const bridge = (window as unknown as { lyre?: { display?: LyreDisplayBridge } }).lyre?.display;
  return bridge ? (factor) => bridge.setZoom(factor) : undefined;
}
