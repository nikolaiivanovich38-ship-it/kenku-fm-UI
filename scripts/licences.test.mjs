// Licence notices shipped with Lyre (security review 2 and 13). Run with `yarn test:scripts`.
// - NOTICE names ffmpeg for every platform Lyre is built for: its version, who built it, its licence and where
//   its source code is; and the ffmpeg in node_modules is the build NOTICE names for this computer.
// - The packaged app carries NOTICE and LICENSE outside app.asar (resources folder).
// - Libraries webpack bundles keep their licence notices (THIRD_PARTY_LICENSES.txt beside each bundle).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { FFMPEG_BUILDS, ffmpegBuildFor, readmeVersion } = require("./ffmpeg-builds.cjs");
const { licenceEntries, licenceText } = require("./third-party-licences.cjs");
const notice = fs.readFileSync(path.join(root, "NOTICE"), "utf8");

describe("ffmpeg in NOTICE (security review 2)", () => {
  it("names ffmpeg, its licence, and each platform's version, builder and source", () => {
    assert.match(notice, /ffmpeg/i);
    assert.match(notice, /GPL-3\.0-or-later|GNU General Public License, version 3/);
    for (const [platform, build] of Object.entries(FFMPEG_BUILDS)) {
      assert.ok(notice.includes(`${platform}: ffmpeg ${build.version}`), `NOTICE names ffmpeg ${build.version} for ${platform}`);
      assert.ok(notice.includes(build.source), `NOTICE says where ${platform}'s source is`);
      assert.ok(notice.includes(build.builder), `NOTICE names who built ${platform}'s ffmpeg`);
    }
  });

  it("the Windows build is gyan.dev 6.1.1 from FFmpeg commit e38092ef93", () => {
    const windows = FFMPEG_BUILDS["win32-x64"];
    assert.equal(windows.version, "6.1.1");
    assert.match(windows.source, /e38092ef93/);
  });

  it("matches the ffmpeg in node_modules for this computer (its README's version)", () => {
    const readme = fs.readFileSync(path.join(root, "node_modules", "ffmpeg-static", "ffmpeg.README"), "utf8");
    const build = ffmpegBuildFor(process.platform, process.arch);
    assert.ok(build, `a build is listed for ${process.platform}-${process.arch}`);
    assert.equal(readmeVersion(readme), build.version);
  });

  it("reads the version from each builder's README", () => {
    assert.equal(readmeVersion("FFmpeg 64-bit static Windows build from www.gyan.dev\n\nVersion: 6.1.1-essentials_build-www.gyan.dev\n"), "6.1.1");
    assert.equal(readmeVersion("   build: ffmpeg-7.0.2-amd64-static.tar.xz\n              version: 7.0.2\n"), "7.0.2");
    assert.equal(readmeVersion("nothing here"), null);
  });
});

describe("licence files in the packaged app (security review 2)", () => {
  it("copies NOTICE and LICENSE into the resources folder, outside app.asar", () => {
    const config = require("../forge.config.js");
    const extra = (config.packagerConfig.extraResource ?? []).map((p) => path.basename(p));
    assert.ok(extra.includes("NOTICE"));
    assert.ok(extra.includes("LICENSE"));
  });
});

describe("licences of bundled libraries (security review 13)", () => {
  it("finds each bundled package once, with its licence text", () => {
    const resources = [
      path.join(root, "node_modules", "music-metadata", "lib", "index.js"),
      path.join(root, "node_modules", "music-metadata", "lib", "core.js"),
      path.join(root, "node_modules", "strtok3", "lib", "core.js"),
      path.join(root, "src", "main", "index.ts"),
    ];
    const entries = licenceEntries(resources);
    assert.deepEqual(entries.map((e) => e.name), ["music-metadata", "strtok3"]);
    for (const entry of entries) {
      assert.equal(entry.license, "MIT");
      assert.match(entry.text, /Permission is hereby granted/);
    }
    const text = licenceText(entries);
    assert.match(text, /music-metadata@\d/);
    assert.match(text, /strtok3@\d/);
  });

  it("names the licence when a package ships no licence file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lic-"));
    const pkg = path.join(dir, "node_modules", "bare");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "bare", version: "1.0.0", license: "ISC" }));
    fs.writeFileSync(path.join(pkg, "index.js"), "");
    const [entry] = licenceEntries([path.join(pkg, "index.js")]);
    assert.equal(entry.license, "ISC");
    assert.equal(entry.text, "");
    assert.match(licenceText([entry]), /bare@1\.0\.0 \(ISC\)/);
  });
});
