import Case from "case";

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

export function cleanFileName(name: string): string {
  // Remove file extension
  let clean = name.substring(0, name.lastIndexOf(".")) || name;
  // Clean string
  clean = clean.replace(/ +/g, " ");
  clean = clean.trim();
  // Capitalize and remove underscores
  clean = Case.capital(clean);

  return clean;
}
