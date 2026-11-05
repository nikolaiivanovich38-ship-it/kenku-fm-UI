/**
 * The ffmpeg builds Lyre ships, per platform (security review 2 and 7). ffmpeg-static 5.3.0 downloads one of these
 * at install time from its GitHub release "b6.1.1"; the README it downloads beside the program names the version.
 *
 * NOTICE must name each build's version, builder and source (scripts/licences.test.mjs checks it). ffmpeg is
 * GPL-3.0-or-later; its builders publish the exact source they built from at `source`.
 */
const FFMPEG_RELEASE = "b6.1.1";

const FFMPEG_BUILDS = {
  "win32-x64": {
    version: "6.1.1",
    builder: "gyan.dev (release essentials build)",
    source: "https://github.com/FFmpeg/FFmpeg/commit/e38092ef93",
  },
  "linux-x64": {
    version: "7.0.2",
    builder: "John Van Sickle (johnvansickle.com/ffmpeg)",
    source: "https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz",
  },
  "linux-arm64": {
    version: "7.0.2",
    builder: "John Van Sickle (johnvansickle.com/ffmpeg)",
    source: "https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz",
  },
  "darwin-x64": {
    version: "6.1.1",
    builder: "evermeet.cx (Helmut K. C. Tessarek)",
    source: "https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz",
  },
};

/**
 * Builds Lyre must not ship. ffmpeg-static's macOS arm64 program (ffmpeg 6.0 from osxexperts.net) was configured
 * with --enable-gpl and --enable-nonfree together, which FFmpeg's own licence notes say makes it unredistributable.
 */
const REFUSED_FFMPEG_BUILDS = {
  "darwin-arm64": "ffmpeg-static's macOS arm64 ffmpeg is built with --enable-nonfree and may not be redistributed.",
};

/** The build listed for `platform`-`arch` (Node's names), or undefined. */
function ffmpegBuildFor(platform, arch) {
  return Object.prototype.hasOwnProperty.call(FFMPEG_BUILDS, `${platform}-${arch}`) ? FFMPEG_BUILDS[`${platform}-${arch}`] : undefined;
}

/** The version a builder's README names ("Version: 6.1.1-essentials…" or "version: 7.0.2"), or null. */
function readmeVersion(readme) {
  const match = /^\s*version:\s*(\d+(?:\.\d+)+)/im.exec(readme);
  return match ? match[1] : null;
}

module.exports = { FFMPEG_RELEASE, FFMPEG_BUILDS, REFUSED_FFMPEG_BUILDS, ffmpegBuildFor, readmeVersion };
