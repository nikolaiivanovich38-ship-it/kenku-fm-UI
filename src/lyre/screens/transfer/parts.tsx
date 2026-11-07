/** What the three round 5 screens share: focus after a redraw, a dropped file's path. (Their trail is the shell's.) */
import React from "react";

/**
 * Focuses the control marked data-focus=`key` inside `within` once React has drawn it: the next step after an action
 * (Bring in after opening, Relink after looking). Only while focus is still where the action started (`from`, the
 * button pressed) or nowhere: a person who moved on meanwhile keeps their place.
 */
export function focusSoon(within: React.RefObject<HTMLElement>, key: string, from: Element | null = null): void {
  const tryFocus = (left: number) => {
    const now = document.activeElement;
    if (now && now !== document.body && now !== from) return;
    const el = within.current?.querySelector<HTMLElement>(`[data-focus="${key}"]`);
    if (el) el.focus();
    else if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
  };
  requestAnimationFrame(() => tryFocus(10));
}

type FilesBridge = { pathOf?: (file: File) => string };

/**
 * Where a dropped file or folder is on this computer: the Lyre page's preload asks Electron (webUtils.getPathForFile).
 * Without it (tests, the in-memory library) its name is used.
 */
export function pathOfDropped(file: File): string {
  const bridge = (window as unknown as { lyre?: { files?: FilesBridge } }).lyre?.files;
  return bridge?.pathOf?.(file) || file.name;
}
