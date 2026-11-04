# Architecture

Lyre is an Electron app (Electron 44) built with Electron Forge and webpack. Every page is TypeScript; the interface uses React 18, Redux Toolkit and MUI.

```
 Main window (renderer)          Tabs (WebContentsView)              Hidden capture window
 src/renderer, preload.ts  --->  websites, or the player page   ---> src/audioCapture, preload/managers
          |  IPC                 src/player                          getUserMedia(tab audio) -> mix
          v                             ^                            -> 20 ms frames -> Opus (WebCodecs)
 Main process  src/index.ts, src/main   |  IPC (remote commands)           |  MessagePort (private)
   SessionManager -> PlaybackManager -> AudioCaptureManagerMain ------------+-> OutputManager -> DiscordBot (one per bot) -> Discord
                  -> BrowserViewManagerMain, WindowManager
                  -> PlayerManager -> fastify remote API (127.0.0.1:3333 by default)
```

## Main process

- `src/index.ts`: start-up. Its first import, `src/main/migration`, points the data folder at `<appData>/lyre` (and sets the Windows app ID). `src/main/startup.ts` then runs the Windows installer check (`electron-squirrel-startup`), the single-instance lock and, in the one primary instance only, the library carry-over from the newest earlier app that has one (Cue Desk, then Kenku FM; `src/main/migration/carryOver.ts`), before any window or settings file is created. If that app was still running or the library failed to copy, a prompt offers to quit so the copy is retried on the next start. After that: session hardening, the main window (with the `window.navigator` user agent), auto-update and a few IPC handlers (`GET_VERSION`, `GET_PLATFORM`, `CLEAR_CACHE`).
- `src/main/security`: `sessions.ts` applies deny-by-default permission handlers and the request-header user-agent spoofing (a Chrome user agent, without the Chrome token for google.com sign-in) to the app's session and to the website-tab session (`persist:tabs`, `partitions.ts`), and clears both on "Clear cache". `navigationGuards.ts` keeps app pages on their own page, `externalLinks.ts` sends only https links to the system browser, `trustedContents.ts` records which web contents are the app's own pages.
- `src/main/managers/SessionManager.ts`: one per main-window load; creates and destroys the managers below.
- `BrowserViewManagerMain.ts`: the tabs. Each tab is a `WebContentsView` laid over the main window. Website tabs use the separate `persist:tabs` session; the player view uses the app's own session and preload.
- `PlaybackManager.ts`, `AudioCaptureManagerMain.ts`: start the capture window's broadcast when an output joins a voice channel and stop it when the last one leaves (PERF-4); while broadcasting, ask the capture window for a view's audio when Chromium reports the view audible (or an audio/video element starts) and release it after 30 seconds of silence. Encoded Opus packets come back over a private `MessageChannelMain` port (SEC-2: no network socket) and go to `src/main/broadcast/OutputManager.ts` (OUT-1): this computer's speakers plus any number of `DiscordBot`s, each with its own discord.js client, `@discordjs/voice` audio player and voice connections, playing the packets as an `Opus` stream (`opusFeed.ts`, no encoding on the main process). Bot tokens are kept by `botTokenStore.ts`, encrypted with `safeStorage` (SEC-5). OUT-2: a dropped voice connection, or a lost login that had worked, is retried after 1, 2, 4, 6, 8 and 10 s; then the output shows an error until Reconnect is pressed. While it waits, the state carries the attempt's due time (`retryAt`, noted by `retryClock.ts`), so the sidebar counts down and offers "Try now". A token Discord refuses is forgotten and explained in plain words (`OutputManager.plainBotError`). The interface shows a status chip per output (`src/renderer/features/output/OutputStatusChip.tsx`). `discordDriver.ts` lets tests swap in a fake Discord (`testing/fakeDiscord.ts`, also used by test builds started with `CUE_DESK_FAKE_DISCORD=1`).
- `WindowManager.ts`: minimise, maximise and close for the frameless window.
- `src/menu.ts`: application menu. `src/bounds.ts`: window position, stored with electron-store in `config.json` (opened on first use, so it never touches the file before the carry-over).
- `src/autoUpdate.ts` with `src/main/updateFeed.ts`: Windows updates from the fork's GitHub releases through update.electronjs.org, only for copies set up by the installer (the zip build has no `Update.exe` and gets no updates).
- `src/main/appIdentity.json` and `appIdentity.ts`: data-folder name, the earlier apps whose library the first start may copy, app ID and GitHub repository, shared with `forge.config.js`.
- `src/common/domain`: the rules of the agreed design (DAT-12), pure and unit-tested: scene music order (tracks and playlists mixed, no track twice in a row), audio profiles resolved scene, then playlist, then track (PLY-12) with fade curves, dynamic playlist rules, FX (effects and stings), where playlists, boards and tracks are used, and which room an action plays in. The database, the engine and the new interface all use it. Its source of truth is the design prototype in `design/prototype` (see its README).
- `src/common/helpLinks.ts`: the help pages the interface links to (Lyre's README; Kenku FM's site only for its Stream Deck plugin).
- `src/assets/brand`: logo and wordmark sources; `scripts/brand` makes the icons and installer images from them (see `docs/brand.md`).

## Main window (renderer)

`src/renderer` (entry `src/renderer.ts`, preload `src/preload.ts`). The shell around everything: tab bar and URL bar, bookmarks, Discord connection and output channel, inputs, settings. The preload exposes a fixed list of IPC channels as `window.kenku`.

Website and player views are drawn by Electron above this page, so nothing of the page may sit under them:

- `src/renderer/common/viewOverlay.ts` watches `<body>` for MUI's modal portals (every Dialog, Menu, Popover and Select list). While one is open, `Tabs` hides the current view; a Dialog marked with `sidePanelProps` (Settings, the bookmark and folder editors) moves the view to its right edge instead (`getBounds`). New dialogs and menus need nothing extra.
- Error messages (`src/renderer/features/errors`) are part of the sidebar's layout, or of Settings while it is open; with the sidebar collapsed they get a column beside it and the view moves right. The main process may send a cause with an error (`ERROR`, message, `{ kind: "output", id }` or `{ kind: "address" }`, `src/common/errorCause.ts`); such a message closes by itself once the bot has no problem left, or once an address opens. Others stay until closed (WCAG 2.2.1).
- The keyboard focus outline is defined once in `src/renderer/app/theme.ts` (`FOCUS_RING_COLOR`), shared with the player.
- Rows that can be dragged (`common/SortableItem.tsx`) are picked up by the keyboard only from their `DragHandle` (the site icon); screen readers hear `dragAnnouncements.ts`.

## Player view

`src/player` (entry `src/player/renderer.ts`, preload `src/player/preload.ts`). The built-in music player, loaded into a tab like a website. Playlists and soundboards live in Redux slices under `src/player/features`; audio plays with Howler (`soundboards/Sound.ts`, `playlists/usePlaylistPlayback.ts`). Folder and file import: `src/player/common/useFolderDrop.ts`, `useFileDrop.ts`. Its preload exposes `window.player`.

The new playback engine (WP4) is in `src/player/engine`: a Web Audio graph with music, ambience, effects, whisper and preview buses, a master and separate table, whisper and preview outputs, plus the queue rules. The screens do not use it yet (WP5). See `docs/playback-engine.md`.

Background pictures: a playlist or soundboard stores its background as a name (`"tavern"`) or as an address of its own. The names are Kenku FM's 23; the pictures are Cue Desk's own, painted by `scripts/backgrounds` (see `docs/DEVELOPING.md` > Background pictures) and kept as JPEG files in `src/player/backgrounds`. `src/player/backgrounds/index.ts` bundles every picture in that folder at build time with webpack's `require.context` (`backgroundList.ts` turns the files into `{ name: address }`, always with `blank`, which Cue Desk 0.1.0 saved on new playlists). Nothing is read from an installed Kenku FM at run time; the only thing taken from Kenku FM is the user's own library, once, on first start (`src/main/migration`).

## Capture window

`src/audioCapture` with `src/preload/managers/AudioCaptureManagerPreload.ts` and `PCMStream.worklet.js`. A hidden window that, during a broadcast only, captures the audio of tabs that play sound (and the input devices switched on) with `getUserMedia`, mixes it in a Web Audio context, cuts it into 20 ms frames on the audio thread (silent frames are skipped) and encodes them to Opus with WebCodecs `AudioEncoder`. The audio context exists only during a broadcast and is suspended while nothing is connected. Sandboxed (SEC-12), with background throttling off so the hidden window keeps real-time pace.

## Remote API

`src/main/remote` registers fastify routes on the server that `PlayerManager` starts when Remote is enabled in Settings: `/v1/playlist`, `/v1/playlist/play`, `/v1/playlist/playback`, `/v1/soundboard`, `/v1/soundboard/play`, `/v1/soundboard/stop`, `/v1/soundboard/playback`. Routes forward commands to the player view over IPC. Used by the Stream Deck plugin. No authentication yet (backlog SEC-4).

## Data storage

Everything lives in one folder, `<appData>/lyre` (`%APPDATA%\lyre` on Windows), fixed in `appIdentity.json` so renaming the app does not move it.

| What | Where | Written by |
| --- | --- | --- |
| Bookmarks, settings (`persist:root`) | `Local Storage/leveldb` | `src/renderer/app/store.ts` (redux-persist) |
| Discord bots and their tokens, encrypted with the OS keyring (SEC-5; tokens kept in memory only where there is none) | `discord-bots.json` | `src/main/broadcast/botTokenStore.ts` |
| Playlists and soundboards (`persist:player`), playback state (`persist:playback`) | `Local Storage/leveldb` | `src/player/app/store.ts` |
| Window position | `config.json` | `src/bounds.ts` |
| Website tab cookies and storage | `Partitions/tabs` | Chromium (`persist:tabs` session) |
| No longer used: background pictures Cue Desk 0.1.1 copied from an installed Kenku FM (only in the old `cue-desk` folder; Lyre neither reads nor copies it). | `backgrounds/` (in `cue-desk`) | nothing (see README > First start) |
| Carry-over record from Cue Desk or Kenku FM (folder and item names only; written once the copy succeeded or was not needed) | `data-carry-over.json` | `src/main/migration` |

The app's own pages load from `file://` (packaged) so they share one localStorage origin; websites in tabs keep their data apart in `persist:tabs`. Audio files are not copied; tracks store their file paths. The bot token is stored in plain text for now (backlog SEC-5).

A new library database (`<appData>/lyre/library/library.sqlite`, with daily backups in `library/backups/`) is built in `src/main/data` (WP3) for the new interface. Nothing uses it yet: the player keeps the storage above until DAT-9 moves the library across. See `docs/data-model.md`.

## WP2 Tabs

- Files from the user's computer (SEC-15) open only after the main process has asked (`src/main/security/localFiles.ts`), in tabs of their own in the `persist:local-files` partition (`Partitions/local-files` in the data folder). Folders the user chose not to be asked about again are saved by the main process in `local-files.json` in the data folder and listed in Settings > Local files (`src/renderer/features/settings/LocalFilesSettings.tsx`).
- Files open from their own scheme, `cue-local-file://<folder id>/<file>`, served by the main process on the `persist:local-files` session only (`src/main/security/localFileServer.ts`, installed by `sessions.ts`): a page reads files from its own folder and subfolders and nothing else, under a strict Content-Security-Policy. The address bar and bookmarks still show the file's `file:///…` address (WP1 security review).
- Hidden tabs: Lyre adds no throttling of its own. Chromium already slows hidden, silent tabs, and since PERF-4 a tab is captured only while it plays (released after 30 s of silence), so a silent hidden tab is no longer kept "visible" by the capture. The PERF-5 debugger throttling was removed after the WP1 security review measured it adding almost nothing (`e2e/hiddenTabs.spec.ts` checks that a hidden playing tab keeps playing).
- Bookmarks can be grouped in folders, and the sidebar collapses to a column of icons (UX-10). Both are saved with the bookmarks in `persist:root` (version 5; `src/renderer/features/bookmarks/bookmarksMigration.ts` adds the empty folder list to bookmarks saved before). The sidebar's width is `src/renderer/features/bookmarks/sidebar.ts`; website views are placed from the sidebar's current width (`getBounds`).

The app's own pages load from `file://` (packaged) so they share one localStorage origin; websites in tabs keep their data apart in `persist:tabs`. Audio files are not copied; tracks store their file paths. Bot tokens are never stored in plain text (SEC-5); an older version's token is moved out of `persist:root` once (redux-persist migration 5).

## Wave 2: Data schema

DAT-11 (with DAT-1, DAT-2, DAT-10, ORG-4, ORG-7, EDT-2) brings the library database (`src/main/data`) to the agreed design (round 4, `design/prototype`) in one upgrade step, `schema/v002-design.ts`, normalised to third normal form with integrity in the schema. `docs/data-model.md` is the full reference (ER diagram, every table's keys, constraints and normal form, the deliberate exceptions, and each index with the read path it serves). Still not used by the old player; the new interface (wave 3) reaches it from the main process.

- **Tracks**: kind (music, amb, fx), the game master's title (may be empty), the file-tag title, file name and location; roles include `effect`; loop advice yes/crossfade/no.
- **Playlists**: manual or dynamic, lane music/amb/fx, notes. A dynamic rule is rows (`rule_conditions`, `rule_condition_tags`) naming tags by key, so tag renames, merges and deletes reach every rule.
- **Pad boards**: a 1–8 × 1–8 grid; `pads` sit in a cell or among the spare pads (never deleted when the board shrinks); `pad_sounds` are the tracks a pad plays.
- **Campaigns, sessions, scenes**: theme (default candle), system, description, Obsidian fields; ordered playlists and boards per campaign and per session; session number (unique per campaign), date, status (one `next` per campaign, partial unique index); scenes with "starts when", an ordered music list of tracks and playlists, one ambience item and ordered boards.
- **Audio profiles**: typed columns in `audio_profiles` keyed by (track, place) (own, playlist or scene) with markers in `audio_profile_markers`; handed out as `ProfileOverrides` keyed by `placeKey`.
- **Domain shapes** (`repo/domain.ts`): `getDomainLookup`, `getDomainCampaign`/`listDomainCampaigns`, `listUses` (same answers as `usesOf*`), `listPlaylistTrackIds` (same as `playlistTracks`, in SQL) and `getProfileOverrides` feed `src/common/domain` directly; `repo/domain.test.ts` checks them against the prototype's own sample data.
- **Checks**: `schema/v002.test.ts` (upgrade from version 1 with data, every constraint), `queryPlan.test.ts` (EXPLAIN QUERY PLAN of every hot read path: index searches only), `undo.test.ts` (every write undone and redone exactly), `performance.test.ts` (20,000 tracks, 500 playlists, 3 campaigns × 50 sessions × 8 scenes: campaign tree about 5 ms, dynamic playlist up to 7 ms, uses under 1 ms, search up to 14 ms).
- `library.close()` runs `PRAGMA optimize` to keep the query planner's statistics current.
