/**
 * SEC-3 / SEC-8: decide what kind of view the main window is asking to create.
 *
 * The main window passes a URL and, for one of the app's own pages, a kind
 * token: "player" (the old Kenku player) or "lyre" (the new interface, WP5).
 * It never passes a script path: the main process picks the page's preload
 * itself, so a page can never choose which privileged script runs. A kind is
 * accepted only together with that page's own address.
 */
import { LYRE_VIEW_KIND, PLAYER_VIEW_KIND } from "./ipcChannels";

export type ViewKind = "player" | "lyre" | "tab" | "refused";

/**
 * SEC-3: classify a request to create a view.
 * @param playerUrl the player page's address (PLAYER_WINDOW_WEBPACK_ENTRY)
 * @param lyreUrl the new interface page's address (LYRE_WINDOW_WEBPACK_ENTRY)
 * @returns "tab" for a website tab (no preload), "player" or "lyre" only when
 *   both the kind and the URL are exactly that page's own, otherwise
 *   "refused" (an unknown preload must never be loaded)
 */
export function classifyViewRequest(
  url: string,
  requestedKind: unknown,
  playerUrl: string | undefined,
  lyreUrl?: string,
): ViewKind {
  if (requestedKind === undefined) {
    return "tab";
  }
  if (requestedKind === PLAYER_VIEW_KIND && playerUrl !== undefined && url === playerUrl) {
    return "player";
  }
  if (requestedKind === LYRE_VIEW_KIND && lyreUrl !== undefined && url === lyreUrl) {
    return "lyre";
  }
  return "refused";
}
