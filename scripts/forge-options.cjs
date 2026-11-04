/**
 * Packaging options for forge.config.js that depend on the environment
 * (SEC-13 fuses and asar, FND-3 local native-module switch, FND-4 test
 * builds). Kept apart from forge.config.js so they can be unit-tested
 * (scripts/forge-options.test.mjs).
 */
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

/**
 * FND-3: set to 1 to package without rebuilding native modules for Electron.
 * Only for machines that cannot download Electron's headers; zlib-sync is then
 * left out and discord.js uses its built-in fallback. CI never sets it.
 */
const SKIP_NATIVE_REBUILD_ENV = "CUE_DESK_SKIP_NATIVE_REBUILD";

/**
 * FND-4: set to 1 to build a package for the end-to-end tests. Playwright
 * drives Electron through the Node inspector, so a test build keeps the
 * `--inspect` fuse on. Release builds never set it.
 */
const E2E_BUILD_ENV = "CUE_DESK_E2E_BUILD";

/**
 * SEC-13: files that must stay outside app.asar: native addons (.node) are
 * loaded by the operating system, which cannot read inside an archive, and
 * opusscript reads its .wasm file from disk. A basename pattern: asar
 * matches it against every file (minimatch `matchBase`), dot-folders included.
 */
const ASAR_UNPACK_GLOB = "*.{node,wasm}";

/**
 * Whether a command-line argument names forge's make or publish command,
 * either as the subcommand word or as the per-command script the forge CLI
 * runs (electron-forge-make.js).
 */
function isReleaseCommand(arg) {
  return /^(make|publish)$|(^|[\\/])electron-forge-(make|publish)(\.js)?$/.test(arg);
}

/** FND-3: @electron/rebuild options; `onlyModules: []` rebuilds nothing. */
function rebuildConfig(env) {
  return env[SKIP_NATIVE_REBUILD_ENV] === "1" ? { onlyModules: [] } : {};
}

/**
 * SEC-13: Electron fuses written into the packaged executable.
 * - RunAsNode, NODE_OPTIONS and --inspect off: the app cannot be used as a
 *   general Node.js runtime or have code injected at start-up.
 * - Asar integrity and asar-only loading on: the app code is read only from
 *   app.asar and checked against the hash stored in the executable.
 * - Cookie encryption on: website-tab cookies are encrypted at rest.
 *
 * A test build (CUE_DESK_E2E_BUILD=1) keeps --inspect on, so it may only be
 * packaged, never made into an installer or published.
 * @param env process.env
 * @param argv process.argv, to see which forge command is running
 */
function fusesConfig(env, argv = []) {
  const testBuild = env[E2E_BUILD_ENV] === "1";
  if (testBuild && argv.some(isReleaseCommand)) {
    throw new Error(
      `${E2E_BUILD_ENV}=1 builds accept --inspect and must not be released. ` +
        `Unset ${E2E_BUILD_ENV} before running make or publish.`,
    );
  }
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: testBuild,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  };
}

module.exports = {
  SKIP_NATIVE_REBUILD_ENV,
  E2E_BUILD_ENV,
  ASAR_UNPACK_GLOB,
  rebuildConfig,
  fusesConfig,
};
