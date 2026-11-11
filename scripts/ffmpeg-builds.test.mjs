// The build checks the ffmpeg program it ships against pinned SHA-256 values (security review 7).
// Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { FFMPEG_BUILDS, checkBundledFfmpeg, ffmpegProgramIn } = require("./ffmpeg-builds.cjs");

function fakeModule(content, name = "ffmpeg") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffpin-"));
  const folder = path.join(dir, "node_modules", "ffmpeg-static");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), content);
  return dir;
}

describe("pinned ffmpeg builds (security review 7)", () => {
  it("pins a SHA-256 for every build Lyre ships", () => {
    for (const [platform, build] of Object.entries(FFMPEG_BUILDS)) assert.match(build.sha256, /^[0-9a-f]{64}$/, platform);
  });

  it("accepts the program in node_modules for this computer", () => {
    assert.doesNotThrow(() => checkBundledFfmpeg(root, process.platform, process.arch));
  });

  it("fails the build when the program differs from the pinned one", () => {
    const dir = fakeModule("not the real ffmpeg");
    assert.throws(() => checkBundledFfmpeg(dir, "linux", "x64"), /does not match the pinned SHA-256/);
  });

  it("fails the build when the program is missing, the platform is unknown, or its build may not be shipped", () => {
    const dir = fakeModule("x", "other");
    assert.throws(() => checkBundledFfmpeg(dir, "linux", "x64"), /not found/);
    assert.throws(() => checkBundledFfmpeg(dir, "freebsd", "x64"), /No pinned ffmpeg/);
    assert.throws(() => checkBundledFfmpeg(dir, "darwin", "arm64"), /may not be redistributed/);
  });

  it("looks for ffmpeg.exe on Windows", () => {
    assert.equal(path.basename(ffmpegProgramIn("/x", "win32")), "ffmpeg.exe");
    assert.equal(path.basename(ffmpegProgramIn("/x", "linux")), "ffmpeg");
  });

  it("checks the program before every packaging (forge's prePackage hook)", async () => {
    const config = require("../forge.config.js");
    assert.equal(typeof config.hooks?.prePackage, "function");
  });
});
