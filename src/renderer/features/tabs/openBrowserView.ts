import type { BrowserViewKind } from "../../../preload/managers/BrowserViewManagerPreload";
import { getBounds } from "./getBounds";

/**
 * True for an id of a view the main process actually created. Electron's
 * webContents ids are positive integers; the main process answers a refused
 * request with -1 (`REFUSED_VIEW_ID`), which is also the player's "not
 * created yet" id, so it must never reach the tabs or player state.
 */
export function isCreatedViewId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

/**
 * Ask the main process for a new website view (or, with kind `"player"`,
 * the player view) filling the content area.
 * @returns the new view's id, or undefined when the request was refused
 */
export async function openBrowserView(
  url: string,
  kind?: BrowserViewKind,
): Promise<number | undefined> {
  const bounds = getBounds();
  const id = await window.kenku.createBrowserView(
    url,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    kind,
  );
  if (!isCreatedViewId(id)) {
    console.error(`The view for ${url || "a new tab"} was not created`);
    return undefined;
  }
  return id;
}
