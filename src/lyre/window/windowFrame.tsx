/**
 * FND-16 step 2 (0.5.1, design/prototype/ROUND8.md §1; the prototype's views/r8window.js): Lyre is the whole window.
 * Windows draws the window's own buttons (minimise, maximise, close) at the top right, over the right end of Lyre's
 * top strip (titleBarOverlay, src/main/window/windowFrame.ts). This keeps their space free and their colours right:
 *   - --wco-w and --wco-h on #app: the space the buttons take, in CSS pixels (so text size is already counted), from
 *     navigator.windowControlsOverlay, on start and whenever it changes. The strips keep it free (window.css). 0px
 *     where the window draws no buttons (macOS, a browser, a test).
 *   - the buttons take the colour of what is under them (each theme; Live's strip; Help open beside the screen).
 *   - a double-click on an empty part of a strip asks the main process to maximise or put back. Windows does that
 *     itself for a drag area and the page never hears a real one; the specs' clicks reach the page.
 */
import { useEffect, useLayoutEffect } from "react";

import type { LyreWindowBridge } from "./preloadWindow";

/** Where the strips are (window.css makes their empty parts drag the window). */
export const DRAG_AREAS = ".viewhead, .lv-top, .help-head, .rail .logo";
/** What in a strip stays itself: it clicks, types or shows hover text (the same list as window.css). */
export const NOT_DRAG =
  'a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=switch], [role=radio], [role=combobox], [tabindex]:not([tabindex="-1"]), [title], [contenteditable]';

/** The part of navigator.windowControlsOverlay this reads. */
export interface ControlsOverlay {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener?(type: "geometrychange", listener: () => void): void;
  removeEventListener?(type: "geometrychange", listener: () => void): void;
}

/** The space the window's buttons take at the top right, in CSS pixels; none when the window draws none. */
export function windowButtonsSpace(overlay: ControlsOverlay | undefined, innerWidth: number): { width: number; height: number } {
  if (!overlay?.visible) return { width: 0, height: 0 };
  const free = overlay.getTitlebarAreaRect();
  return { width: Math.max(0, Math.round(innerWidth - (free.x + free.width))), height: Math.max(0, Math.round(free.height)) };
}

/** A computed CSS colour as #rrggbb; null when it is see-through. */
export function hexColour(css: string): string | null {
  const parts = css.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 3 || (parts.length >= 4 && parts[3] < 0.9)) return null;
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function overlayOf(): ControlsOverlay | undefined {
  return (navigator as unknown as { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;
}

/** The colours of what shows under the buttons: the first solid background from there up, and its text colour. */
function coloursUnderButtons(width: number, height: number): { color: string; symbolColor: string } | null {
  if (typeof document.elementsFromPoint !== "function" || width === 0) return null;
  const under = document.elementsFromPoint(window.innerWidth - Math.max(2, width - 2), Math.min(2, height))[0];
  for (let node: Element | null = under ?? null; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const color = hexColour(style.backgroundColor);
    if (color) return { color, symbolColor: hexColour(getComputedStyle(under).color) ?? hexColour(style.color) ?? "#ffffff" };
  }
  const body = getComputedStyle(document.body);
  const color = hexColour(body.backgroundColor);
  return color ? { color, symbolColor: hexColour(body.color) ?? "#ffffff" } : null;
}

export interface WindowFrameProps {
  /** window.lyre.window; none outside the app (tests give their own). */
  bridge?: LyreWindowBridge | null;
  /** Anything that changes what is under the buttons (the theme, the screen, Help open); a change paints them again. */
  paintKey: string;
}

export function WindowFrame({ bridge = (window as unknown as { lyre?: { window?: LyreWindowBridge } }).lyre?.window ?? null, paintKey }: WindowFrameProps): null {
  // The space to keep free, now and whenever the window says it changed (resize, maximise, text size).
  useLayoutEffect(() => {
    const app = document.getElementById("app");
    const overlay = overlayOf();
    const place = () => {
      const { width, height } = windowButtonsSpace(overlay, window.innerWidth);
      app?.style.setProperty("--wco-w", `${width}px`);
      app?.style.setProperty("--wco-h", `${height}px`);
    };
    place();
    overlay?.addEventListener?.("geometrychange", place);
    window.addEventListener("resize", place);
    return () => {
      overlay?.removeEventListener?.("geometrychange", place);
      window.removeEventListener("resize", place);
    };
  }, []);

  // The buttons' colours: after what is under them has been drawn, and after a resize (Help moves beside or over).
  useEffect(() => {
    if (!bridge) return;
    let last = "";
    const paint = () => {
      const { width, height } = windowButtonsSpace(overlayOf(), window.innerWidth);
      const colours = coloursUnderButtons(width, height);
      const key = colours ? `${colours.color}${colours.symbolColor}` : "";
      if (colours && key !== last) {
        last = key;
        bridge.setTitleBar(colours);
      }
    };
    const frame = requestAnimationFrame(paint);
    // A screen's strip may arrive with its data a moment later.
    const later = setTimeout(paint, 400);
    window.addEventListener("resize", paint);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
      window.removeEventListener("resize", paint);
    };
  }, [bridge, paintKey]);

  // Double-click on an empty part of a strip: maximise, or put back.
  useEffect(() => {
    if (!bridge) return;
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(DRAG_AREAS) || target.closest(NOT_DRAG)) return;
      event.preventDefault();
      bridge.toggleMaximise();
    };
    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, [bridge]);

  return null;
}
