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
| GrantFileProtocolExtraPrivileges | on (Electron's default) | the app's own pages load from `file:` inside `app.asar`, which needs it (checked in the WP1 security fixes: with it off no page loads). Local-file tabs do not use `file:` (`docs/security.md` > WP1 security fixes) |

Native addons (`*.node`) and WebAssembly (`*.wasm`) stay unpacked in `app.asar.unpacked`. To check a build: `node scripts/check-release-fuses.mjs "out/Lyre-linux-x64/lyre"` (on Windows, `lyre.exe`); it fails on a test build or any loosened fuse, and `release.yml` runs it on every release build. `CUE_DESK_E2E_BUILD=1` is refused by `yarn make` and `yarn publish`, so a test build cannot become an installer.

Do not package from a git worktree whose `node_modules` is a symlink to another checkout: Electron Forge deletes every `.bin` folder it finds in the copied app, follows the symlink, and empties the other checkout's `node_modules/**/.bin`; the packaged app is also broken. Give each worktree a real `node_modules` (`yarn install`, or `cp -al` of another checkout's).

## Building without Electron headers (FND-3)

The app has no modules compiled from C++ (zlib-sync was dropped in FND-10: discord.js works without it), so packaging needs no Visual Studio and no Electron headers. `CUE_DESK_SKIP_NATIVE_REBUILD=1` skips Electron Forge's native rebuild step and is kept for a future native module:

```
CUE_DESK_SKIP_NATIVE_REBUILD=1 yarn package
```

Prefer libraries without C++ code (WebAssembly, prebuilt binaries for Electron, or Node built-ins such as `node:sqlite`): a module compiled from source needs a C++ toolchain on every build machine.

## Help articles (FND-8)

Help's articles live in `src/lyre/help/articles/`, one Markdown file each, named `<number>-<id>.md`; the number
gives the order in the panel. To add one:

1. Write the file. It starts with its head between two `---` lines: `title:`, `group:` (Get started, Prepare, Run a
   session or Your library) and `words:` (more words a search should find it by). Then plain paragraphs, `- ` lists
   and `1. ` steps, each item on one line; `**Label**` for a name on screen, `` `Key` `` for a key. Nothing else
   is read: no links, pictures or HTML. Keep it under 300 words, in plain words, and check it against the app.
2. Import it in `src/lyre/help/articles.ts` (`FILES`). `articles.test.ts` fails until every file is imported, and
   checks the head, the group and the length.
3. Rebuild the prototype (`node design/prototype/src/build.js`): it shows the same files.

## End-to-end tests (FND-4)

`e2e/` holds Playwright tests that start the packaged app. Playwright drives Electron through `--inspect`, which release builds switch off, so build a test package first:

```
CUE_DESK_E2E_BUILD=1 yarn package        # add CUE_DESK_SKIP_NATIVE_REBUILD=1 if headers cannot be downloaded
yarn e2e                                 # on Linux without a desktop: xvfb-run -a yarn e2e
yarn e2e playlists                       # one spec file (file names are listed in docs/testing.md)
```

Rebuild the package after any change under `src/`; changes to `e2e/` need no rebuild.

- `e2e/fixtures/app.ts` starts the app with a new empty data folder (`CUE_DESK_USER_DATA_DIR`, which also skips the Kenku FM carry-over; only test builds read it, release builds ignore it) and finds pages by title (`Lyre`, `Lyre Player`, `Audio Capture`). New specs import `test` and `expect` from it. `launchApp` starts further copies, for tests that restart the app (same data folder by default, or `{ userDataDir: null, env: { XDG_CONFIG_HOME } }` for the normal folder under a private appData).
- After every test the fixture fails the test if anything went wrong while the app ran (`e2e/fixtures/problems.ts`): an uncaught page error, a console error in any page, a main-process crash, a Content-Security-Policy refusal or an "Ignored a … message" from the IPC guard. A test that causes a console error on purpose lists it in `errors.ignoredConsole`.
- Helpers: `fixtures/audio.ts` writes sine-tone WAV files, `fixtures/localSite.ts` serves test pages on 127.0.0.1 (tests cannot reach the internet), `fixtures/player.ts` holds the playlist and soundboard steps. Audio files are added through the app's own file chooser (Playwright's `filechooser` event), so the real import code runs.
- `CUE_DESK_EXECUTABLE` runs the tests against another build.
- On Linux as root (containers, CI) the Chromium sandbox is switched off for the test run only.
- Failures leave a trace, screenshots and the main-process log in `test-results/`.

CI runs the e2e job on Windows (`.github/workflows/ci.yml`). To run every spec and end-to-end test on GitHub instead of here (about 20 minutes, split across machines), push a branch named `ci/<name>`: `git push <remote> HEAD:ci/<name>` (docs/testing.md > Specs > On GitHub).

## Background pictures

The player's 23 built-in background pictures (`src/player/backgrounds/*.jpg`) are painted by code: `scripts/backgrounds/paint.mjs` draws each scene on a canvas from a fixed random seed, and `scripts/backgrounds/render.mjs` runs it in Playwright's Chromium and saves 1600×1000 JPEGs (quality 0.82). The file names are the background names Kenku FM stored, so do not rename them ("butterflys" is Kenku FM's spelling).

```
node scripts/backgrounds/render.mjs                    # repaint all 23 into src/player/backgrounds
node scripts/backgrounds/render.mjs tavern stars       # only these
node scripts/backgrounds/render.mjs --sheet sheet.png  # also save a contact sheet, shown as the player's cards show them
node scripts/backgrounds/render.mjs --check            # repaint in memory and compare with the saved files
```

The script fails if a picture is over 250 KB or if white text on it would be hard to read: it applies the playlist page's own overlay and requires 4.5:1 contrast (WCAG AA) against the brightest 5% of the picture, separately for the title and the track list. With the same Chromium build the files come out byte for byte the same; another Chromium version may change a few pixels (`--check` says which). If Playwright's own Chromium is missing, the script uses the newest `chromium-*` build in the Playwright browser folder. `yarn test:scripts` checks the names and the seeded randomness; `src/player/backgrounds/index.test.ts` checks the files. The pictures are original to this project and GPL-3.0 (`src/player/backgrounds/LICENSE.md`). Any image file put in that folder is bundled, so keep only the 23 there.

## Demo kit

The demo kit lets the product owner try every feature of a release, and run its test script, without his own library. It is a zip next to the installer on each release, `Lyre-X.Y.Z-demo-kit.zip`, holding a folder `Lyre-demo-kit` with:

| Folder | Contents |
| --- | --- |
| `Music/` | Four cues, 44.1 kHz stereo WAV, 30-33 s, about -16 LUFS: "Tavern Warmth - lute-like plucks, gentle (loops well)", "Tense Crossing - low pulse, builds", "Heroic Sting - short rise, don't loop", "Melancholy Drift - pad, fades" |
| `Ambience/` | Two 30 s loops, mono 22.05 kHz, about -22 LUFS: rain and wind, hearth fire |
| `Effects/` | Five one-shots, mono 44.1 kHz, about -18 LUFS: sword clash, door knock, magic chime, thunder, coin pouch |
| `Local soundboard/` | `soundboard.html`, `notes.txt` and three of the effects in `sounds/`: a page to open from the address bar (SEC-15). Its buttons play the sounds next to it, read `notes.txt` (allowed), and try `../README.txt` and `https://example.com` (both should show "Blocked" in Lyre) |
| `Extra formats/` | From 0.3.0: an AIFF copy of the magic chime (the Lyre tab plays it through a converted copy) and a text file named `….mp3` (the Lyre tab refuses it as not audio) |
| `README.txt` | What the kit is and how to use it, in plain words |

Every WAV carries RIFF INFO tags (title: the part of its name before " - "; artist "Lyre demo kit"; album "Lyre demo kit: <folder>"), so the Lyre tab's Library shows file tags; the test reads them back with music-metadata, Lyre's own tag reader.

Everything is made by `scripts/demo-kit/build.mjs` with Node.js only (no libraries, no network): the music is composed and synthesised in code (plucked strings, additive pads and brass, a Freeverb-style reverb), the ambience and effects come from filtered noise and resonators, and each sound is brought to its loudness (ITU-R BS.1770, the "LUFS" measure) with peaks held under -1.5 dBFS by a limiter. Random numbers come from fixed seeds, so the same Node.js version always builds byte-identical files and zip.

```
node scripts/demo-kit/build.mjs              # out/demo-kit/Lyre-demo-kit/ and out/make/Lyre-<version>-demo-kit.zip
node scripts/demo-kit/build.mjs --out <dir>  # the same under <dir>
```

The version in the zip's name and in `README.txt` comes from `package.json`. Building takes about 10 seconds; the zip is about 23 MB and must stay under 25 MB, which is why the ambience is mono at half the sample rate. `release.yml` builds the kit after the installer and lists it in `SHA256SUMS.txt`.

| File | What it holds |
| --- | --- |
| `scripts/demo-kit/build.mjs` | The list of sounds and their targets, the kit layout, the zip |
| `scripts/demo-kit/music.mjs`, `sounds.mjs` | The four cues; the ambience and effects |
| `scripts/demo-kit/synth.mjs` | Voices (plucked string, additive, bell, drum), filters, reverb, echo, loop helpers |
| `scripts/demo-kit/audio.mjs` | Loudness meter, limiter, WAV reading and writing |
| `scripts/demo-kit/zip.mjs` | A small ZIP writer (deflate, fixed dates) and reader |
| `scripts/demo-kit/files/` | `README.txt` (with `{{version}}`), `soundboard.html`, `notes.txt` |

`yarn test:scripts` runs `scripts/demo-kit.test.mjs`: every file present and safe to name on Windows, valid WAV headers, lengths, peaks below -1 dBFS, loudness within 1.5 LU of its target, seamless loop points, the soundboard's sounds present, the zip readable, matching the folder and under 25 MB, and two builds byte-identical. `e2e/demoKit.spec.ts` builds the kit, adds its music to a playlist and plays it, and opens `soundboard.html` from the address bar to check its buttons.

To listen-check a change without speakers, draw each sound with ffmpeg (a check on the build machine only; the script does not need it): `ffmpeg -i in.wav -filter_complex "showspectrumpic=s=1000x300:scale=log:fscale=log" out.png` shows silence, clipping or harsh noise at a glance, and `ffmpeg -i in.wav -af ebur128=peak=sample -f null -` prints loudness and peak (it agrees with the script's meter within 0.2 LU).

## Dependency audit

`scripts/audit-check.mjs` runs `yarn audit` on shipped libraries and fails on any high or critical advisory not in `scripts/audit-allowlist.json`. To accept one temporarily, add an entry with `id` (GHSA), `package`, `reason` and the `backlog` item that removes it, and update `reviewed`. Electron is listed as a devDependency (Electron Forge expects that) but ships inside the app, so the gate audits it as well; the other devtools are not audited. Electron supports its three newest major versions; check https://releases.electronjs.org before each release and upgrade when the current major nears end of life. When upgrading, update `FALLBACK_CHROME_VERSION` in `src/main/userAgent.ts`.

New libraries are added only at versions published at least two weeks earlier, their dependencies included: after `yarn add <name>@<version> --exact`, check every new `yarn.lock` entry with `npm view <name> time` and pin any newer one under `resolutions` in `package.json` to the newest release old enough. Wave 3 pins `strtok3` 10.6.2, `token-types` 6.1.2 and `@borewit/text-codec` 0.2.2 for `music-metadata` 11.16.1 (MIT, reads track tags and lengths). `ffmpeg-static` 5.3.0 bundles an ffmpeg binary (GPL-3.0-or-later, compatible with the app's GPL-3.0); its postinstall downloads the binary for the building machine's platform, so the Windows installer is built on Windows.

### Outdated libraries (FND-7, checked 6 November 2026)

Upgraded in 0.5.0: fastify 4 to 5.12.7, uuid 10 to 11.1.1 (SEC-9); discord.js 14.27.0, @discordjs/voice 0.19.2, libsodium-wrappers 0.8.4, TypeScript 5.9.3. Left, and why:

- The old player's interface libraries (MUI 6, @dnd-kit/core 3 and /sortable 4, react-router 6, redux-persist, electron-store 8, @reduxjs/toolkit and react-redux): only the old player and the main window's shell use them; they leave with the old player (FND-16) rather than be rewritten for it. react-router 6 has two moderate advisories that do not reach the player (no server rendering, no links to outside addresses).
- React 19: the new interface and the old player share React 18; moving both at once is a change of its own, best after FND-16.
- Electron 45, Electron Forge 8, @electron/fuses 2, @electron/asar 4: majors that change packaging; Electron 44 is supported until Electron 47 (about March 2027). Electron 44.9.3 and later patches are reviewed in the monthly step (docs/RELEASE_CHECKLIST.md).
- vitest 5, jsdom 31, TypeScript 7, css-loader 7, style-loader 4: test and build tools, majors with breaking changes; they ship nothing.
- music-metadata 12: the library process belongs to the data stream; 11.16.1 has no advisory.
- Newer than 14 days, so not yet: discord.js 14.28, eslint 10.14, typescript-eslint 8.72.1, @playwright/test 1.65, fastify 5.12.8.

## CI

`.github/workflows/`:

- `ci.yml` (FND-5): every push and pull request. Type check, lint, tests with coverage (artifact `coverage-report`), script tests, audit gate, gitleaks secret scan, and on Windows the packaged app's smoke test with the axe accessibility checks (`yarn e2e smoke.spec lyre.spec`); pull requests, "Run workflow" and releases (input `full-e2e`) run every end-to-end test instead (artifact `e2e-report` on failure). About 10 minutes for a push (the jobs run side by side; the Windows job is the longest), about 30 with every end-to-end test. Each job ends, when it fails, with a step that says in plain words what failed and what to do (`::error` annotations, shown on the pull request, and the run summary).
- `specs.yml` (FND-15): on a push to a `ci/<name>` branch, or by hand. Packages the Linux test build once, then runs the app's acceptance specs in eight parts side by side, the prototype's specs and `yarn e2e` against it, and merges the results into the `test-report` artifact with a plain-words summary (how many passed or failed, and which) on the run page. About 20 minutes; see docs/testing.md > Specs > On GitHub.
- `codeql.yml`: CodeQL security analysis on every push, weekly, and when the release calls it.
- `release.yml`: on `v*` tags or by hand. Runs `ci.yml` with every end-to-end test and `codeql.yml`; only when both pass does it build the unsigned Windows x64 installer and zip and the demo kit, and attach them to a draft release.

`scripts/ci-gate.test.mjs` checks these rules in the workflow files (`yarn test:scripts`), and `scripts/electron-support.test.mjs` that Electron stays a pinned, supported, standard release (SEC-1).

Third-party actions are pinned by full commit SHA with the version in a comment. To update one, look up the tag's commit (`git ls-remote https://github.com/OWNER/ACTION refs/tags/vX.Y.Z`; for annotated tags use the `^{}` line) and change both.

## Releases

1. Bump `version` in `package.json`, update `CHANGELOG.md`.
2. Commit, then tag `vX.Y.Z` (must equal the version) and push the tag. Where tags cannot be pushed, push the commit to the `release` branch instead (`git push origin main:release`); publishing the draft then creates the tag on the built commit.
3. The Release workflow creates a draft release with `lyre-X.Y.Z-win32-x64-setup.exe`, `RELEASES`, the `.nupkg`, the zip, `Lyre-X.Y.Z-demo-kit.zip` (see Demo kit) and `SHA256SUMS.txt`.
4. Complete `docs/RELEASE_CHECKLIST.md`, then publish the draft. Installed apps pick it up through update.electronjs.org, which needs the repository to stay public and ignores drafts and pre-releases.

Builds are unsigned. Upstream's signed flow (DigiCert KSP Windows signing, Apple signing and notarisation) is kept in `publish/` but not used; its scripts still name upstream's repository and app paths and need updating before use. Its workflow, `publish-stable.yaml`, was removed in 0.1.0 and is in git history. macOS auto-update is off until macOS builds are signed (`UPDATE_PLATFORMS` in `src/main/updateFeed.ts`).

## Renaming the app

The app was renamed from Cue Desk (working name) to Lyre before its first public release; `docs/brand.md` has the logo and how to rebuild the icons.

- Display name: `productName` in `package.json`. Also update the page titles in `src/index.html` and `src/player/index.html` (the e2e fixture finds pages by these titles), the player tab title in `src/renderer/features/player/playerSlice.ts`, and the text in `README.md`, `NOTICE` and `CHANGELOG.md`.
- Package and executable name: `name` in `package.json`. This changes the installer name and the Windows app ID; a new name installs as a separate app, so plan it before the first public release.
- Do **not** change `dataFolderName` in `src/main/appIdentity.json` after a public release: it keeps users' libraries where they are. If it must change, add the old folder to the front of `earlierApps` so the first start copies the library across (with its own `kind` if it keeps files Kenku FM did not; see `CUE_DESK_ITEMS` in `src/main/migration/carryOver.ts`).
- `.github/workflows/release.yml` checks the fuses of `out/<productName>-win32-x64/<name>.exe`; update that path with the names.
- GitHub repository: `github` in `src/main/appIdentity.json`, plus the links in `package.json`, `README.md` and `.github/`.
