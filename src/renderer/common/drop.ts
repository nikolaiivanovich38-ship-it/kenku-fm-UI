
export function encodeFilePath(path: string) {
  return `file://${encodeURIComponent(path)
    .replace(/(%2F)|(%5C)/g, "/")
    .replace(/%3A/g, ":")}`;
}

/**
 * File URL of the first file dropped on a URL field, or undefined.
 * Returns undefined instead of throwing when there is no DataTransfer or
 * when the window has no `player` bridge (the main browser window), so a
 * drop can never break the field.
 */
export function getDropURL(
  dataTransfer: Pick<DataTransfer, "files"> | null | undefined
): string | undefined {
  const file = dataTransfer?.files?.[0];
  const getPathForFile = window.player?.getPathForFile;
  if (!file || !getPathForFile) {
    return undefined;
  }
  const path = getPathForFile(file);
  return path ? encodeFilePath(path) : undefined;
}

/**
 * A track or sound title from its file name: the name without its extension,
 * underscores read as spaces, spaces tidied. Capitals and punctuation are
 * kept exactly, because game masters write cue notes into their file names
 * ("Heroic Sting - short rise, don't loop"). Kenku FM title-cased names and
 * dropped punctuation; Lyre does not.
 */
export function cleanFileName(name: string): string {
  const withoutExtension = name.substring(0, name.lastIndexOf(".")) || name;
  return withoutExtension.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
