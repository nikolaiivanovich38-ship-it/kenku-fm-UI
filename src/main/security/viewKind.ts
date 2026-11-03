/**
 * SEC-3 / SEC-8: decide what kind of view the main window is asking to create.
 *
 * The main window passes a URL and, for the Kenku player only, the kind token
 * "player". It never passes a script path: the main process picks the
 * player's preload itself, so a page can never choose which privileged script
 * runs. The player kind is accepted only together with the player's own page.
 */
import { PLAYER_VIEW_KIND } from "./ipcChannels";

export type ViewKind = "player" | "tab" | "refused";

export function classifyViewRequest(
  url: string,
  requestedKind: unknown,
  playerUrl: string | undefined,
): ViewKind {
  if (requestedKind === undefined) {
    return "tab";
  }
  if (requestedKind === PLAYER_VIEW_KIND && playerUrl !== undefined && url === playerUrl) {
    return "player";
  }
  return "refused";
}
