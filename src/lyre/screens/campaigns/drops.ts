/**
 * Audio files and folders dropped from the computer onto a scene (the prototype's L.filesFromDrop and the session
 * planner's drop handlers): only drags that carry files are taken; reordering drags and dragged text are left alone.
 */
import type React from "react";

const AUDIO = /\.(flac|mp3|wav|ogg|m4a|aac|wma|aif|aiff|opus)$/i;
/** A name with an extension that is not audio (notes.txt) is left out; a name without one may be a folder. */
const OTHER_FILE = /\.[a-z0-9]{1,5}$/i;

/** True when the drag carries files (not text, a link or a row being reordered). */
export function carriesFiles(event: React.DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

/** How the page learns where a dropped file is on the computer (the page itself is not told). */
type PathOf = (file: File) => string;

/**
 * The file's place on the computer, from the Lyre page's preload (`window.lyre.files.pathOf`, Electron's
 * webUtils.getPathForFile). Without it (tests on the in-memory library, which takes names), the file's own name.
 */
export const pathOfDroppedFile: PathOf = (file) => {
  const pathOf = (window as unknown as { lyre?: { files?: { pathOf?: PathOf } } }).lyre?.files?.pathOf;
  return pathOf?.(file) || file.name;
};

/** The dropped files and folders worth importing: audio files, and folders (Lyre walks them). */
export function droppedPaths(event: React.DragEvent, pathOf: PathOf = pathOfDroppedFile): string[] {
  const files = Array.from(event.dataTransfer?.files ?? []);
  return files.filter((f) => AUDIO.test(f.name) || !OTHER_FILE.test(f.name)).map(pathOf);
}

/** Where in a music list a drop lands: before the row under the pointer's upper half, else at the end. */
export function dropIndex(box: HTMLElement, clientY: number): { index: number; row: HTMLElement | null } {
  const rows = Array.from(box.querySelectorAll<HTMLElement>(".cp-items > .cp-it"));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { index: i, row: rows[i] };
  }
  return { index: rows.length, row: null };
}
