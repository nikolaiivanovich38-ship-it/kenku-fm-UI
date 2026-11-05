/**
 * BUG-10 (w3-media): where the ffmpeg program bundled by ffmpeg-static 5.3.0 (GPL-3.0-or-later) is.
 *
 * forge.config.js ships node_modules/ffmpeg-static in the app and keeps the program itself out of app.asar
 * (ASAR_UNPACK_GLOB, scripts/forge-options.cjs): the operating system cannot run a program inside an archive, so it
 * sits in app.asar.unpacked beside it. ffmpeg-static's own index.js is not used: it lets an environment variable
 * (FFMPEG_BIN) choose another program, and Lyre runs only the one it ships.
 */
import fs from "fs";
import path from "path";

/** The program's name on this platform. */
const programName = (platform: NodeJS.Platform) => (platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

/**
 * The bundled ffmpeg for an app whose code is at `appPath` (Electron's app.getAppPath()): `…/resources/app.asar` in
 * a packaged app, the project folder when run with `yarn start`.
 */
export function bundledFfmpegPath(appPath: string, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const root = /app\.asar$/.test(appPath) ? `${appPath}.unpacked` : appPath;
  return paths.join(root, "node_modules", "ffmpeg-static", programName(platform));
}

/** The bundled ffmpeg when it is there; null when it is missing (a damaged install), so callers can say so plainly. */
export function findBundledFfmpeg(
  appPath: string,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = fs.existsSync,
): string | null {
  const program = bundledFfmpegPath(appPath, platform);
  return exists(program) ? program : null;
}
