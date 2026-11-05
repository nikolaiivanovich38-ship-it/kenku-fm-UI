/**
 * Files and folders dropped from the computer (the prototype's L.filesFromDrop): the paths to import.
 *
 * The page cannot read a dropped file's place on disk by itself; the Lyre page's preload can (Electron's
 * webUtils.getPathForFile), and exposes it as `window.lyre.files.pathOf` once wired (see the w3-library report).
 * Without it a file's name is used, which the in-memory library of the tests and the demo takes as a path.
 * Folders are passed on whole: the importer walks them and keeps the audio files.
 */

/** Files Lyre offers to import: the importer refuses WMA and AIFF in plain words, so they are passed on too. */
const AUDIO = /\.(flac|mp3|wav|ogg|oga|opus|m4a|aac|wma|aif|aiff)$/i;

export function hasFiles(event: DragEvent | React.DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

type FilesBridge = { pathOf?: (file: File) => string };
function pathOf(file: File): string {
  const bridge = (window as unknown as { lyre?: { files?: FilesBridge } }).lyre?.files;
  return bridge?.pathOf?.(file) || file.name;
}

/** The paths to import from a drop: audio files and folders; other files (notes.txt) are left out. */
export function droppedPaths(dataTransfer: DataTransfer | null | undefined): string[] {
  if (!dataTransfer) return [];
  const items = Array.from(dataTransfer.items ?? []);
  const files = Array.from(dataTransfer.files ?? []);
  const paths: string[] = [];
  files.forEach((file, i) => {
    const entry = (items[i] as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null })?.webkitGetAsEntry?.();
    if (entry?.isDirectory || AUDIO.test(file.name)) paths.push(pathOf(file));
  });
  return paths;
}

export const NOTHING_TO_ADD = "Lyre plays audio files (FLAC, MP3, WAV, OGG). Nothing was added.";
