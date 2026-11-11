// Tests for the packaging options in forge-options.cjs (SEC-13, FND-3). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const {
  SKIP_NATIVE_REBUILD_ENV,
  E2E_BUILD_ENV,
  ASAR_UNPACK_GLOB,
  rebuildConfig,
  fusesConfig,
} = require("./forge-options.cjs");

describe("rebuildConfig (FND-3)", () => {
  it("rebuilds native modules for Electron by default (CI and release builds)", () => {
    assert.deepEqual(rebuildConfig({}), {});
    assert.deepEqual(rebuildConfig({ [SKIP_NATIVE_REBUILD_ENV]: "0" }), {});
  });

  it("skips the rebuild only when the local switch is exactly 1", () => {
    assert.deepEqual(rebuildConfig({ [SKIP_NATIVE_REBUILD_ENV]: "1" }), { onlyModules: [] });
    assert.deepEqual(rebuildConfig({ [SKIP_NATIVE_REBUILD_ENV]: "yes" }), {});
  });
});

describe("fusesConfig (SEC-13)", () => {
  const fuses = fusesConfig({});

  it("uses fuse wire version 1", () => {
    assert.equal(fuses.version, FuseVersion.V1);
  });

  it("turns off ways to run the app as plain Node or attach a debugger", () => {
    assert.equal(fuses[FuseV1Options.RunAsNode], false);
    assert.equal(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false);
    assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], false);
  });

  it("only loads the app from a checked app.asar and encrypts cookies", () => {
    assert.equal(fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
    assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], true);
    assert.equal(fuses[FuseV1Options.EnableCookieEncryption], true);
  });
});

describe("fusesConfig for end-to-end test builds (FND-4)", () => {
  it("lets Playwright attach its debugger only in a build made with the test switch", () => {
    const fuses = fusesConfig({ [E2E_BUILD_ENV]: "1" });
    assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], true);
  });

  it("changes nothing else in a test build", () => {
    const release = fusesConfig({});
    const test = fusesConfig({ [E2E_BUILD_ENV]: "1" });
    for (const key of Object.keys(release)) {
      if (Number(key) === FuseV1Options.EnableNodeCliInspectArguments) continue;
      assert.equal(test[key], release[key], `fuse ${key}`);
    }
  });
});

describe("ASAR_UNPACK_GLOB (SEC-13)", () => {
  // @electron/asar matches each file's full path with minimatch and matchBase.
  const minimatch = require("minimatch");
  const unpacked = (file) => minimatch(file, ASAR_UNPACK_GLOB, { matchBase: true });

  it("keeps native addons and WebAssembly outside app.asar", () => {
    assert.ok(unpacked("/app/node_modules/some-addon/build/Release/addon.node"));
    assert.ok(unpacked("/app/node_modules/@snazzah/davey-win32-x64-msvc/davey.win32-x64-msvc.node"));
    assert.ok(unpacked("/app/node_modules/opusscript/build/opusscript_native_wasm.wasm"));
    assert.ok(unpacked("/app/.webpack/main/native_modules/thing.node"));
  });

  it("keeps the bundled ffmpeg program outside app.asar, so it can be run (BUG-10)", () => {
    assert.ok(unpacked("/app/node_modules/ffmpeg-static/ffmpeg"));
    assert.ok(unpacked("C:/build/app/node_modules/ffmpeg-static/ffmpeg.exe"));
  });

  it("keeps ffmpeg's licence and README beside the program, and the bundles' licence lists readable (security review 2, 13)", () => {
    assert.ok(unpacked("/app/node_modules/ffmpeg-static/ffmpeg.LICENSE"));
    assert.ok(unpacked("C:/build/app/node_modules/ffmpeg-static/ffmpeg.README"));
    assert.ok(unpacked("/app/.webpack/main/THIRD_PARTY_LICENSES.txt"));
    assert.ok(unpacked("/app/.webpack/renderer/lyre_window/THIRD_PARTY_LICENSES.txt"));
  });

  it("packs everything else", () => {
    assert.ok(!unpacked("/app/node_modules/ffmpeg-static/index.js"));
    assert.ok(!unpacked("/app/node_modules/ffmpeg-static/package.json"));
    assert.ok(!unpacked("/app/.webpack/main/ffmpeg"));
    assert.ok(!unpacked("/app/.webpack/main/index.js"));
    assert.ok(!unpacked("/app/node_modules/opusscript/index.js"));
    assert.ok(!unpacked("/app/package.json"));
  });
});

describe("fusesConfig refuses a test build for release (WP1 review)", () => {
  it("throws when a test build is made into an installer or published", () => {
    for (const argv of [
      ["node", "electron-forge", "make"],
      ["node", "electron-forge", "publish"],
      // How the forge CLI actually runs them: a separate script per command.
      ["node", "/app/node_modules/@electron-forge/cli/dist/electron-forge-make.js", "--arch=x64"],
      ["node", "C:\\app\\node_modules\\@electron-forge\\cli\\dist\\electron-forge-publish.js"],
    ]) {
      assert.throws(() => fusesConfig({ [E2E_BUILD_ENV]: "1" }, argv), /CUE_DESK_E2E_BUILD/, argv.join(" "));
    }
  });

  it("allows a test build for `package`, and release builds for every command", () => {
    assert.doesNotThrow(() => fusesConfig({ [E2E_BUILD_ENV]: "1" }, ["node", "electron-forge", "package"]));
    assert.doesNotThrow(() =>
      fusesConfig({ [E2E_BUILD_ENV]: "1" }, ["node", "/app/node_modules/@electron-forge/cli/dist/electron-forge-package.js"]),
    );
    assert.doesNotThrow(() => fusesConfig({}, ["node", "electron-forge", "make", "--arch=x64"]));
  });
});
