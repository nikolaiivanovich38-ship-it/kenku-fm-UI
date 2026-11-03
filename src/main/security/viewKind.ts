/**
 * SEC-3: decide what kind of view the main window is asking to create.
 *
 * The renderer passes a URL and, for the Kenku player only, a preload script
 * path. A preload script has privileged access, so it is accepted only when
 * both the page and the script are exactly the player's own webpack entries.
 */
export type ViewKind = "player" | "tab" | "refused";

export interface PlayerEntry {
  url: string | undefined;
  preload: string | undefined;
}

export function classifyViewRequest(
  url: string,
  preload: string | undefined,
  player: PlayerEntry,
): ViewKind {
  if (!preload) {
    return "tab";
  }
  if (
    player.url !== undefined &&
    player.preload !== undefined &&
    url === player.url &&
    preload === player.preload
  ) {
    return "player";
  }
  return "refused";
}
