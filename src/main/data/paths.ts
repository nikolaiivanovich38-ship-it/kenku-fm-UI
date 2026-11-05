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

/**
 * The one way a full path is stored: a Windows path with backslashes and no
 * "." or ".." parts ("D:/Sfx/./rain.wav" is "D:\\Sfx\\rain.wav"), a POSIX path
 * tidied the same way. Letter case is kept; the unique path indexes ignore it.
 */
export function normalizePath(p: string): string {
  return flavourOf(p).normalize(p);
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

/**
 * True for a path on a network share (\\server\share, //server/share, \\?\UNC\…). A mapped drive letter cannot be
 * told from its path. (The library's own folder: library.ts; library folders: unsafeFolderReason.)
 */
export function isNetworkPath(folder: string): boolean {
  if (/^[\\/][\\/]\?[\\/]unc[\\/]/i.test(folder)) return true;
  if (/^[\\/][\\/][?.][\\/]/.test(folder)) return false;
  return /^[\\/][\\/][^\\/]/.test(folder);
}

/** Folders whose contents are the system's, on Windows (from the environment, with the usual places as fallback). */
const WINDOWS_SYSTEM = ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"];
const WINDOWS_SYSTEM_DEFAULTS = ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"];
/** The same on Linux and macOS; nothing in them is a game master's audio. */
const POSIX_SYSTEM = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/proc", "/run", "/sbin", "/srv", "/sys", "/usr", "/System"];
/** Folders that hold every user's profile: refused themselves, not what is inside them. */
const POSIX_PROFILES = ["/home", "/Users"];

function inside(folder: string, parent: string, flavour: typeof path.posix, windows: boolean): boolean {
  const a = flavour.normalize(folder).replace(/[\\/]+$/, "");
  const b = flavour.normalize(parent).replace(/[\\/]+$/, "");
  const [x, y] = windows ? [a.toLowerCase(), b.toLowerCase()] : [a, b];
  return x === y || x.startsWith(y + flavour.sep);
}

function same(folder: string, other: string, flavour: typeof path.posix, windows: boolean): boolean {
  const a = flavour.normalize(folder).replace(/[\\/]+$/, "");
  const b = flavour.normalize(other).replace(/[\\/]+$/, "");
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Why a folder must not become a library folder or a watched folder, in plain words, or null when it may
 * (security review 5): a whole drive (watching it would read every file on it), a network share typed as
 * \\server (as for the library itself; a mapped drive letter is the way to use one), the system's folders, the
 * folder that holds every user's profile, the profile folder itself, and the program data kept in it (AppData).
 * Folders inside the profile, such as Music, are fine.
 */
export function unsafeFolderReason(
  folder: string,
  where: { env?: Record<string, string | undefined>; home?: string } = {},
): string | null {
  const env = where.env ?? process.env;
  if (isNetworkPath(folder)) return "Lyre cannot use a network folder typed as \\\\server. Map it to a drive letter in File Explorer, then choose it there.";
  const windows = /^[a-zA-Z]:/.test(folder);
  const flavour = windows ? path.win32 : path.posix;
  if (windows ? /^[a-zA-Z]:[\\/]*$/.test(folder) : /^\/+$/.test(folder)) return "Lyre cannot use a whole drive as a folder. Choose the folder your audio is in.";
  const systemWords = "This is one of the system's folders. Choose the folder your audio is in.";
  const profileWords = "This is a user profile folder, not an audio folder. Choose the folder your audio is in, such as Music.";
  if (windows) {
    const system = [...WINDOWS_SYSTEM.map((name) => env[name]).filter((v): v is string => !!v && /^[a-zA-Z]:[\\/]/.test(v)), ...WINDOWS_SYSTEM_DEFAULTS];
    if (system.some((s) => inside(folder, s, flavour, true))) return systemWords;
    const profile = env.USERPROFILE && /^[a-zA-Z]:[\\/]/.test(env.USERPROFILE) ? env.USERPROFILE : null;
    const profiles = profile ? path.win32.dirname(profile) : "C:\\Users";
    if (same(folder, profiles, flavour, true) || (profile && same(folder, profile, flavour, true))) return profileWords;
    const appData = [env.APPDATA, env.LOCALAPPDATA, profile ? path.win32.join(profile, "AppData") : null].filter((v): v is string => !!v && /^[a-zA-Z]:[\\/]/.test(v));
    if (appData.some((a) => inside(folder, a, flavour, true))) return profileWords;
    return null;
  }
  if (POSIX_SYSTEM.some((s) => inside(folder, s, flavour, false))) return systemWords;
  const home = where.home ?? env.HOME;
  if (POSIX_PROFILES.some((p) => same(folder, p, flavour, false)) || (home && home.startsWith("/") && same(folder, home, flavour, false))) return profileWords;
  return null;
}
