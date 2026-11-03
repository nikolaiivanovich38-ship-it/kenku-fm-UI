# Developing

## Set-up

- Node.js 22 and Yarn 1 (`npm install -g yarn`).
- `yarn` installs everything. Electron (standard build, version pinned in `package.json`) downloads itself the first time it runs.
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
| EnableNodeCliInspectArguments | off | `--inspect` cannot attach a debugger |
| EnableEmbeddedAsarIntegrityValidation | on | `app.asar` is checked against a hash stored in the executable |
| OnlyLoadAppFromAsar | on | the app is only loaded from `app.asar` |
| EnableCookieEncryption | on | website-tab cookies are encrypted on disk |

Native addons (`*.node`) and WebAssembly (`*.wasm`) stay unpacked in `app.asar.unpacked`. To check a build: `npx @electron/fuses read --app "out/Cue Desk-linux-x64/cue-desk"` (on Windows, point `--app` at `cue-desk.exe`).

## Building without Electron headers (FND-3)

Packaging rebuilds native modules (zlib-sync) for Electron, which downloads Electron's C++ headers from electronjs.org. Where that site is blocked, set `CUE_DESK_SKIP_NATIVE_REBUILD=1`:

```
CUE_DESK_SKIP_NATIVE_REBUILD=1 yarn package
```

The package then contains zlib-sync built for Node.js, which Electron cannot load. That is harmless: discord.js treats zlib-sync as optional and falls back to its built-in compression. Use this only for local testing; CI and release builds never set it.

## Dependency audit

`scripts/audit-check.mjs` runs `yarn audit` on shipped libraries and fails on any high or critical advisory not in `scripts/audit-allowlist.json`. To accept one temporarily, add an entry with `id` (GHSA), `package`, `reason` and the `backlog` item that removes it, and update `reviewed`. Devtools such as Electron are not audited by this gate; Electron upgrades are tracked as SEC-1. Electron supports its three newest major versions; check https://releases.electronjs.org before each release and upgrade when the current major nears end of life. When upgrading, update `FALLBACK_CHROME_VERSION` in `src/main/userAgent.ts`.

## CI

`.github/workflows/`:

- `ci.yml`: every push and pull request. Type check, lint, tests with coverage (artifact `coverage-report`), script tests, audit gate, gitleaks secret scan.
- `codeql.yml`: CodeQL security analysis, also weekly.
- `release.yml`: on `v*` tags or by hand. Runs `ci.yml`, then builds the unsigned Windows x64 installer and zip and attaches them to a draft release.

Third-party actions are pinned by full commit SHA with the version in a comment. To update one, look up the tag's commit (`git ls-remote https://github.com/OWNER/ACTION refs/tags/vX.Y.Z`; for annotated tags use the `^{}` line) and change both.

## Releases

1. Bump `version` in `package.json`, update `CHANGELOG.md`.
2. Commit, then tag `vX.Y.Z` (must equal the version) and push the tag.
3. The Release workflow creates a draft release with `cue-desk-X.Y.Z-win32-x64-setup.exe`, `RELEASES`, the `.nupkg`, the zip and `SHA256SUMS.txt`.
4. Complete `docs/RELEASE_CHECKLIST.md`, then publish the draft. Installed apps pick it up through update.electronjs.org, which needs the repository to stay public and ignores drafts and pre-releases.

Builds are unsigned. Upstream's signed flow (DigiCert KSP Windows signing, Apple signing and notarisation) is kept in `publish/` but not used; its scripts still name upstream's repository and app paths and need updating before use. Its workflow, `publish-stable.yaml`, was removed in 0.1.0 and is in git history. macOS auto-update is off until macOS builds are signed (`UPDATE_PLATFORMS` in `src/main/updateFeed.ts`).

## Renaming the app

- Display name: `productName` in `package.json`. Also update the page titles in `src/index.html` and `src/player/index.html`, and the text in `README.md`, `NOTICE` and `CHANGELOG.md`.
- Package and executable name: `name` in `package.json`. This changes the installer name and the Windows app ID; a new name installs as a separate app, so plan it before the first public release.
- Do **not** change `dataFolderName` in `src/main/appIdentity.json`: it keeps users' libraries where they are.
- GitHub repository: `github` in `src/main/appIdentity.json`, plus the links in `package.json`, `README.md` and `.github/`.
