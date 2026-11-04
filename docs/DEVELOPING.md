# Developing

## Set-up

- Node.js 22 and Yarn 1 (`npm install -g yarn`).
- `yarn` installs everything. Electron (standard build, version pinned in `package.json`) downloads itself the first time it runs.
- `node_modules` must be a real folder. Do not replace it with a symbolic link to another checkout's (for example in a `git worktree`): `yarn package` copies the link into the app unchanged, so the packaged app cannot find its modules and opens no window, and Electron Forge's clean-up step ("remove `**/.bin/**/*`") follows the link and empties every `.bin` folder in the other checkout. A hard-linked copy (`cp -al ../main/node_modules node_modules`) is fine.
- `yarn start` runs the app with live reload. Electron needs a desktop session; on a Linux machine without one, prefix commands with `xvfb-run -a`.

## Scripts

| Command | What it does |
| --- | --- |
| `yarn start` | Run in development |
| `yarn typecheck` | TypeScript check, no output files |
| `yarn lint` | ESLint (0 errors required; warnings are legacy) |
| `yarn test` | Vitest, both projects |
| `yarn test:watch` | Vitest in watch mode |
| `yarn test:coverage` | Tests with coverage in `coverage/` |
| `yarn test:scripts` | `node:test` tests for `scripts/` |
| `yarn check` | All of the above that CI runs on code |
| `yarn audit:check` | Dependency audit gate (see below) |
| `yarn package` | Build the app (no installer) into `out/<name>-<platform>-<arch>` |
| `yarn make` | Build installers into `out/make` |
| `yarn e2e` | End-to-end tests of the packaged app (see below) |

## Tests

Vitest has two projects (`vitest.config.mts`):

- `main` (Node): `src/main/**/*.test.ts`, `src/*.test.ts`, `src/common/**/*.test.ts`.
- `ui` (jsdom with Testing Library and jest-dom): `src/player/**` and `src/renderer/**`.

Put a test next to the code (`foo.ts` → `foo.test.ts`). Write the failing test first. Keep logic in small modules without an `electron` import so it can be tested; where Electron is needed, mock it with `vi.mock("electron", ...)` (see `src/autoUpdate.test.ts`).

## Packaged app security (SEC-13)

`forge.config.js` packs the app code into `app.asar` and flips Electron fuses in the executable (settings in `scripts/forge-options.cjs`, tested by `yarn test:scripts`):

| Fuse | Setting | Why |
| --- | --- | --- |
| RunAsNode | off | `ELECTRON_RUN_AS_NODE` cannot turn the app into a plain Node.js runtime |
| EnableNodeOptionsEnvironmentVariable | off | `NODE_OPTIONS` cannot inject code at start-up |
| EnableNodeCliInspectArguments | off (on in test builds) | `--inspect` cannot attach a debugger |
| EnableEmbeddedAsarIntegrityValidation | on | `app.asar` is checked against a hash stored in the executable (Windows and macOS; Electron does not support the check on Linux) |
| OnlyLoadAppFromAsar | on | the app is only loaded from `app.asar` |
| EnableCookieEncryption | on | website-tab cookies are encrypted on disk |

Native addons (`*.node`) and WebAssembly (`*.wasm`) stay unpacked in `app.asar.unpacked`. To check a build: `node scripts/check-release-fuses.mjs "out/Cue Desk-linux-x64/cue-desk"` (on Windows, `cue-desk.exe`); it fails on a test build or any loosened fuse, and `release.yml` runs it on every release build. `CUE_DESK_E2E_BUILD=1` is refused by `yarn make` and `yarn publish`, so a test build cannot become an installer.

Do not package from a git worktree whose `node_modules` is a symlink to another checkout: Electron Forge deletes every `.bin` folder it finds in the copied app, follows the symlink, and empties the other checkout's `node_modules/**/.bin`; the packaged app is also broken. Give each worktree a real `node_modules` (`yarn install`, or `cp -al` of another checkout's).

## Building without Electron headers (FND-3)

The app has no modules compiled from C++ (zlib-sync was dropped in FND-10: discord.js works without it), so packaging needs no Visual Studio and no Electron headers. `CUE_DESK_SKIP_NATIVE_REBUILD=1` skips Electron Forge's native rebuild step and is kept for a future native module:

```
CUE_DESK_SKIP_NATIVE_REBUILD=1 yarn package
```

Prefer libraries without C++ code (WebAssembly, prebuilt binaries for Electron, or Node built-ins such as `node:sqlite`): a module compiled from source needs a C++ toolchain on every build machine.

## End-to-end tests (FND-4)

`e2e/` holds Playwright tests that start the packaged app. Playwright drives Electron through `--inspect`, which release builds switch off, so build a test package first:

```
CUE_DESK_E2E_BUILD=1 yarn package        # add CUE_DESK_SKIP_NATIVE_REBUILD=1 if headers cannot be downloaded
yarn e2e                                 # on Linux without a desktop: xvfb-run -a yarn e2e
yarn e2e playlists                       # one spec file (file names are listed in docs/testing.md)
```

Rebuild the package after any change under `src/`; changes to `e2e/` need no rebuild.

- `e2e/fixtures/app.ts` starts the app with a new empty data folder (`CUE_DESK_USER_DATA_DIR`, which also skips the Kenku FM carry-over; only test builds read it, release builds ignore it) and finds pages by title (`Cue Desk`, `Cue Desk Player`, `Audio Capture`). New specs import `test` and `expect` from it. `launchApp` starts further copies, for tests that restart the app (same data folder by default, or `{ userDataDir: null, env: { XDG_CONFIG_HOME } }` for the normal folder under a private appData).
- After every test the fixture fails the test if anything went wrong while the app ran (`e2e/fixtures/problems.ts`): an uncaught page error, a console error in any page, a main-process crash, a Content-Security-Policy refusal or an "Ignored a … message" from the IPC guard. A test that causes a console error on purpose lists it in `errors.ignoredConsole`.
- Helpers: `fixtures/audio.ts` writes sine-tone WAV files, `fixtures/localSite.ts` serves test pages on 127.0.0.1 (tests cannot reach the internet), `fixtures/player.ts` holds the playlist and soundboard steps. Audio files are added through the app's own file chooser (Playwright's `filechooser` event), so the real import code runs.
- `CUE_DESK_EXECUTABLE` runs the tests against another build.
- On Linux as root (containers, CI) the Chromium sandbox is switched off for the test run only.
- Failures leave a trace, screenshots and the main-process log in `test-results/`.

CI runs the e2e job on Windows (`.github/workflows/ci.yml`).

## Dependency audit

`scripts/audit-check.mjs` runs `yarn audit` on shipped libraries and fails on any high or critical advisory not in `scripts/audit-allowlist.json`. To accept one temporarily, add an entry with `id` (GHSA), `package`, `reason` and the `backlog` item that removes it, and update `reviewed`. Electron is listed as a devDependency (Electron Forge expects that) but ships inside the app, so the gate audits it as well; the other devtools are not audited. Electron supports its three newest major versions; check https://releases.electronjs.org before each release and upgrade when the current major nears end of life. When upgrading, update `FALLBACK_CHROME_VERSION` in `src/main/userAgent.ts`.

## CI

`.github/workflows/`:

- `ci.yml`: every push and pull request. Type check, lint, tests with coverage (artifact `coverage-report`), script tests, audit gate, gitleaks secret scan, and end-to-end tests of the packaged app on Windows (artifact `e2e-report` on failure).
- `codeql.yml`: CodeQL security analysis, also weekly.
- `release.yml`: on `v*` tags or by hand. Runs `ci.yml`, then builds the unsigned Windows x64 installer and zip and attaches them to a draft release.

Third-party actions are pinned by full commit SHA with the version in a comment. To update one, look up the tag's commit (`git ls-remote https://github.com/OWNER/ACTION refs/tags/vX.Y.Z`; for annotated tags use the `^{}` line) and change both.

## Releases

1. Bump `version` in `package.json`, update `CHANGELOG.md`.
2. Commit, then tag `vX.Y.Z` (must equal the version) and push the tag. Where tags cannot be pushed, push the commit to the `release` branch instead (`git push origin main:release`); publishing the draft then creates the tag on the built commit.
3. The Release workflow creates a draft release with `cue-desk-X.Y.Z-win32-x64-setup.exe`, `RELEASES`, the `.nupkg`, the zip and `SHA256SUMS.txt`.
4. Complete `docs/RELEASE_CHECKLIST.md`, then publish the draft. Installed apps pick it up through update.electronjs.org, which needs the repository to stay public and ignores drafts and pre-releases.

Builds are unsigned. Upstream's signed flow (DigiCert KSP Windows signing, Apple signing and notarisation) is kept in `publish/` but not used; its scripts still name upstream's repository and app paths and need updating before use. Its workflow, `publish-stable.yaml`, was removed in 0.1.0 and is in git history. macOS auto-update is off until macOS builds are signed (`UPDATE_PLATFORMS` in `src/main/updateFeed.ts`).

## Renaming the app

- Display name: `productName` in `package.json`. Also update the page titles in `src/index.html` and `src/player/index.html`, and the text in `README.md`, `NOTICE` and `CHANGELOG.md`.
- Package and executable name: `name` in `package.json`. This changes the installer name and the Windows app ID; a new name installs as a separate app, so plan it before the first public release.
- Do **not** change `dataFolderName` in `src/main/appIdentity.json`: it keeps users' libraries where they are.
- GitHub repository: `github` in `src/main/appIdentity.json`, plus the links in `package.json`, `README.md` and `.github/`.
