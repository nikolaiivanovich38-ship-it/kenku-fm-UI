/**
 * The ffmpeg builds Lyre ships, per platform (security review 2 and 7). ffmpeg-static 5.3.0 downloads one of these
 * at install time from its GitHub release "b6.1.1"; the README it downloads beside the program names the version.
 *
 * NOTICE must name each build's version, builder and source (scripts/licences.test.mjs checks it). ffmpeg is
 * GPL-3.0-or-later; its builders publish the exact source they built from at `source`.
 *
 * ffmpeg-static's install script downloads the program from GitHub with no check of what arrives, and the
 * release's files have been replaced since it was made (its macOS x64 README now describes another version).
 * `sha256` is the program as downloaded and unpacked on 5 Nov 2026; `checkBundledFfmpeg` runs before every
 * packaging (forge.config.js, prePackage) and stops the build if the program is anything else. When ffmpeg-static
 * is upgraded, download each platform's program, check it, and update the values, versions and NOTICE together.
 */
const FFMPEG_RELEASE = "b6.1.1";

const FFMPEG_BUILDS = {
  "win32-x64": {
    version: "6.1.1",
    builder: "gyan.dev (release essentials build)",
    source: "https://github.com/FFmpeg/FFmpeg/commit/e38092ef93",
    sha256: "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
  },
  "linux-x64": {
    version: "7.0.2",
    builder: "John Van Sickle (johnvansickle.com/ffmpeg)",
    source: "https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz",
    sha256: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
  },
  "linux-arm64": {
    version: "7.0.2",
    builder: "John Van Sickle (johnvansickle.com/ffmpeg)",
    source: "https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz",
    sha256: "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
  },
  "darwin-x64": {
    version: "6.1.1",
    builder: "evermeet.cx (Helmut K. C. Tessarek)",
    source: "https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz",
    sha256: "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
  },
};

/**
 * Builds Lyre must not ship. ffmpeg-static's macOS arm64 program (ffmpeg 6.0 from osxexperts.net) was configured
 * with --enable-gpl and --enable-nonfree together, which FFmpeg's own licence notes say makes it unredistributable.
 */
const REFUSED_FFMPEG_BUILDS = {
  "darwin-arm64": "ffmpeg-static's macOS arm64 ffmpeg is built with --enable-nonfree and may not be redistributed.",
};

const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

/** Where ffmpeg-static keeps the program, under the project folder `root`. */
function ffmpegProgramIn(root, platform) {
  return path.join(root, "node_modules", "ffmpeg-static", platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

/** Throws (stopping the build) unless the program under `root` is the pinned build for `platform`-`arch`. */
function checkBundledFfmpeg(root, platform, arch) {
  const target = `${platform}-${arch}`;
  if (Object.prototype.hasOwnProperty.call(REFUSED_FFMPEG_BUILDS, target)) throw new Error(`Lyre cannot be built for ${target}: ${REFUSED_FFMPEG_BUILDS[target]}`);
  const build = ffmpegBuildFor(platform, arch);
  if (!build) throw new Error(`No pinned ffmpeg build for ${target}; add one to scripts/ffmpeg-builds.cjs (and NOTICE).`);
  const program = ffmpegProgramIn(root, platform);
  let bytes;
  try {
    bytes = fs.readFileSync(program);
  } catch {
    throw new Error(`The ffmpeg program was not found at ${program}. Reinstall the packages.`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== build.sha256) {
    throw new Error(`${program} does not match the pinned SHA-256 for ${target} (found ${sha256}, expected ${build.sha256}). Do not ship it.`);
  }
  return build;
}

/** The build listed for `platform`-`arch` (Node's names), or undefined. */
function ffmpegBuildFor(platform, arch) {
  return Object.prototype.hasOwnProperty.call(FFMPEG_BUILDS, `${platform}-${arch}`) ? FFMPEG_BUILDS[`${platform}-${arch}`] : undefined;
}

/** The version a builder's README names ("Version: 6.1.1-essentials…" or "version: 7.0.2"), or null. */
function readmeVersion(readme) {
  const match = /^\s*version:\s*(\d+(?:\.\d+)+)/im.exec(readme);
  return match ? match[1] : null;
}

module.exports = { FFMPEG_RELEASE, FFMPEG_BUILDS, REFUSED_FFMPEG_BUILDS, ffmpegBuildFor, readmeVersion, ffmpegProgramIn, checkBundledFfmpeg };
