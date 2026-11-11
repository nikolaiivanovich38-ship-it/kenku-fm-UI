/**
 * EDT-6: a new track's kind, guessed from its folder as the prototype does
 * (core.js importFiles): a folder named for ambience (Ambience, Atmospheres,
 * Beds) gives ambience, one named for effects (Effects, SFX, Foley) gives a
 * sound effect, anything else music. The game master can change it later.
 *
 * Only the folders from the one chosen down to the file count, nearest first:
 * "H:\Ambience project\Scores\theme.flac" added through the Scores folder is
 * music. One change from the prototype: "bed" must be a whole word, so a
 * "Bedtime Stories" album stays music.
 */
import path from "path";
import type { TrackKind } from "../types";

const AMBIENCE = /ambien|atmos|\bbeds?\b/i;
const EFFECTS = /effect|sfx|foley/i;

/** Windows paths (drive letter or \\server) are read as Windows paths on any computer, as in ../paths.ts. */
const flavourOf = (p: string) => (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") ? path.win32 : path.posix);

/** The kind of a sound in one folder name, or null when the name says nothing. */
export function kindOfFolderName(name: string): TrackKind | null {
  if (AMBIENCE.test(name)) return "amb";
  if (EFFECTS.test(name)) return "fx";
  return null;
}

/**
 * @param filePath the file's full path
 * @param chosenFolder the folder the game master added (for a single file, its own folder)
 */
export function guessKind(filePath: string, chosenFolder: string): TrackKind {
  const flavour = flavourOf(filePath);
  const relative = flavour.relative(chosenFolder, flavour.dirname(filePath));
  const below = relative === "" || relative.startsWith("..") ? [] : relative.split(flavour.sep);
  const folders = [flavour.basename(chosenFolder), ...below].reverse();
  for (const folder of folders) {
    const kind = kindOfFolderName(folder);
    if (kind) return kind;
  }
  return "music";
}
