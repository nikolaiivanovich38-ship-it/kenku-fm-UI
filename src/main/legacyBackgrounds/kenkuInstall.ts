/**
 * Kenku FM backgrounds: where an installed Kenku FM keeps its background
 * pictures, and which picture belongs to which name.
 *
 * Upstream builds its pictures into the app, but keeps them in a private
 * repository, so Cue Desk's own build has none. Playlists and soundboards
 * store a background by name ("tavern"), so Cue Desk copies the pictures from
 * the user's own Kenku FM install (never from the internet, never shipped with
 * Cue Desk: they are Owlbear Rodeo's). Free of Electron imports so it can be
 * unit-tested.
 *
 * What an install looks like (Kenku FM 1.5.5 on Windows, per-user Squirrel
 * install):
 *   %LOCALAPPDATA%\kenku-fm-win32-x64\app-1.5.5\resources\app\.webpack\renderer\
 *     8141457778d3d8eb6c2b.jpg              pictures, with hashed names
 *     player_window\index.js                minified bundle with the name map
 * Other versions may pack `resources\app` into `resources\app.asar`; Electron's
 * main process reads inside asar archives as if they were folders.
 */
import path from "path";

/** Test builds only: a folder to use instead of %LOCALAPPDATA% (end-to-end tests). */
export const LOCAL_APP_DATA_DIR_ENV = "CUE_DESK_LOCAL_APP_DATA_DIR";

/** The player bundle, relative to the renderer folder, that holds the name map. */
export const PLAYER_BUNDLE = path.join("player_window", "index.js");

/** Picture types the player shows as backgrounds. */
export const PICTURE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "svg"] as const;

const PICTURE_EXTENSION = new RegExp(`\\.(${PICTURE_EXTENSIONS.join("|")})$`, "i");

/**
 * A background name: a plain file name without extension. No slashes, colons
 * or "..", so it can never point outside the backgrounds folder.
 */
export function isSafeBackgroundName(name: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9 _.-]{0,99}$/.test(name) && !name.includes("..") && !/[ .]$/.test(name);
}

/** A picture file name in Kenku FM's renderer folder, such as `8141457778d3d8eb6c2b.jpg`. */
export function isSafePictureFile(file: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z]+$/.test(file) && PICTURE_EXTENSION.test(file);
}

export function hasPictureExtension(file: string): boolean {
  return PICTURE_EXTENSION.test(file);
}

export type BackgroundEntry = {
  /** The name playlists and soundboards store, e.g. "autumn". */
  name: string;
  /** The picture's file in the renderer folder, e.g. "8141457778d3d8eb6c2b.jpg". */
  file: string;
};

/**
 * Kenku FM 1.5.5 has 23 pictures; anything far beyond that is not a real
 * Kenku FM bundle, so the list is cut off there (0.1.1 review).
 */
export const MAX_BACKGROUND_ENTRIES = 100;

/**
 * Read the background pictures' names and files from the player bundle.
 *
 * webpack's `require.context` leaves a map of names to module ids,
 * `"./autumn.jpg":78209`, and one module per picture,
 * `78209:(e,t,r)=>{"use strict";e.exports=r.p+"8141457778d3d8eb6c2b.jpg"}`,
 * where `r.p` is the folder the bundle was loaded from. The minifier's
 * variable names and spacing differ between builds, so the patterns accept
 * any of them. Only pictures with safe names are returned.
 *
 * The bundle comes from another app's folder, so it is read in two single
 * passes whose patterns have only bounded repeats: time grows in step with
 * the bundle's size, whatever the text holds (0.1.1 review).
 */
export function parseBackgroundMap(bundle: string): BackgroundEntry[] {
  const files = pictureModules(bundle);
  const mapEntry = /["']\.\/([^"'\\]{1,200})["']\s{0,8}:\s{0,8}(\d{1,10})/g;
  const entries: BackgroundEntry[] = [];
  const seen = new Set<string>();
  for (const match of bundle.matchAll(mapEntry)) {
    if (entries.length >= MAX_BACKGROUND_ENTRIES) break;
    const [, fileName, id] = match;
    if (!hasPictureExtension(fileName)) continue;
    const name = fileName.replace(PICTURE_EXTENSION, "");
    if (!isSafeBackgroundName(name) || seen.has(name.toLowerCase())) continue;
    const file = files.get(id);
    if (file === undefined || !isSafePictureFile(file)) continue;
    seen.add(name.toLowerCase());
    entries.push({ name, file });
  }
  return entries;
}

/** Module id to exported file name, for every module shaped like a picture. */
function pictureModules(bundle: string): Map<string, string> {
  const v = "[\\w$]{1,32}";
  const pattern = new RegExp(
    // The id, not preceded by another digit or name character...
    `(?:^|[^\\w$.])(\\d{1,10})\\s{0,8}:\\s{0,8}` +
      // ...then the module function: (e,t,r)=>, function(e,t,r) or e=>...
      `(?:function\\s{0,8}\\([^)]{0,64}\\)|\\([^)]{0,64}\\)\\s{0,8}=>|${v}\\s{0,8}=>)\\s{0,8}\\{\\s{0,8}` +
      `(?:["']use strict["']\\s{0,8}[;,]?\\s{0,8})?` +
      // ...whose body is e.exports = r.p + "file".
      `${v}\\.exports\\s{0,8}=\\s{0,8}${v}\\.p\\s{0,8}\\+\\s{0,8}(["'])([^"'\\\\]{1,200})\\2`,
    "g",
  );
  const files = new Map<string, string>();
  for (const match of bundle.matchAll(pattern)) {
    if (!files.has(match[1])) files.set(match[1], match[3]);
  }
  return files;
}

/** Lists a folder's entry names; may throw or return [] when it cannot be read. */
export type ListDir = (dir: string) => Promise<string[]>;

async function safeList(listDir: ListDir, dir: string): Promise<string[]> {
  try {
    return await listDir(dir);
  } catch {
    return [];
  }
}

/** Squirrel names install folders after the package; Kenku FM's are `kenku-fm` and `kenku-fm-win32-x64`. */
const INSTALL_FOLDER = /^kenku-fm(-[a-z0-9_]+)*$/i;
const VERSION_FOLDER = /^app-(\d+)\.(\d+)\.(\d+)/;

function compareVersionsDescending(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

/**
 * Renderer folders of installed Kenku FM copies under `localAppData`, best
 * first: newest version first and, within a version, `resources/app` before
 * `resources/app.asar` (the order Electron loads them in). Install folders
 * Squirrel has marked as uninstalled (a `.dead` file) are left out. The caller
 * uses the first folder whose bundle holds pictures.
 */
export async function findRendererFolders(localAppData: string, listDir: ListDir): Promise<string[]> {
  const installs = (await safeList(listDir, localAppData)).filter((name) => INSTALL_FOLDER.test(name));
  const versions: { version: number[]; dir: string }[] = [];
  for (const install of installs) {
    const installDir = path.join(localAppData, install);
    const children = await safeList(listDir, installDir);
    if (children.includes(".dead")) continue;
    for (const child of children) {
      const match = VERSION_FOLDER.exec(child);
      if (match) {
        versions.push({ version: match.slice(1, 4).map(Number), dir: path.join(installDir, child) });
      }
    }
  }
  versions.sort((a, b) => compareVersionsDescending(a.version, b.version));

  const folders: string[] = [];
  for (const { dir } of versions) {
    const resources = path.join(dir, "resources");
    const contents = await safeList(listDir, resources);
    for (const app of ["app", "app.asar"]) {
      if (contents.includes(app)) {
        folders.push(path.join(resources, app, ".webpack", "renderer"));
      }
    }
  }
  return folders;
}

/**
 * The folder to look for Kenku FM in: %LOCALAPPDATA% on Windows, nothing
 * elsewhere (Kenku FM installs in other places there; not supported yet).
 * Test builds may name a folder in CUE_DESK_LOCAL_APP_DATA_DIR, and a test
 * run with a throw-away data folder never looks at the real computer's
 * Kenku FM. Release builds ignore the variable.
 */
export function localAppDataFolder(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  { isTestBuild, testUserData }: { isTestBuild: boolean; testUserData: boolean },
): string | null {
  if (isTestBuild) {
    const override = env[LOCAL_APP_DATA_DIR_ENV]?.trim();
    if (override) {
      return path.isAbsolute(override) ? path.normalize(override) : null;
    }
    if (testUserData) {
      return null;
    }
  }
  if (platform !== "win32") {
    return null;
  }
  const localAppData = env.LOCALAPPDATA?.trim();
  return localAppData && path.win32.isAbsolute(localAppData) ? localAppData : null;
}
