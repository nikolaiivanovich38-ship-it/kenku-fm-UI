/**
 * Round 10 (design/prototype/ROUND10.md, "Nothing drawn on top of anything else"; the prototype's r10fix.js): the
 * side panels sit beside the screen, which narrows. Two rules keep the screen usable:
 *   - the menu and the screen keep at least 600 px: when a second panel would leave them less, the panel opened
 *     first closes (Nik, 18 Nov: "the first one closes");
 *   - below 760 px of window a panel takes the whole window (side-panels.css), so a second one closes the first.
 */

/** The panels the host can show, one of each at a time. */
export type SidePanelKind = "addMusic" | "find" | "queue" | "trackPanel" | "help";

/** Which side of the screen a panel sits on. Only Add music can be docked at the left. */
export type SidePanelEdge = "left" | "right";

/** The menu and the screen (#app) keep this much width beside the panels. */
export const MIN_SCREEN_PX = 600;
/** Below this window width a side panel takes the whole window. */
export const NARROW_WINDOW_PX = 760;

/** The panels from left to right (the order R60-GAPS.md and the prototype give): Add music docked left sits before
 *  the menu, the others after the screen. */
export const SIDE_PANEL_ORDER = ["addMusic:left", "find", "queue", "trackPanel", "addMusic:right", "help"] as const;

/** Where a panel goes in SIDE_PANEL_ORDER. */
export function placeInOrder(kind: SidePanelKind, edge: SidePanelEdge): number {
  const key = kind === "addMusic" ? `addMusic:${edge}` : kind;
  return (SIDE_PANEL_ORDER as readonly string[]).indexOf(key);
}

/** The widths the room rule reads: the window (#work) and the menu with the screen (#app), in CSS pixels. */
export interface SidePanelRoom {
  window: number;
  screen: number;
}

/**
 * The panel that must close so the screen keeps its room, or null. `opened` lists the open panels in the order they
 * opened. A window 0 px wide has not been measured (a test, a page still loading): nothing closes then.
 */
export function panelToGiveWay(opened: readonly SidePanelKind[], room: SidePanelRoom): SidePanelKind | null {
  if (opened.length < 2 || room.window <= 0) return null;
  if (room.window < NARROW_WINDOW_PX || room.screen < MIN_SCREEN_PX) return opened[0];
  return null;
}
