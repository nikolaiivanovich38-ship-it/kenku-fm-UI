import { useSyncExternalStore } from "react";

/**
 * UX finding 1: websites and the player are WebContentsViews drawn by
 * Electron on top of the main window's HTML, so a dialog, menu or popover in
 * the main window would be hidden behind them. While one is open, the tabs
 * hide the current view (or, for a side panel such as Settings, move it to
 * the panel's right edge) and show it again when it closes.
 *
 * Every MUI Dialog, Menu, Popover, Select list and temporary Drawer renders a
 * `.MuiModal-root` portal at the end of <body>, so watching <body> covers all
 * of them, including ones added later, without each component opting in.
 */
export type ViewOverlay = {
  /** A dialog, menu or popover is open: the view must not be shown. */
  hidden: boolean;
  /** The view must start at least this far from the window's left edge (px). */
  inset: number;
};

/**
 * Put this attribute on a full-height panel that sits on the left of the
 * window (Settings, the bookmark and folder editors): the view moves right
 * of it instead of being hidden, so the player stays in sight.
 */
export const SIDE_PANEL_ATTRIBUTE = "data-side-panel";

/** Spread on a Dialog to make it a side panel (see SIDE_PANEL_ATTRIBUTE). */
export const sidePanelProps = { [SIDE_PANEL_ATTRIBUTE]: "" } as Record<string, string>;

const NO_OVERLAY: ViewOverlay = { hidden: false, inset: 0 };

/** What the open dialogs, menus and side panels need from the view now. */
export function readViewOverlay(doc: Document): ViewOverlay {
  let hidden = false;
  let inset = 0;
  for (const root of Array.from(doc.body.children)) {
    if (!root.classList.contains("MuiModal-root") || root.classList.contains("MuiModal-hidden")) {
      continue;
    }
    if (root.hasAttribute(SIDE_PANEL_ATTRIBUTE)) {
      inset = Math.max(inset, Math.ceil(root.getBoundingClientRect().right));
    } else {
      hidden = true;
    }
  }
  return { hidden, inset };
}

function same(a: ViewOverlay, b: ViewOverlay) {
  return a.hidden === b.hidden && a.inset === b.inset;
}

/**
 * Call `onChange` whenever dialogs open or close, or the window is resized
 * (a side panel's width depends on the window's).
 * @returns a function that stops watching
 */
export function watchViewOverlay(
  doc: Document,
  win: Pick<Window, "addEventListener" | "removeEventListener">,
  onChange: (overlay: ViewOverlay) => void,
): () => void {
  let last = readViewOverlay(doc);
  const check = () => {
    const next = readViewOverlay(doc);
    if (!same(next, last)) {
      last = next;
      onChange(next);
    }
  };
  // Portals are direct children of <body>; a closed but kept dialog only changes its class.
  const observer = new MutationObserver(check);
  observer.observe(doc.body, { childList: true, attributes: true, subtree: false, attributeFilter: ["class"] });
  for (const child of Array.from(doc.body.children)) {
    observer.observe(child, { attributes: true, attributeFilter: ["class"] });
  }
  const childObserver = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          observer.observe(node, { attributes: true, attributeFilter: ["class"] });
        }
      });
    }
  });
  childObserver.observe(doc.body, { childList: true });
  win.addEventListener("resize", check);
  return () => {
    observer.disconnect();
    childObserver.disconnect();
    win.removeEventListener("resize", check);
  };
}

// One shared watcher for the main window, started on first use.
let current: ViewOverlay = NO_OVERLAY;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | undefined;

function subscribe(listener: () => void) {
  if (!stopWatching) {
    current = readViewOverlay(document);
    stopWatching = watchViewOverlay(document, window, (overlay) => {
      current = overlay;
      listeners.forEach((notify) => notify());
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopWatching) {
      stopWatching();
      stopWatching = undefined;
    }
  };
}

/** The overlay right now, for code outside React (placing a new view). */
export function currentViewOverlay(): ViewOverlay {
  return stopWatching ? current : readViewOverlay(document);
}

/** The overlay, kept up to date as dialogs open and close. */
export function useViewOverlay(): ViewOverlay {
  return useSyncExternalStore(subscribe, () => current);
}
