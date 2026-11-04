/**
 * The player's built-in background pictures, by name.
 *
 * Playlists and soundboards store a background either as one of these names
 * ("tavern") or as an address of their own (a file or web address). The
 * pictures are Kenku FM's, which Cue Desk may not ship: the main process
 * copies them from the user's installed Kenku FM into the data folder
 * (src/main/legacyBackgrounds) and hands the list over once, when the player
 * loads. Without them, the only background is a blank one.
 */
import blank from "../../assets/blank.png";

function loadBackgrounds(): Record<string, string> {
  let answer: unknown;
  try {
    answer = window.player?.getBackgrounds?.();
  } catch {
    answer = undefined;
  }
  const found: Record<string, string> = {};
  if (answer && typeof answer === "object" && !Array.isArray(answer)) {
    for (const [name, url] of Object.entries(answer)) {
      if (typeof url === "string" && url !== "") {
        found[name] = url;
      }
    }
  }
  // "blank" always stays: Cue Desk 0.1.0 saved it on every new playlist and
  // soundboard, and they must keep showing it (0.1.1 review).
  return { ...found, blank };
}

export const backgrounds: Record<string, string> = loadBackgrounds();

export type Background = keyof typeof backgrounds;

/** A random picture for a new playlist or soundboard; blank only when there is nothing else. */
export function getRandomBackground(): Background {
  const pictures = Object.keys(backgrounds).filter((key) => key !== "blank");
  const keys = pictures.length > 0 ? pictures : ["blank"];
  return keys[Math.floor(Math.random() * keys.length)] as Background;
}

export function isBackground(background: string): background is Background {
  return Object.prototype.hasOwnProperty.call(backgrounds, background);
}
