const path = require("path");
const packageJson = require("./package.json");
// FND-1: fork identity (data folder, app ID, GitHub repository) lives in one
// file shared with the app itself. The display name is package.json productName.
const identity = require("./src/main/appIdentity.json");
const {
  ASAR_UNPACK_GLOB,
  fusesConfig,
  rebuildConfig,
} = require("./scripts/forge-options.cjs");
const { checkBundledFfmpeg } = require("./scripts/ffmpeg-builds.cjs");

const productName = packageJson.productName;
const homepage = packageJson.homepage;
// Squirrel and Linux packages dislike hyphens in package names.
const installerName = packageJson.name.replace(/-/g, "_");

/**
 * Release builds here are unsigned: no Windows code signing and no Apple
 * notarisation. Upstream's signed flow is kept in the publish/ folder for when
 * the product owner has those accounts; see docs/DEVELOPING.md > Releases.
 */
const config = {
  packagerConfig: {
    name: productName,
    executableName: packageJson.name,
    out: "./out",
    icon: "./src/assets/icon",
    appBundleId: identity.appId,
    appCopyright: "GPL-3.0. Based on Kenku FM by Owlbear Rodeo.",
    // SEC-13: app code ships in app.asar (checked at start-up by the fuses
    // below); native addons and WebAssembly stay unpacked beside it.
    asar: { unpack: ASAR_UNPACK_GLOB },
    // Security review 2: Lyre's licence and notices (ffmpeg's GPL notice and source among them) in the installed
    // app's resources folder, outside app.asar, where anyone can read them.
    extraResource: ["./NOTICE", "./LICENSE"],
  },
  // FND-3: CUE_DESK_SKIP_NATIVE_REBUILD=1 skips the native-module rebuild on
  // machines that cannot download Electron headers (see docs/DEVELOPING.md).
  rebuildConfig: rebuildConfig(process.env),
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      // The installer name includes "-win32-<arch>" so update.electronjs.org
      // can match it to the right Windows build. Windows identifies the app
      // (AppUserModelId) as com.squirrel.<installerName>.<executableName>,
      // so it never collides with an installed Kenku FM or Cue Desk draft.
      config: (arch) => ({
        name: installerName,
        title: productName,
        setupExe: `${packageJson.name}-${packageJson.version}-win32-${arch}-setup.exe`,
        setupIcon: path.join(__dirname, "src", "assets", "setup.ico"),
        loadingGif: path.join(__dirname, "src", "assets", "loading.gif"),
      }),
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        name: installerName,
        productName,
        homepage,
        icon: path.join(__dirname, "src", "assets", "icons", "256x256.png"),
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["linux", "darwin", "win32"],
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        name: installerName,
        productName,
        homepage,
        icon: path.join(__dirname, "src", "assets", "icons", "256x256.png"),
      },
    },
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: identity.github.owner,
          name: identity.github.repo,
        },
        prerelease: false,
        // Releases start as drafts; the product owner publishes them after the
        // release checklist (docs/RELEASE_CHECKLIST.md) is complete.
        draft: true,
      },
    },
  ],
  hooks: {
    // Security review 7: never package an ffmpeg program other than the pinned build for the target platform.
    prePackage: async (_forgeConfig, platform, arch) => {
      checkBundledFfmpeg(__dirname, platform, arch);
    },
  },
  plugins: [
    {
      name: "@electron-forge/plugin-webpack",
      config: {
        mainConfig: "./webpack.main.config.js",
        renderer: {
          config: "./webpack.renderer.config.js",
          entryPoints: [
            {
              html: "./src/index.html",
              js: "./src/renderer.ts",
              name: "main_window",
              preload: {
                js: "./src/preload.ts",
              },
            },
            {
              html: "./src/player/index.html",
              js: "./src/player/renderer.ts",
              name: "player_window",
              preload: {
                js: "./src/player/preload.ts",
              },
            },
            {
              // WP5 (w3-shell): the new interface, opened as the "Lyre" tab.
              html: "./src/lyre/index.html",
              js: "./src/lyre/renderer.ts",
              name: "lyre_window",
              preload: {
                js: "./src/lyre/preload.ts",
              },
            },
            {
              html: "./src/audioCapture/index.html",
              js: "./src/audioCapture/renderer.ts",
              name: "audio_capture_window",
              preload: {
                js: "./src/audioCapture/preload.ts",
              },
            },
          ],
        },
        devContentSecurityPolicy: "",
      },
    },
    {
      // SEC-13: lock down the packaged executable (see scripts/forge-options.cjs).
      name: "@electron-forge/plugin-fuses",
      config: fusesConfig(process.env, process.argv),
    },
    {
      name: "@timfish/forge-externals-plugin",
      config: {
        externals: ["opusscript", "prism-media", "@snazzah/davey"],
        includeDeps: true,
      },
    },
    {
      // BUG-10 (w3-media): ship node_modules/ffmpeg-static (the ffmpeg program and its licence; the program is kept
      // out of app.asar by ASAR_UNPACK_GLOB). Its dependencies only download the program at install time, so they
      // are left out. The app finds the program itself (src/main/media/bundledFfmpeg.ts); nothing requires the module.
      name: "@timfish/forge-externals-plugin",
      config: {
        externals: ["ffmpeg-static"],
        includeDeps: false,
      },
    },
  ],
};

module.exports = config;
