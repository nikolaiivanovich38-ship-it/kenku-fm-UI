/**
 * File paths relative to library roots (DAT-8): a track under a root such as
 * "Soundtracks" = H:\Audio\Soundtracks stores "Witcher 3/Silver for Monsters.flac",
 * so moving the whole folder only needs the root changed.
 *
 * The rules follow the style of the root path, not the computer running the
 * tests: a path with a drive letter or starting with \\ is a Windows path
 * (case-insensitive, either slash), anything else is a POSIX path.
 */
import path from "path";

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

function flavourOf(p: string) {
  return isWindowsPath(p) ? path.win32 : path.posix;
}

/** The last part of a path ("tavern.mp3"), for either style. */
export function fileNameOf(p: string): string {
  return flavourOf(p).basename(p);
}

/** Whether `p` is an absolute path in either style. */
export function isAbsolutePath(p: string): boolean {
  return isWindowsPath(p) || path.posix.isAbsolute(p);
}

/**
 * The part of `absolutePath` below `rootPath` with "/" separators, or null when
 * the file is not inside the root.
 */
export function relativeToRoot(rootPath: string, absolutePath: string): string | null {
  if (isWindowsPath(rootPath) !== isWindowsPath(absolutePath)) return null;
  const flavour = flavourOf(rootPath);
  const root = flavour.resolve(rootPath);
  const file = flavour.resolve(absolutePath);
  const relative = flavour.relative(root, file);
  if (relative === "" || relative.startsWith("..") || flavour.isAbsolute(relative)) return null;
  return relative.split(flavour.sep).join("/");
}

/** Joins a root and a stored relative path back into an absolute path. */
export function joinRoot(rootPath: string, relative: string): string {
  const flavour = flavourOf(rootPath);
  return flavour.join(rootPath, ...relative.split("/"));
}

/** Picks the root holding `absolutePath`; the deepest root wins when roots nest. */
export function findRoot<T extends { path: string }>(
  roots: readonly T[],
  absolutePath: string,
): { root: T; relative: string } | null {
  let best: { root: T; relative: string } | null = null;
  for (const root of roots) {
    const relative = relativeToRoot(root.path, absolutePath);
    if (relative !== null && (best === null || root.path.length > best.root.path.length)) {
      best = { root, relative };
    }
  }
  return best;
}
