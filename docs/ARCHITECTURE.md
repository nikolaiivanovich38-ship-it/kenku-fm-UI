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
- `src/autoUpdate.ts` with `src/main/updateFeed.ts`: Windows updates from the fork's GitHub releases through update.electronjs.org, only for copies set up by the installer (the zip build has no `Update.exe` and gets no updates). `src/main/updateStatus.ts` (SEC-14) keeps what the updater is doing; the first failure of a run is shown in the main window in plain words, and the Lyre page reads the state through `window.lyre.updates` (UPDATE_GET, UPDATE_STATE).
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

`src/player` (entry `src/player/renderer.ts`, preload `src/player/preload.ts`). The built-in music player, loaded into a tab like a website. Playlists and soundboards live in Redux slices under `src/player/features`; audio plays with Howler (`soundboards/Sound.ts`, `playlists/usePlaylistPlayback.ts`). A soundboard sound is decoded whole (Web Audio) only when it has no fade-out and is known to be 30 s or shorter; others stream (PERF-7, `soundboards/soundLengths.ts` remembers each sound's length in the player page's localStorage, key `lyre.soundLengths`). Folder and file import: `src/player/common/useFolderDrop.ts`, `useFileDrop.ts`. Its preload exposes `window.player`.

The new playback engine (WP4) is in `src/player/engine`: a Web Audio graph with music, ambience, effects, whisper and preview buses, a master and separate table, whisper and preview outputs, plus the queue rules. The screens do not use it yet (WP5). See `docs/playback-engine.md`.

Background pictures: a playlist or soundboard stores its background as a name (`"tavern"`) or as an address of its own. The names are Kenku FM's 23; the pictures are Cue Desk's own, painted by `scripts/backgrounds` (see `docs/DEVELOPING.md` > Background pictures) and kept as JPEG files in `src/player/backgrounds`. `src/player/backgrounds/index.ts` bundles every picture in that folder at build time with webpack's `require.context` (`backgroundList.ts` turns the files into `{ name: address }`, always with `blank`, which Cue Desk 0.1.0 saved on new playlists). Nothing is read from an installed Kenku FM at run time; the only thing taken from Kenku FM is the user's own library, once, on first start (`src/main/migration`).

## Capture window

`src/audioCapture` with `src/preload/managers/AudioCaptureManagerPreload.ts` and `PCMStream.worklet.js`. A hidden window that, during a broadcast only, captures the audio of tabs that play sound (and the input devices switched on) with `getUserMedia`, mixes it in a Web Audio context, cuts it into 20 ms frames on the audio thread (silent frames are skipped) and encodes them to Opus with WebCodecs `AudioEncoder`. The audio context exists only during a broadcast and is suspended while nothing is connected. Sandboxed (SEC-12), with background throttling off so the hidden window keeps real-time pace.

## Remote API

`src/main/remote` registers fastify routes on the server that `PlayerManager` starts when Remote is enabled in Settings: `/v1/playlist`, `/v1/playlist/play`, `/v1/playlist/playback`, `/v1/soundboard`, `/v1/soundboard/play`, `/v1/soundboard/stop`, `/v1/soundboard/playback`. Routes forward commands to the player view over IPC. SEC-4 (0.5.0): the settings live in the main process (`remoteSettings.ts`, `remote-control.json`; off until turned on, 127.0.0.1 by default), `remoteControl.ts` starts and stops the server to match, and `remoteServer.ts` locks it: every request needs the secret code (`Authorization: Bearer <code>`), web pages and web names are refused, bodies are JSON only, requests and wrong codes are rate-limited, and answers carry no file addresses. The Lyre page reads and changes the settings through `window.lyre.remote` (REMOTE_GET, REMOTE_SET, REMOTE_NEW_CODE); it is the only place that turns the remote control on (review 0.5.0 CR-3: the main window's old Settings only points there, and its 0.4.1 choice is moved in once through REMOTE_MOVE_OLD_SETTING). The main process listens only on 127.0.0.1 or a private address this computer has (CR-2). See `docs/security.md` > w6-found and review-0.5.0 fixes.

## Data storage

Everything lives in one folder, `<appData>/lyre` (`%APPDATA%\lyre` on Windows), fixed in `appIdentity.json` so renaming the app does not move it.

| What | Where | Written by |
| --- | --- | --- |
| Bookmarks, settings (`persist:root`) | `Local Storage/leveldb` | `src/renderer/app/store.ts` (redux-persist) |
| Discord bots and their tokens, encrypted with the OS keyring (SEC-5; tokens kept in memory only where there is none) | `discord-bots.json` | `src/main/broadcast/botTokenStore.ts` |
| Playlists and soundboards (`persist:player`), playback state (`persist:playback`) | `Local Storage/leveldb` | `src/player/app/store.ts` |
| Window position | `config.json` | `src/bounds.ts` |
| Remote control on or off, address, port, and its secret code encrypted with the OS keyring (SEC-4; the code is kept in memory only where there is none) | `remote-control.json` | `src/main/remote/remoteSettings.ts` |
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

## Wave 2: Engine

The show engine sits on top of the WP4 playback engine in `src/player/engine` and is reached by tests only until the new interface (wave 3) uses it. Details: `docs/playback-engine.md` > Wave 2.

- `queue/actions.ts`: `CueAction`, the one action model (PLY-8) for buttons, hotkeys and later the remote API, with `isCueAction` to check one that came from outside.
- `queue/director.ts`: `Director.run(action)` finds the rooms an action names (`roomsFor`; scenes use `sceneRoom`) and keeps one Undo of a scene start (PLY-1).
- `queue/roomPlayer.ts`: one room's music lane (scene or playlist in order, Play next queue, the way back after an off-script track), ambience lane (loops) and effects (one-shots and pads).
- `queue/nowPlaying.ts`: the music lane's rules as pure functions (PLY-10, PLY-1, BUG-11).
- `queue/library.ts`: `ShowLibrary`, what the director reads (domain lookups plus a track's file and a pad's sound, which the domain contract lacks).
- `profile/`: the profile a track plays with in a place, with role defaults (PLY-4, PLY-12); `voice/passPlan.ts` turns a profile into gain ramps on the audio timeline.
- `rooms.contract.ts`: `RoomsAudio`, all the director needs from the Rooms stream (`rooms()`, `getRoomBus(roomId, lane)`, `onRoomsChanged`); `tableOnlyRooms(mixer)` is one room on the engine's own buses until the Rooms stream's implementation is wired.

## Wave 2: Rooms and buses

- PLY-5, OUT-5. **Rooms.** Every bot in a voice channel is a room named after its channel (`roomsOf` in `src/common/outputs.ts`, room id = bot id, first room = the table). `OutputManager` (`src/main/broadcast`) reports `rooms()` and a `roomsChange` event, and puts `rooms` in `OUTPUTS_STATE`.
- **One stream per room.** The capture window (`AudioCaptureManagerPreload`) keeps one mix per room, each with its own volume, frame worklet and Opus encoder; packets go over the private port as `{ room, packet }`, and `OutputManager.sendPacket(packet, room)` hands them to that room's bot only. Each source has a route (`CaptureRoute`: every room, the table, or one room; a departed room means the first). Tabs and input devices follow `DEFAULT_CAPTURE_ROUTE`, which is "all" so the current interface keeps working as in Lyre 0.2; the new interface calls `AudioCaptureManagerMain.setDefaultRoute("table")` and `routeView(viewId, route)`. "This Computer" plays the first room's tabs and input devices, never the Lyre page's room frames (BUG-19, 0.4.1). When a room goes, its mix and encoder are freed at once. PERF-4 (capture only while a bot is in a voice channel), silence release, reconnecting and mute per bot are unchanged.
- **Engine buses** (`src/player/engine/rooms`). `RoomMixer`: per room, music, ambience and effects lanes into a room master with volume and mute; `getRoomBus(roomId, lane)` and `rooms()` (the rooms contract); `output(roomId)` for the host to send on; `setRooms(rooms)` follows the outputs (a new first room takes over the table's mix and sound; a room that goes is cut and reported as `room-removed`). The preview bus and output are separate and never connected to a room. Engine rooms reach their bots over the player audio channel (below).
- OUT-6. `OutputManager.moveBot(botId, channelId)` (IPC `BOT_MOVE_TO_CHANNEL`) moves a bot during play: within a server Discord moves it; to another server it joins first and leaves its old channel once the new one is joining, so the room never disappears; a failed join leaves it where it was. `ROOM_SET_VOLUME` sets a room's volume (applied in the capture window).

## Wave 2: Files and preview

Built and tested, not wired yet (wave 3 and the lead connect it). PLY-11, BUG-10, PRV-1, PRV-2, PERF-7.

**Player page (`src/player/engine/sources`, `src/player/engine/preview`)**

| Module | What it does |
| --- | --- |
| `sources/readAhead.ts` | `ReadAhead`, a `MediaResolver`: the playing track and the next one are read into memory as they are on disk (FLAC, MP3, …) and played from a `blob:` address, so a slow disk or network share cannot make them stutter. The media element still decodes a little at a time (PERF-7). 256 MB in all, 96 MB per file; tracks wanted or playing are never dropped, others go least recently used first and their address is revoked. A bigger file plays from its own address, and the resolver underneath is asked for a disk copy (`keepLocal`). Only `file:` addresses are read. |
| `sources/upcoming.ts` | `upcomingInSequence(seq, at)` and `upcomingInQueue(state)`: the track ids to pass to `ReadAhead.want`, by the same rules as Next. |
| `sources/mainMediaResolver.ts` | `MainMediaResolver`: asks the main process (`MEDIA_PREPARE`) for the address to play each `file:` track: the file itself, a converted copy, or a disk copy. |
| `sources/sourceLoader.ts`, `layers.ts` | A resolver may now hold something for the address it returns (`ResolvedMedia.release`); the loader gives it back when the voice releases the source, or as soon as a buffer is decoded. `MediaRequest.keepLocal` added. |
| `preview/previewOutput.ts` | `PreviewOutput { context, input }`: the only thing the preview depends on. `createPreviewContextOutput()` makes one with an audio context of its own (and `setSinkId`). Fake: `preview/testing/fakePreviewOutput.ts`. |
| `preview/previewPlayer.ts` | `PreviewPlayer`: one preview at a time, toggle, stop, ends by itself, plain announcements; `trackPreview`, `playlistPreview` (first track; "This playlist has no tracks yet"), `padPreview` (decoded). Matches the prototype's `L.preview*`. |
| `preview/outputDevices.ts` | `OutputDeviceChooser`: output device for `"preview"` and `"monitor"`, remembered in localStorage (`lyre.outputDevices`), falls back to the default device with a plain message when the device is gone or refuses, and switches back when it returns. |

Memory bound for audio in the player page: decoded buffers 200 MB (`BufferCache`) plus read-ahead 256 MB. They are two fixed shares rather than one shared budget, which is simpler and still bounded.

**Main process (`src/main/media`)**

| Module | What it does |
| --- | --- |
| `formats.ts` | Which extensions are converted (WMA, ASF, MKA, AIFF, APE, WavPack, TTA, AC-3, Musepack) and whether they are lossless. Everything Chromium plays is left alone. |
| `converter.ts`, `ffmpegConverter.ts` | `AudioConverter` interface; the ffmpeg implementation (no shell, files only, timeout, cancel). Lossless sources become FLAC, lossy ones Opus 192 kbit/s in Ogg. Fake: `testing/fakeConverter.ts`. |
| `mediaAccess.ts` | `MediaAccess`: the local-file rules for library files (see security.md, "Files and preview"). |
| `mediaCache.ts` | `MediaCache`: `<data folder>/media-cache`. Converts once, in the background, one at a time; copies big tracks for `keepLocal`; keyed by real path, size and modified time; `sweep()` removes copies whose source went or changed; 8 GB cap, least recently used first; `index.json` saved atomically. |
| `mediaIpc.ts` | `registerMediaIpc(guard, cache)`: the `MEDIA_PREPARE` handler. |

### Wiring for the lead

Player engine (`src/player/engine/index.ts`):

```ts
export { ReadAhead, DEFAULT_READ_AHEAD, browserObjectUrls } from "./sources/readAhead";
export { MainMediaResolver } from "./sources/mainMediaResolver";
export type { MediaBridge, PrepareAnswer } from "./sources/mainMediaResolver";
export { upcomingInQueue, upcomingInSequence } from "./sources/upcoming";
export { PreviewPlayer, trackPreview, playlistPreview, padPreview } from "./preview/previewPlayer";
export type { PreviewItem, PreviewState } from "./preview/previewPlayer";
export { createPreviewContextOutput } from "./preview/previewOutput";
export type { PreviewOutput, PreviewContextOutput } from "./preview/previewOutput";
export { OutputDeviceChooser, browserDeviceSource, storageChoiceStore } from "./preview/outputDevices";
```

Where the new interface builds the engine:

```ts
const readAhead = new ReadAhead({
  inner: new MainMediaResolver(window.player.media),
  fetchBytes: (url, limit) => readBytes(url, limit),
  makeObjectUrl: browserObjectUrls.make,
  revokeObjectUrl: browserObjectUrls.revoke,
});
const { engine } = createBrowserEngine({ resolver: readAhead });
// Each time the scene step or the queue changes:
readAhead.want(upcomingInSequence(sequence, at).map(mediaRequestOf));
```

Player preload (`src/player/preload.ts`), in the exposed API:

```ts
media: { prepare: (url: string, options: { keepLocal: boolean }) => ipcRenderer.invoke("MEDIA_PREPARE", url, options) },
```

Main process (with `PlayerManager`'s guard; `library.folders()` comes from the library database):

```ts
const mediaCache = new MediaCache({
  folder: path.join(app.getPath("userData"), MEDIA_CACHE_FOLDER),
  access: new MediaAccess({ libraryFolders: () => library.folders() }),
  converter: new FfmpegConverter({ ffmpegPath }), // after the lead adds ffmpeg-static
});
registerMediaIpc(this.ipc, mediaCache);
setTimeout(() => void mediaCache.sweep(), 30_000); // tidy up once the app has started
app.on("before-quit", () => mediaCache.close());
// "Clear cache" in Settings: also mediaCache.clear() here and readAhead.clear() in the player.
```

Preview (PRV-1), once the Rooms stream's isolated preview bus has a route out of the recorded page, or with an output of its own in a page that is not recorded:

```ts
const output: PreviewOutput = rooms.previewOutput; // or createPreviewContextOutput() in an uncaptured page
const previewLoader = new SourceLoader({ context: output.context, createElement, fetchBytes: readBytes, resolver: readAhead });
const preview = new PreviewPlayer({ output, load: (media) => previewLoader.load(media) });
const devices = new OutputDeviceChooser({ devices: browserDeviceSource(), store: storageChoiceStore(localStorage) });
await devices.attach("preview", output /* needs setSinkId */);
await devices.attach("monitor", thisComputerOutput); // "This Computer" (capture window's loopback element)
```

Open points for the lead:

- **Tab capture and a second audio context.** Discord records the player page with tab capture, which may include every audio stream the page plays, whatever its context or device. Until checked, never create the preview output in the player page; use the Rooms bus's route or an uncaptured page. A real-Discord check is listed in the report.
- **Device names and `setSinkId`.** Chromium gives device names, and allows a non-default output device, only to a page with the `media` permission (and possibly `speaker-selection`). The player page has neither; the page that shows the device choice and plays the preview needs them (a `permissions.ts` change for the security owner).

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

- **Player audio channel** (OUT-5, PRV-1). `PlayerAudioBridge` (main process) hands each of the player page and the capture window one end of a private MessageChannel, again whenever either loads; rooms go to the player page as `PLAYER_ROOMS` (`window.player.onRooms`). In the player page, `RoomStreams` (`src/player/engine/rooms/roomStreams.ts`) taps each room's `output(roomId)` with the PCM worklet while a broadcast runs and sends 20 ms frames labelled with the room; the capture window plays them through a `player-frame-inlet` worklet (`src/preload/managers/PlayerFrameInlet.worklet.js`, 40 ms start buffer, at most 200 ms) into that room's mix, beside the tabs routed there. Tab capture is unchanged, so the old player still reaches Discord as a captured tab. The engine's audio context must run at 48 kHz.
- **Preview** (PRV-1, PRV-2). `createBrowserBridgedPreview(link)` gives the `PreviewPlayer` an output in a sink-less audio context; the frames are played by the capture window in a separate preview context (made on first use, closed after 10 s of quiet) on the chosen device (`setSinkId` over the channel). See security.md, "Rooms and buses".
- Host wiring for wave 3 (player page): `const link = new PlayerAudioLink(); listenForPlayerAudioPort(window, link);` `const context = new AudioContext({ latencyHint: "playback", sampleRate: 48000 });` `createBrowserEngine({ audioContext: context, … })`, `const mixer = new RoomMixer(fromAudioContext(context)); window.player.onRooms((rooms) => mixer.setRooms(rooms));` `new RoomStreams({ mixer, link, createTap: await createBrowserFrameTaps(context) })`; the preview: `new PreviewPlayer({ output: await createBrowserBridgedPreview(link), … })`. Never connect a room output to this page's speakers (BUG-19, 0.4.1: what goes to the players is heard only through Discord; before it, the table played on them outside a broadcast).

## Wave 2: Import

EDT-6 (backend), DAT-5, DAT-6, DAT-8, DAT-9, ORG-1 and DAT-4 in `src/main/data/import/` (exported from `src/main/data`), with schema step 3 (`tracks.is_new`, `library_jobs`). No screens, no IPC, nothing wired into the old player; `docs/data-model.md` ("Import", "Bringing in the current player's data") has the details.

- **Adding audio**: `importAudio` walks files and folders, reuses files already in the library, guesses kind from folder names, reads file facts (quick checksum) and tags, and saves 500 tracks per transaction with the event loop free between batches (no synchronous step over 200 ms; DB review item 1). It clears the undo history afterwards.
- **Tags**: behind `TagReader`; `createMusicMetadataTagReader(parseFile)` is ready for music-metadata once added (library request in the wave 2 report).
- **The old library**: `importLegacyLibrary(library, localStorageValueOf("persist:player"))` on the new interface's first start: backup first, resumable, once.
- **Relinking**: `findMissingTracks`, `planRelink`, `applyRelink` (one undo step).
- **Wiring for wave 3**: read `persist:player` from the player window's localStorage and pass it to `importLegacyLibrary` before showing the Library; pass `createMusicMetadataTagReader(parseFile)` to `importAudio`, `importLegacyLibrary` and `refreshEmbeddedTags`; forward `ImportProgress` to the progress bar; show `summary` / `lines`.

## Wave 3: w3-host

The new interface's page hosts the playback engine behind one interface, `LyreAudio` (`src/lyre/audio`), so no screen touches Web Audio. PLY-8, PLY-10, OUT-5, PRV-1, PRV-2, PLY-11.

| File | What it does |
| --- | --- |
| `lyreAudio.ts` | `LyreAudio` (the screens' calls: play a track, playlist or scene on air to a room or every room, Next/Previous, pause, stop a lane with a fade, fade all, stop all, pads, Play next queue, Undo, preview a track/playlist/pad, preview device; `getNowPlaying`/`subscribe`; `getPositions`/`subscribePositions`, every 250 ms while music, ambience or the preview plays and someone shows a time (0.5.1); `announce` and `error` events) and `EngineLyreAudio`, its implementation over the Director, `RoomMixer`, `RoomStreams` and `PreviewPlayer`. Every failed call returns its plain message and sends it once as `error`. The library comes in as `LyreAudioLibrary`: domain lookups, the `ProfileOverrides` provider, each track's file (`media`) and each pad; it must answer synchronously, so the data layer answers from what it has loaded. |
| `stableRooms.ts` | The rooms as the Director sees them. When the first bot joins, the mixer hands the table's mix to that room; the Director would see "table" vanish and stop it. Here that room keeps the table's id for the Director, so music started before joining goes on into Discord. A fresh table after the last bot leaves gets a new id, so the old one's voices stop. |
| `browserLyreAudio.ts` | `startLyreAudio`: engine context at 48 kHz, read-ahead with `MEDIA_PREPARE`, worklet taps, the bridged preview in a sink-less context; `assembleLyreAudio` joins the parts (unit-tested with fakes). The preview device is attached again on every new channel. |
| `preloadAudio.ts` | `createLyreAudioBridge(ipcRenderer, window)`: the new page's preload half (`window.lyre.audio`): holds and posts the channel's end, rooms, `MEDIA_PREPARE`. |
| `LyreAudioProvider.tsx` | `LyreAudioProvider`, `useLyreAudio`, `useNowPlaying` (useSyncExternalStore), `usePlayPosition` (one position: only the time line that shows it redraws, every 250 ms), `useLyreAudioEvent`. |
| `testing/` | `FakeLyreAudio` for screen tests; `lyreAudioOnFakes` (the real parts on the fake audio graph). |

Where sound goes: each room's mix reaches its bot only through `RoomStreams`; the page (role `lyre-view`) is never tab-captured. Since 0.4.1 (BUG-19) no room plays on this computer at all: not on this page's speakers, and not on the capture window's "This Computer". The preview never reaches a room or this page's speakers.

Main process: `PlayerAudioBridge.setLyre(contents)` (through `PlaybackManager.setLyreView`) gives the new page the private channel and the rooms while it is open; the old player then gets neither (it reaches Discord by tab capture and never used the channel outside its test hook; two pages feeding the same rooms would be heard twice). When the new page closes, the old player gets the channel back.

### Wiring for the lead

```ts
// src/lyre/preload.ts, in the exposed API:
import { createLyreAudioBridge } from "./audio/preloadAudio";
audio: createLyreAudioBridge(ipcRenderer, window),

// The page root:
import { EMPTY_LIBRARY, LyreAudioProvider, startLyreAudio } from "./audio";
const audio = await startLyreAudio({ window, bridge: window.lyre.audio, library: EMPTY_LIBRARY });
window.addEventListener("pagehide", () => void audio.dispose());
root.render(<LyreAudioProvider audio={audio}><App /></LyreAudioProvider>);
// When the LyreApi data has loaded (and after each reload): audio.setLibrary(library);

// Main process, where the Lyre view is made and registered:
trustedContents.trust(view.webContents, "lyre-view");
playbackManager.setLyreView(view.webContents);
```

The new page's Content-Security-Policy needs `script-src 'self'` (the PCM worklet file), `media-src 'self' blob: file:` and `connect-src 'self' blob: file:` (read-ahead reads `file:` addresses and plays `blob:` copies). `MEDIA_PREPARE` must accept the `lyre-view` sender and `registerMediaIpc` must be wired ("Wave 2: Files and preview").

## Wave 2: database review fixes

The independent database design review (third normal form confirmed) found four faults, fixed on `w2-dbfix`: long work on the main thread could interrupt Discord sound, a tag's deletion could widen a dynamic playlist, library order depended on physical row numbers, and one file could become two tracks. The schema is now one step (`schema/v001-library.ts`), since no library database was ever released.

- **Bulk work rule.** The Store runs on the main thread, beside the bots' 200 ms packet queue, so no synchronous database call may hold the thread for long. Bulk changes (tagging, deleting tags or tag groups, merging tags, deleting tracks, adding or removing a library folder, relinking, applying title suggestions, and large undo or redo) go through `Store.changeInBatches`: about 500 rows per transaction with the event loop free between them, still one undo step. While one runs, other edits, undo and backups throw `LibraryBusyError`. Tests assert the thread's processor time per call stays under 200 ms on 20,000 tracks.
- **Backups on a worker thread** (`VACUUM INTO` from a read-only connection): daily, manual and before an import. The upgrade backup runs at open, before anything plays.
- **Search documents** are rebuilt once per commit from a TEMP dirty table (up to 1,000; the rest catch up on later turns).
- **Location.** `%LOCALAPPDATA%\Lyre Library` (outside `%LOCALAPPDATA%\lyre`, which the installer deletes on uninstall); a UNC path, or a folder where WAL is refused, falls back to a rollback journal. The WAL is kept under 8 MB and checkpointed after bulk work.
- **Still open:** the Store behind a utilityProcess with an async API (planned with the main-process LyreApi in wave 3), and session numbers derived from session order.

## Wave 3: w3-shell

The new interface (WP5) is a page of its own, `lyre_window` (`src/lyre/`), opened as the built-in "Lyre" tab beside the old Player tab (`src/renderer/features/lyre/`). The main window asks for it by kind `"lyre"`; `BrowserViewManagerMain` gives it its preload and the player page's protections (docs/security.md, "w3-shell"); `LyreManager` answers `LYRE_GET_URL`, finds the page (`getView()`) and hands it to the audio host (`attachView` → `onAttachView`, wired in `SessionManager` at the `--- w3-host wiring ---` mark). The page starts behind the player (the old player still opens first) and has no close button.

- **Page root** (`src/lyre/index.tsx`): drop guard, the styles, then `<AppProviders><Shell screens={SCREENS} /></AppProviders>`.
- **Provider slot** (`src/lyre/AppProviders.tsx`): the library API, the audio host and `ShellDataProvider` go here, around the shell.
- **Shell** (`src/lyre/shell/`): `Shell` (rail, the screen for `location.hash`, theme on `<html data-theme>`, focus to the h1 on a route change, F6/Shift+F6 between box headers), `routes.ts` (the prototype's addresses, `#/campaign/crown`; the prototype's `#campaign--crown` is read too), `themes.ts` (`themeFor`, the prototype's `L.themeFor`), `settings.ts` + `ShellSettings.tsx` (theme choice, rail, open and closed boxes, kept in the page's localStorage under `lyre-shell`), `Announcer.tsx` (`useAnnounce()`: `say` for the polite live region, `toast`), `ShellData.tsx` (what the shell shows from data: campaign themes, Live and Outputs labels, the on-air bar).
- **Screens** (`src/lyre/screens/index.tsx`): `SCREENS` maps each route name to a component that gets `{ route }` and renders its own `.viewhead` (one h1) and `.viewbody`. All are placeholders now; each screen stream builds `src/lyre/screens/<screen>/` and the lead swaps it in.
- **Kit** (`src/lyre/kit/`): React components for ui.css, see each file's header: `Pane`/`Column`, `Button`/`IconButton`/`ToggleButton`/`Segmented`, `Icon` (the prototype's 77 icons)/`LyreLogo`, `StatusPill`/`Badge`/`Kbd`/`Chip`/`ChipButton`/`EnergyMeter`, `SearchField`/`TextField`/`Select`/`Slider`, `MenuButton`/`Menu`, `Dialog`, `PickerDialog`, `ExpanderButton`/`ExpanderRow`, `ErrorBoundary`, `VirtualList`.
- **Styles** (`src/lyre/styles/`): `tokens.css` (the five themes, unchanged), `ui.css` (the prototype's shared rules without its presentation strip), `fonts.css` (bundled font files in `src/lyre/fonts/`, SIL OFL 1.1, notices in `OFL.txt`), `shell.css`. Screens add their own CSS from `design/prototype/src/views/<screen>.css`.

## Wave 3: w3-api

The new interface's screens read and change the library only through `LyreApi` (`src/common/lyre/api.ts`, WP5): async, in the domain shapes of `src/common/domain` plus what the screens show, grouped by area (library, tags, playlists, boards, campaigns, sessions and scenes, profiles, import, history). Each method's comment names the prototype action it serves.

- **Writes** resolve to `{ ok: true, value, changed, undoLabel }` or `{ ok: false, refusal: { code, message, field? } }`; `message` is plain words for the game master, `code` one of `REFUSAL_CODES`. A write that changes nothing makes no undo step and sends no event. Imports and watching a folder make no undo step; an import clears the history (as `importAudio` does).
- **Events**: `subscribe(listener)` sends `changed` (the areas to reload: tracks, tags, folders, playlists, boards, campaigns, profiles, history), `import-progress` and `watched-files`, always after the call that caused them.
- **Fake** (`fake.ts`): in memory over `seed.ts` (the prototype's `data.js`, typed). Used by tests and the e2e demo. It has no files: paths with an audio extension are files, `folderFiles` lists folders, `choose` answers the choosers, `arrive()` stands in for the folder watcher.
- **Contract** (`contract.ts`): `lyreApiContract(name, makeFixture)`, a Vitest suite every implementation passes; the main-process implementation (step 2, `src/main/lyreApi/`) runs it with a fixture seeded from `prototypeSeed()`.
- **Screens** (`src/lyre/api/`): `<LyreApiProvider api={…}>`, `useLyreApi()`, and query hooks (`useTracks`, `usePlaylists`, `usePlaylistTracks(id)`, `useBoards`, `useCampaign(id)`, `useUsesOf(ref)`, `useProfileOverrides`, `useHistory`, …) built on `useLyreQuery(key, load, areas)`; `useLyreEvent` for progress. `lookupFrom(tracks, playlists)` gives a `DomainLookup` for the shared rules.
- **Audio host's library** (`src/lyre/api/librarySnapshot.ts`): `await LibrarySnapshot.load(api)` gives the synchronous `LyreAudioLibrary` the audio host reads while it plays (track and playlist look-ups, scenes, profile overrides, `media(track)` from `LibraryTrack.url`/`sizeBytes`, pads with their sounds; a pad that plays "any effect with a tag" plays every FX track with that tag). It reloads the parts a `changed` event names and calls `subscribe` listeners afterwards, so the host can `audio.setLibrary(snapshot)` again.
- **File addresses**: `fileAddress(path)` (`src/common/lyre/media.ts`) turns a stored path into the `file://` address the player loads; both LyreApi implementations use it for `LibraryTrack.url`.
- **Own process (step 2)**: `src/main/data` runs only in the library's utility process (`src/main/lyreApi/libraryProcess.ts`, webpack entry `lyreLibrary`, so `webpack.main.config.js` names its bundles `[name].js`). `createLibraryApi(library, host)` (`libraryApi.ts`) implements LyreApi over the database and passes the contract suite in-process and across a port; `refusalFor(error)` turns `ValidationError`, `NotFoundError` and `LibraryBusyError` into refusals. `LyreLibraryService` (`libraryService.ts`) starts the process, relays calls (`rpc.ts`), restarts it after a crash and sends `library-status` events. `wireLyreLibrary` (`wiring.ts`) registers `LYRE_API_CALL` and `MEDIA_PREPARE`, forwards events to the Lyre page and brings in the old player's library on the first call. `index.ts` starts it when the app is ready, starts backups when the window is ready to show, and closes it before quitting.
- **The page (step 2)**: `src/lyre/preload.ts` exposes `window.lyre = { page, api, audio }`. `AppProviders.tsx` wires `LyreApiProvider` (`ipcLyreApi`), then `LibraryStatus` (plain words while the library restarts), then Lyre audio (`startLyreAudio`, fed by `LibrarySnapshot` and refed on changes), then `ShellDataProvider`.
- **Session numbers** are derived: `campaigns.first_session_number` plus the session's position (docs/data-model.md). Pad keys accept F1 to F12.

## Wave 3: w3-profile

The Audio profile screen (route `profile`: `#/profile/<track>` and `#/profile/<track>/<place>`, PLY-12) in `src/lyre/screens/profile/`, ported from the prototype's `views/profile.js` and `profile.css`. It reads and writes only through LyreApi (`useTracks`, `usePlaylists`, `useCampaigns`, `useProfileOverrides`, `profiles.set`/`clear`) and plays only through `useLyreAudio()` (`previewTrack`, `stopPreview`, `playTrack`).

| File | What it does |
| --- | --- |
| `profileModel.ts` | The rules in seconds: times in words (`fmt`, `fmt1`, `parseTime`), conversion to and from the domain's milliseconds, each point's limits (`rangeOf`), `movePoint`/`normalise` (Start before End, loop start between them, fades inside, loop crossfade at most 10 s and half the looped part, as `resolveProfile` keeps it), Reset to whole track, markers, the volume line and the fade sketch. |
| `places.ts` | Where the track plays (playlists, scenes directly or through a playlist, places that kept their own settings), place names, and where "the next track" comes from (`nextContexts`). |
| `previewClock.ts` | The preview's clock: play from the playhead, going round until stopped (the track's loop, else Start to End: `heardProfile`, BUG-17), or the last 10 s before End as the players hear it (loop back, counted, until stopped; move on to the next track and stop a few seconds into it; stop at End), the end of the file. Pure; each step returns the sentence for the live region. |
| `useProfileEditor.ts` | The profile shown for one track in one place: a draft that shows at once, kept through `profiles.set` right away for a click, after 600 ms for a run of keys or typing, at the end of a drag, and when the screen closes; refusals are toasted and taken back. Give this place its own settings, Back to the track's settings (with Undo, kept while the track stays open). |
| `useProfileController.ts` | The actions (handles, playhead, fields, steppers, fades, markers, places, Play on air), the animation-frame clock, the preview's sound, and the single-key shortcuts (Space, I, O, L, M, arrows; switchable, kept under `lyre-profile-keys1`). |
| `ProfileScreen.tsx`, `boxes.tsx`, `Waveform.tsx`, `waveDrawing.ts` | The header with "Settings for", and the boxes Waveform and listening, At the end, Fades, Markers. |

Limits of this version:
- **Preview sound** follows the profile since w3-polish (see that section).
- **Waveform.** Bars follow the library's loudness peaks (`useTrackPeaks`); an even band (shaped by the fades and the parts not played) until they are worked out. The prototype's made-up shape is not drawn.

## Wave 3: w3-library

The Library (`library`, `library/<track>`) and Playlists (`playlists`, `playlist/<id>`) screens of the new interface, in `src/lyre/screens/library/`, ported from `design/prototype/src/views/library.js` and `playlists.js` (WP5).

| File | What it does |
| --- | --- |
| `model.ts` | The rules without a screen: which tracks a filter, search and sort show (`visibleTracks`, search text worked out once per track object), the filter summary and count, the Folders list, times (`fmt`, `fmtLong`), kind markers, a track's audio profile in one line, a dynamic rule in the prototype's words (`ruleWords`: "not stings", where the domain's `ruleText` says "no stings"). |
| `trackStore.ts` | Every track, once per page visit (`useTrackList`). The shell draws a screen afresh on every address change, so `useTracks()` would reload and redraw 20,000 tracks each time a track opens; the store loads once, reloads once for several `changed` events naming tracks (60 ms apart), and takes a write's answer at once (`put`, `update`) so typed titles show in the list without waiting. |
| `libraryState.ts` | What the Library shows (filters, search, sort, ticked rows, the keyboard's row, the message line), kept for the visit like the prototype's `st`. |
| `LibraryScreen.tsx` | Head (count, Add tracks menu), the three boxes in the wide, mid and narrow layouts (`layout.ts`: 1200 and 820 px of the app), adding tracks (files, a folder, a watched folder, drops anywhere on the page; progress and arrivals in the message line), bulk Tag…, Add to playlist… and New playlist from these. |
| `TracksTable.tsx` | The track grid (role grid, aria-rowcount, rows named "Select <title> …"), drawn a screenful at a time with spacer rows; one Tab stop with the prototype's keys. Not the kit's `VirtualList`, which draws a list or listbox, not a grid. |
| `TrackDetails.tsx` | Details: your title (saved 400 ms after typing), names and file, Preview, Play on air, Audio profile link, tag comboboxes, energy, role, looping, notes, In playlists, Used in (directly or through a playlist). |
| `TagSheet.tsx`, `FiltersBody.tsx` | The bulk Tag… sheet; the Filters box. |
| `PlaylistsScreen.tsx`, `PlaylistPage.tsx` | All playlists (filters, rows with expanders, New playlist); one playlist (manual tracks with Add tracks, or rules and matches; Used in; Details; Delete). |
| `playlistData.ts`, `playlistParts.tsx`, `UseInDialog.tsx`, `playlistDrops.tsx` | Tracks of each playlist and its uses from the lists already loaded (domain `playlistTracks`, `usesOfPlaylist`); Use in… (`campaigns.setUses`); files dropped on a row, a page or beside the list. |
| `shared.tsx`, `drops.ts` | A playlist's contents, what plays on air, refusals as toasts (`useWriteResult`, `useWriteOk`); paths from a drop. (Sound buttons, the two-line menu and the on-air bar moved to the kit and the shell in w3-polish.) |

- **Sound** only through `useLyreAudio()`: Preview (`previewTrack`, `previewPlaylist`, state from `useNowPlaying().preview`), Play on air (`playTrack`, `playPlaylist`, 3 s fade).
- **Drops** use `window.lyre.files.pathOf(file)` (preload, `webUtils.getPathForFile`), falling back to the file's name (the fake takes it as a path). In the `app` spec project, `e2e/specs/support/drop.ts` drops real temporary files through a file input, as a page-made `File` has no place on disk.
- **CSS**: `library.css` and `playlists.css` are the prototype's view CSS with every rule scoped to `.view` (`body` for menus and sheets), because the page loads screen CSS before `ui.css` (`src/lyre/index.tsx` imports `./screens` before the styles) and equal rules would otherwise lose.

## Wave 3: w3-boards

The Pad boards screens of the new interface (WP5), from the prototype's `views/boards.*`, in `src/lyre/screens/boards/`. Data only through LyreApi (`useBoards`, `useCampaigns`, `useTracks`, `useTagGroups`); sound only through `useLyreAudio()`.

| File | What it does |
| --- | --- |
| `BoardsScreen.tsx` | `#/boards`: a card per board (mini grid, size line, pads found by the search, Used in, Open, Preview of the first pad, More: Use in…, Duplicate board, Delete board…); search by board name or pad label; Used or not and Campaign filters. |
| `BoardScreen.tsx` | `#/board/<id>`: Pads (name, Columns and Rows steppers, Quick sizes, the resize message with Undo, the grid), Spare pads, Used in, and the selected pad's box. The grid is one Tab stop (roving tabindex): arrows move and select, P previews, Alt+arrow moves the selected pad (also outside the grid, but not while typing), Enter or Space selects or adds; right-click opens the pad's menu; drag a pad onto a slot (swap) or onto Spare pads. Pad drags call `stopPropagation`, so the page's drop guard (SEC-7) does not cancel them; files dropped there still reach the guard. |
| `PadEditor.tsx` | The pad's box: Preview, Play on air (a hold pad is let go after 1.5 s), Label, Sound (one file, several variants in random order or in turn, or any FX track with a tag; Choose from library… lists FX tracks; Add a file… imports through `import.start`), Play mode, Hotkey (letters, digits, F1 to F12; Esc cancels, Backspace removes; a key another pad has is warned with Take it from that pad), Colour, Icon, Volume, Fade out. |
| `BoardDialogs.tsx` | New pad board, Delete board…, Use in… (`campaigns.setUses`), Delete pad…, Duplicate board. |
| `boardModel.ts` | The words and small rules (size line, places, key owners, arrow neighbours, uses from the campaign trees, resize and move messages, the pad tile's accessible name with its visible label and key first). |
| `hooks.ts` | `useWrite` (refusals toasted in their own words), `useBoardSound` (preview and on-air state from `useNowPlaying`), `usePendingFocus` (focus that waits until the reloaded data shows its target), `useSavedText` (fields saved as you type). |

The resize message's Undo calls `history.undo()` only while the last undo step is still that resize (its `undoLabel`); otherwise it says it cannot undo it any more.

## Wave 3: w3-campaigns

Campaigns (`#/campaigns`), one campaign (`#/campaign/<cid>`) and the session planner (`#/session/<cid>/<sid>`), ported from `design/prototype/src/views/campaigns.js` (WP5, UX-1). Files in `src/lyre/screens/campaigns/`:

| File | What it does |
| --- | --- |
| `CampaignsScreen.tsx` | The cards (each in its campaign's theme, or the theme Look and feel forces), Run next session, Open; the New campaign sheet (name, game system, one-line description, theme previews with Candlelit Library first, folded Obsidian placeholders). |
| `CampaignScreen.tsx` | Details (name, game system, theme, description), Prep or Live, Run next session; Sessions in order (drag a handle or ⋯ to move; numbers follow order), a Run button per session; Notes; Campaign playlists and pad boards; Obsidian (coming later). |
| `SessionScreen.tsx` | Session details, Prep or Live, Run this session; scene cards (fold, open all, move, drag, add after the last one worked on, duplicate, delete after asking); each scene's music (tracks and playlists mixed, in play order), ambience and pad boards, with menus, expanders, Preview, Play on air, pickers and dropped files; session playlists and pad boards; the campaign's playlists as a reminder. |
| `OnHand.tsx` | Playlists and pad boards on hand (campaign or session): rows, Add… picker, Remove. |
| `pickers.tsx` | The music, ambience, playlist and pad board pickers on the kit's `PickerDialog` (Preview on every row, expanders closed). Leaving a picker stops its preview. |
| `parts.tsx` | `useLibraryIndex` (tracks, playlists, boards in one look-up), `useWrite` (refusals become toasts), `useFocusLater` (focus a control once the library has redrawn the screen), `Contents`, `RowMenu`, `ModeSwitch`, `DraftField` (saves after a 300 ms pause, on leaving the field and on closing, so a reload never moves the cursor and typing makes one undo step per pause). |
| `model.ts`, `reorder.ts`, `drops.ts` | Wording and look-ups; drag to reorder by a handle; dropped files to paths. |

- **Run and Live.** Run, Run next session and the Live side of the switch call `runInLive` (`src/lyre/kit/liveSession.ts`): the session is loaded in Live, ready to start, and `#/live` opens. The Live screen reads `useLiveSession()`; the shell can show it through `ShellData.liveCampaign` and `liveLabel`.
- **Themes.** A theme change is a `campaigns.update`; the shell follows through `ShellData.campaignTheme`, fed from `useCampaigns()` in `AppProviders`.
- **Campaign order** (0.5.1). `campaigns.move(id, toIndex)` keeps the Campaigns screen's order in `campaigns.position` (there since schema 1, so no migration; `repo/campaigns.ts` `moveCampaign`), one undo step. The cards drag by their handle (`useDragReorder(..., { grid: true })`: a card's left half is before it, its right half after it), Alt+Up and Alt+Down on any of a card's controls move it, and the Reorder switch shows Move up and Move down on each card.
- **Session numbers** come from order: moving a session renumbers them from the lowest number, as the library does.
- **Dropped files** are imported with `import.start({ from: "paths" })`. The page learns a file's place on the computer from `window.lyre.files.pathOf(file)` (Electron's `webUtils.getPathForFile`); without it (tests), the file's name is sent.

## Wave 3: w3-media

DAT-5 (tags), BUG-10 (converter) and loudness peaks, wired into the library's process and the media pipeline.

- **Tags.** `src/main/data/import/musicMetadata.ts` gives `createMusicMetadataTagReader(parseFile)` the real music-metadata 11.16.1. Only the library's utility process imports it (`libraryProcessCore.ts` passes it to `createLibraryApi` and `importLegacyLibrary`). music-metadata is ESM-only and its package exports have no `require` entry, which the CommonJS that TypeScript emits needs; `webpack.main.config.js` aliases `music-metadata$` to its Node entry, so webpack bundles it as ESM (its parsers become chunks beside `lyreLibrary.js`). Vitest loads it natively, so the tests run the same library.
- **ffmpeg.** `forge.config.js` ships `node_modules/ffmpeg-static` with a second `@timfish/forge-externals-plugin` entry (`includeDeps: false`: its dependencies only download the program at install time), and `ASAR_UNPACK_GLOB` keeps the program out of app.asar. `findBundledFfmpeg(app.getAppPath())` (`src/main/media/bundledFfmpeg.ts`) finds it in `app.asar.unpacked` (or in `node_modules` under `yarn start`). `startLibrary.ts` gives `MediaCache` an `FfmpegConverter` (`noConverter` only when the program is missing: plain words, reinstall) and passes the path to the library process in its `init` message (`LibraryServiceOptions.ffmpegPath`). Test builds expose it as `globalThis.lyreFfmpegPath` for `e2e/lyreMedia.spec.ts`.
- **Loudness peaks.** Schema step 2 (`track_peaks`, docs/data-model.md "Version 2"), `repo/peaks.ts` (`trackPeaks`, `savePeaks`), `data/peaks.ts` (`PeakJobs`, `PeakReader`), `media/peakLevels.ts` and `media/ffmpegPeaks.ts` (`FfmpegPeakReader`). `createLibraryApi(library, host, { peakReader })` owns a `PeakJobs`: new tracks are queued after `import.start`, `library.peaksOf(id)` answers the stored levels (0 to 1, three places) or null and queues the track ahead of the background ones; ready tracks send `{ type: "changed", areas: ["peaks"] }` at most every 250 ms. `stopBackgroundWork()` (called on `close` before the library closes) stops the running ffmpeg. Older tracks are worked out only when a screen asks.
- **Contract.** `LYRE_AREAS` gains `"peaks"`; `library.peaksOf` is in `LYRE_API_METHODS`. The fake answers the prototype's made-up loudness (`prototypeLevels`, core.js L.levels, since w4-prep-b) a moment after the first request or an import, with the same event. `LibrarySnapshot` ignores `peaks`.
- **Hook.** `useTrackPeaks(trackId | null)` (`src/lyre/api/hooks.ts`) returns the levels or null; null at once when the id changes, asks again on `peaks` while it has none, on `tracks` (a relinked file) and when the library is back. For w3-polish: `drawWave(canvas, { …, levels: useTrackPeaks(trackId) })` once merged; the levels are on a decibel scale (0 = -60 dBFS or quieter), already shaped for drawing.

## Wave 3: w3-polish

Step 4 moved what several screens did each on their own into the shell and the kit, and made the Audio profile's preview real (WP5, PLY-12, UX-11).

| Where | What it does |
| --- | --- |
| `shell/OnAirBar.tsx` | The slim On air bar at the foot of every screen but a built Live (a screen with `showsOnAir`; core.js `onAirBar`): music and ambience of the first room, effects in every room, Stop (fade all in 1 s), Go to Live. `AppProviders` hands it to the shell as `ShellData.onAirBar`. |
| `AppProviders.tsx` | `ShellData` also carries `liveCampaign` and `liveLabel` ("Live: S14") from `useLiveSession`, so the rail and Live's theme follow Run. |
| `shell/SoundMessages.tsx` | The audio host's `announce` and `error` events, heard once for the page: sentences to the live region, failures to a toast. Screens no longer subscribe. `useOptionalLyreAudio()` lets the shell work without sound. |
| `shell/CampaignInHand.tsx` | The campaign last opened (the prototype's `L.state.ctx.cid`), provided by the shell around each screen; "Use in…" opens its group first. |
| `kit/SoundButtons.tsx` | `PreviewButton` and `PlayOnAirButton` for a track, a playlist, a pad or a board (its first pad), with `previewKeyOf`. Play on air fades tracks and playlists in over 3 s, presses a pad (a hold pad is let go after 1.5 s). |
| `kit/PopMenu.tsx` | The menu whose items hold two lines (`PopMenu`, `PopMenuButton`, `TwoLines`). |
| `kit/ProfileLink.tsx` | The "Audio profile" link-button, its hover text naming the place ("the playlist …", "the scene …"). |
| `kit/Picker.tsx` | `fold` and `openGroups`: group headings that show or hide their items and count the ticked ones; searching shows every match. |
| `screens/look/` | Look and feel: the five theme cards (each sample a picture in its own `data-theme`, one plain sentence each), Use this theme and Theme, which choose the base theme; since 0.5.1 a campaign's own theme always shows on its pages, sessions, planner and Live (`themeFor`), and an old "Each campaign's own" choice is read as Candlelit Library. |

**Preview that follows the profile.** `LyreAudio.previewTrack(id, { startAtMs, profile, quiet })` always starts, from that point, as the profile says (Start to End, fades, loop); `quiet` leaves the announcing to the screen. `PreviewPlayer` sends its voice's position every 50 ms, relayed as the `preview-position` event (`{ key, positionMs }`). The Audio profile screen plays from the playhead (or the last 10 s before End) with the profile shown (Play as a loop until stopped, BUG-17); its clock follows the positions (`follow` in `previewClock.ts`: a jump back is a loop; `finishClock` when the sound ends by itself goes to End and stops or moves on); moving on plays the next track from its Start with its settings there. The clock runs on its own only until the first position arrives (and in tests with the fake host). A seek or a profile change while it plays starts the sound again from the playhead. The waveform's bars and the volume meter follow the file's loudness from `useTrackPeaks` (w3-media), an even band while the peaks are not worked out yet.

Review fixes (w3-polish review): a preview that cannot play sends `failed` from `PreviewPlayer` (`preview-failed` on LyreAudio) before it clears, and the Audio profile stops its clock and says why; a refused start never starts the clock. The first position after each (re)start only places the playhead (`follow(…, { first: true })`), so load time is not taken for a loop. Seeks and profile changes while playing restart the sound 200 ms after the last one. `usePreviewKey()` lets Preview buttons redraw only when the preview changes. Picker groups fold by `groupId` (a campaign's id). The rail's Live link is named from `ShellData.liveName` ("Live: session 14"). The on-air bar gives focus to the screen's heading when it goes away under Stop. Hold pads pressed from Play on air keep one let-go per pad.

Usability review fixes (w3-ux): `shell/UndoNote.tsx` shows what a large change did with Undo (Reset to whole track, Delete board, Delete scene, Tag… on many tracks; `offer(text, undoLabel)`, checked against the library's last step), and Ctrl+Z undoes the library's last change on prep screens, over `ShellData.history`. The shell follows a screen's heading for 5 s after a route change, so focus lands on headings that appear after loading. Live and Outputs say "Live comes in Lyre 0.4. Until then, run your session from the Player tab." (`ComingScreen`). The on-air bar shows "This computer" and says so while no bot is in a voice channel (`NowPlaying.broadcasting`). In the old window, the Bookmarks/Outputs sidebar takes no space while the Lyre tab is open, unless errors are shown (`sidebarSpace(…, lyreOpen)`).


## 0.3.1: w31-fix

Fixes from Nik's test of 0.3.0 (BUG-12 to BUG-18).

- **What plays is the page's** (BUG-12, BUG-13). The audio host and the On air bar live in `AppProviders` and the shell, outside every screen, so music started anywhere plays on, with the bar, until Stop (`src/lyre/onAirAcrossScreens.test.tsx`, `e2e/onAir.spec.ts`). The bar now shows on every screen whose component does not set `showsOnAir` (`ScreenComponent` in `screens/index.tsx`); only the real Live screen (wave 4) will, so the "comes in 0.4" Live page keeps the bar. A picker (`campaigns/pickers.tsx`) stops on closing only a preview started while it was open, never one the game master had playing before.
- **Rename in place** (EDT-1, BUG-18): `kit/RenameInPlace.tsx` (`useRenameInPlace`, `renameKeys`, `RenameField`). A session's name in Campaigns and a scene's in the Session planner: double-click, F2 on the name, or Rename in its ⋯ menu; Enter saves, Esc cancels, leaving the box saves; focus goes back to the name. The session link waits `DOUBLE_CLICK_MS` (300 ms) after a single mouse click before it opens, so a double-click can rename; Enter and modified clicks open at once.
- **Pad colour and icon** (BUG-16): `useChosen` in `PadEditor.tsx` shows a choice at once and keeps it until the library has saved it. Showing the saved value made the radio jump back while the save was on its way, and React then lost which button was ticked, so a second click on the same icon did nothing.
- **Tags by typing** (BUG-15): Tab adds what was typed (creating the tag) or the suggestion chosen with the arrows, as Enter does, and lets focus move on; an empty box adds nothing.
- **Box headers** (BUG-14): `shell.css` lets a box header wrap, its buttons moving to a second line at the right, instead of pushing them out of the box (which clips). The sweeps check that every control, scrolled into view, shows its whole width without sliding a box a person cannot scroll.

## Wave 4: w4-contracts

Step 1 of wave 4 gives the round 5 streams (design/prototype/ROUND5.md) their data, calls and sound state, all tested, with no screens. Schema version 3 is in docs/data-model.md.

**Shared rules** (`src/common/domain`): `ProfilePlace` gains a session list (`placeKey` "ss:<campaign>:<session>", `ProfileSource` "session"); `profilePlacesFor(place, playlistId)` gives `resolveProfile` the places `profileKeysFor` names; `PlayOrder`, `Repeat` and `REPEATS` live in `types.ts`, and `DomainPlaylist.order` is a playlist's own order; `shapeOf(track)` is the shape that applies to a stored track; `shuffledOrder(items, seed)` and `tracksInOrder(items, order, seed)` deal a shuffled playlist the same way wherever the seed is the same.

**LyreApi** (`src/common/lyre/api.ts`; `LYRE_API_METHODS`, the fake, the main process, argument checks and the contract suite all follow):

| Area | Added or changed |
| --- | --- |
| library | `LibraryTrack.shape`, `suggestedShape`; `setShape(trackId, shape \| null)`; `search({ shapes })` (the Shape filter). |
| playlists | `PlaylistInfo.order` (own order); `playOrders()`; `setPlayOrder(id, place \| null, order)`; `clearPlayOrder(id, place \| null)`. A place is the domain's `UsePlace` (`PlayPlace`). Rule shapes are `PlaylistRule.shapes` in `create`/`update`. |
| boards | `Pad.aside`; `resize` packs as `reflowBoard` and answers `{ board, movedToSpare, cameBack }`; moving a pad to Spare pads (or the pad a spare pad replaces) puts it aside. |
| campaigns | `CampaignInfo.trackIds`, `SessionInfo.trackIds`; `setOnHand(owner, "tracks", ids)`; `setUses({ kind: "track" }, places)`; `usesOf` a track lists campaign and session uses. |
| sessions | `SceneInfo.trackNames`; `setTrackName(scene, trackId, name)` (empty: the track's own name). `trackNamesOf(campaigns)` (`lookup.ts`) gives `trackNameIn` its `TrackNames`. |
| profiles | `set`/`clear` take a session place. |
| import | `MissingTrack.fileName`, `folder`, `sizeBytes` (the Missing filter is `findMissing()`'s ids); `RelinkMatch.toUrl` (Preview before relinking; sure and likely are ticked, name is not). |
| transfer (new) | `estimate(scope)`, `save({ scope, includeAudio, path? })`, `open(source)`, `bringIn(openedId, choices)`, `movedReport()`, with `TransferScope`, `TransferEstimate`, `OpenedFile`, `IncomingItem`, `DuplicateChoice` (skip, merge, keepBoth), `BringInReport`, `MoveReport`. Shared rules in `src/common/lyre/transfer.ts`. The fake does all of it in memory; the main process answers `estimate` and `movedReport` (from the old player's move record) and refuses `save`, `open` and `bringIn` with the new code `"unavailable"` until a later step. |

New refusal codes: `"not-lyre-file"` (a file that is not a Lyre file, or is damaged), `"unavailable"`. The seed (`seed.ts`) has the prototype's round 5 samples (play orders, names in scenes, shapes, missing files t19, t26, t37, Mugs clink aside, t26 on hand, the move report), checked against `data.js` in `fake.test.ts`.

**Audio host** (`src/lyre/audio`): `getNowPlaying()` is the one shape the Now playing bar, Live and Outputs read.

- Each room's `music` and `ambience` (`LaneNowPlaying`): the track, `origin`, `playlistId`, `position` and `length` (seconds), `paused`, `loading`, and new `place` (its scene, or the session or campaign list its playlist was played from; null on its own) and `playOrder` (its playlist's order there, null for a single track).
- `preview` (`PreviewNowPlaying`): `key`, `label`, `kind` (track, playlist, pad), `trackId`, `playlistId`, `padKey`, `from` (the words a screen gave), `paused`, `position`, `length`, `volume` (headphones).
- New calls: `togglePreviewPause()`, `setPreviewVolume(0..1)` (kept for the next preview); `previewTrack(id, { from })`, `previewPlaylist(id, { from })`, `previewPad(board, pad, { from })`; `playPlaylist(id, { place })` and `playTrack(id, { from: { playlistId, place } })` for a session or campaign list.
- Sequencing (`src/player/engine/queue/nowPlaying.ts`): a playlist's tracks are dealt in the play order that applies where it plays (`playOrderOf`), shuffled by a seed the Director takes from its random numbers; when a track ends by itself `whenTrackEnds` decides (again, next, first, move on, stop); Next and Previous always move on; a track that cannot play is passed over. A playlist played on its own in its lane (a scene's ambience playlist too) defaults to repeat all. An ambience playlist's track that ends by itself goes on the same way.
- `LyreAudioLibrary.playOrders()` is new; `LibrarySnapshot` loads `playlists.playOrders()` and reloads it on "playlists". `FakeLyreAudio.setNowPlaying` fills in what a test leaves out (`FakeNowPlaying`).

Open points for the build streams: the pad board screen now words a resize with `cameBack` and the pad put aside (boardModel `resizeMessage`); the Library still searches in memory, so a screen that wants names in scenes found must add them from `trackNamesOf` (the database's search has them); a "peaks" event may mean suggested shapes changed.

## Wave 4: w4-outputs

The Outputs screen (`#/outputs`, OUT-5, OUT-6), ported from the prototype's `views/outputs.js` and `outputs.css`, and what it needs from the main process.

| Where | What it does |
| --- | --- |
| `src/common/lyreOutputs.ts` | `LyreOutputs`, what the Lyre page learns of the bots: each bot's Discord name, login, room (server, channel, status), mute, volume and servers, and every server's voice channels with the people in them (`lyreOutputsOf(OutputsState)`; never a token). `isLyreOutputs` checks the shape. |
| `src/main/broadcast/DiscordBot.ts` | Lists the people in each voice channel (bots left out) and works them out again from discord.js's cache 200 ms after the last `VoiceStateUpdate` (`VoiceChannelInfo.members`). |
| `src/main/broadcast/lyreOutputsBridge.ts` | `LyreOutputsBridge`: `LYRE_OUTPUTS_GET`, `LYRE_OUTPUTS_STATE` (pushed on `OutputManager`'s new `stateChange`), and `LYRE_OUTPUT_MOVE` (`moveBot`), `_LEAVE` (`leaveAll`, new), `_SET_MUTED`, `_SET_VOLUME`, `_RETRY`, from the Lyre page only. `PlaybackManager` makes it and gives it the page in `setLyreView`. |
| `src/main/broadcast/testing/prototypeWorld.ts` | Test builds only: `CUE_DESK_FAKE_DISCORD=prototype` gives the fake Discord the prototype's world (`FakeWorld`: servers, channels, people, bot names by token), logs in Lyre Table and Lyre Side at 85 %, joins Lyre Table to Table, and exposes `globalThis.__lyreOutputsTest` for the specs' `joinRoom`/`leaveAllRooms`. |
| `src/lyre/outputs/` | `preloadOutputs.ts` (`window.lyre.outputs`), `OutputsProvider` and `useOutputs()` (the latest state for every screen), `outputsLabel` (the rail's "Outputs (connected/all)", through `ShellData.outputsLabel`), `testing/fakeOutputs.ts` (the prototype's Discord for screen tests). |
| `src/lyre/audio` | `LyreAudio.testChime(roomId)`: a short bell made with oscillators (`playChime`) into that room's effects lane only; refused for a room not in a voice channel. |
| `src/lyre/kit/PopMenu.tsx` | Items can be radio items (`role: "menuitemradio"`, `checked`, from w4-kit-bar): the Room menu. |
| `src/lyre/screens/outputs/` | `outputsModel.ts` (pills, Room and Bring… items with their warnings, Swap rooms, the messages), `OutputsScreen.tsx`, `outputs.css`. |

Not built: the level meter beside each room's volume (the audio host has no level per room yet). The Prep | Live switch shows for the session loaded in Live, else the campaign last opened, else the first.

## Wave 4: w4-kit-bar

Phase A of wave 4: the round 5 kit the prep screens and Live build on, and the Now playing bar (design/prototype/ROUND5.md).

| Where | What it does |
| --- | --- |
| `common/domain/placeWords.ts` | Places and origins in words, the same on every screen: `placeLabel` ("The abbey ruins (Session 14)"), `orderPlaceWords` ("in the scene The abbey ruins", "everywhere it has no order of its own"), `originWords` ("Playlist: The Company themes · The Sunken Crown", "Single track"). Names come in through `PlaceNames`. |
| `kit/placeNames.ts` | `placeNamesOf(campaigns)`, `usePlaceNames()`: the `PlaceNames` from the campaign trees. |
| `kit/PlayOrderButton.tsx`, `kit/playOrders.ts` | PLY-13. `<PlayOrderButton playlistId place />` (place null: the playlist's own order): two icons, the accent edge and dot for a place's own order, and the menu (Shuffle; No repeat, Repeat all, Repeat one with their hints; where it applies; Use the playlist's own order here). The menu stays open on the item after a choice and says the new order and where. `usePlayOrders()` loads `playlists.list` and `playlists.playOrders` once per LyreApi for every button on a screen, again on a `playlists` change; a write's answer shows at once. |
| `kit/PopMenu.tsx` | Entries may be `menuitemcheckbox` / `menuitemradio` (`role`, `checked`) that keep the menu open (`keepOpen`), and a `note` read as the menu's description. |
| `kit/TagStrip.tsx` | ORG-11. `<TagStrip track groups />`: shape glyph, three tags with their group's dot, "+n" naming the rest on hover; below 820 px of the app one tag and "+n" (two counts drawn, ui.css shows the one that fits). Screen readers hear "Tags: …" once. A screen passes `useTagGroups()` once for all rows. |
| `kit/ShapeGlyph.tsx` | DAT-13. `ShapeGlyph`, `ShapeTag` (word or glyph only, "(suggested from its loudness)" on hover), `shapeHint` (the line under Shape in a track's details: "Suggested by Lyre…" / "Your choice. Lyre suggested …"). |
| `kit/trackName.tsx` | DAT-14. `TrackName` (the scene's name for a track there, "Its own name: …" on hover and for screen readers), `useTrackNames()`, `trackNameAt`, `ownNameTitle`. |
| `kit/SoundButtons.tsx` | A playlist target may name its `place` (a session or campaign list), so Play on air there uses that list's play order and the bar names it. The on-hand lists pass it. |
| `shell/NowPlayingBar.tsx` | UX-16. Replaces `OnAirBar`. One row per room playing music or ambience (On air tag, naming the room with two or more rooms and "no room" while no bot is in a voice channel), one for the preview (Only you), on one grid; in a screen with `showsOnAir` (Live) the preview row only. `ShellData.NowPlayingBar` is the component; the shell passes `previewOnly`. Reads `getNowPlaying()`; names from `usePlaceNames`, `useTrackNames`, `usePlayOrders`. |
| `shell/ScreenSound.tsx` | Gives each screen the audio host with `from` filled in on previews that name no place (`SCREEN_WORDS`, core.js SCREEN_NAMES), so "Previewed from the session planner" needs nothing from the screens. |

Audio host changes: `RoomNowPlaying.volume` and `setRoomVolume(target, 0..1)` (the room's mix level, kept per room while the app runs; the room that takes over the table keeps its volume; rooms start at `ROOM_START_VOLUME`, 0.85, in the app, 1 in tests unless `startRoomVolume` says otherwise). A lane's `length` is the library's length of the track when it has one, so the bar agrees with the lists.

## Wave 4: w4-prep-a

Phase B for the Library and Playlists (design/prototype/ROUND5.md), in `src/lyre/screens/library/`.

| Where | What it does |
| --- | --- |
| `model.ts` | `LibraryFilter.shapes` (DAT-13, the shape that applies: chosen, else suggested) and `missing` (DAT-8); `visibleTracks(…, missing)` takes the ids from `import.findMissing()` (`useMissingTracks`); `SHAPES`; `ruleWords` says "shape builds or peaks then falls". |
| `FiltersBody.tsx`, `TracksTable.tsx` | Filters › Missing (with its count, shown while any file is missing) and Shape (with counts). Rows: the shape glyph beside the first tag, `DestTag` On air or Only you (grey while paused, `pausedTrackIds` in `shared.tsx`), and Missing. |
| `TrackDetails.tsx` | A missing file's note with Relink… (`#/relink`, the transfer stream's screen); Names in scenes (`trackNamesOf`, `placeLabel`); Use in… by Play on air and in Used in; How it plays › Shape (choosing the suggestion stores no choice, `library.setShape(id, null)`), with `shapeHint` and Use the suggestion; "On hand in …" from `usesOfTrack`'s campaign and session uses. |
| `UseInDialog.tsx` | Takes `track` or `playlist` (ORG-12; `campaigns.setUses({ kind: "track" })`). With no campaign in hand it opens the first campaign's group, as the prototype starts with one in hand. Opened from a track's details, a Library row's menu and a playlist's track menu. |
| `PlaylistsScreen.tsx`, `PlaylistPage.tsx` | `PlayOrderButton` (place null) on every row and by Play on air (PLY-13). A dynamic playlist: Details (`pl-details-dynamic`, folded unless just made), Rules, Matching tracks in the main column, Used in on the side (EDT-8); Rules › Shape. Track rows: `TagStrip` (ORG-11), `DestTag`, Use in… in their menu. A row's opened contents show tag strips. |

Seed (DAT-13): `SeedData.peaks` holds each sample track's loudness, the prototype's curve (core.js `L.levels`) over 1,000 points at the library's one-byte precision; tracks' `suggestedShape` comes from it. The fake starts with those peaks and `seedLibrary` saves them (`savePeaks`), so both suggest the prototype's shapes (`fake.test.ts` runs core.js to check every track).

PLY-15 (after merging w4-normalise): the Library's ⋯ (`LibraryMoreMenu`'s `onNormalise`) ends with a separator and "Normalise volume…" (`NormaliseDialog`; `normalise.ts` `useNormaliseSettings`, reloaded on "tracks"); a track's How it plays has `NormaliseChoice` between Shape and Role; a playlist's Details has it after the Manual/Dynamic line; a track previewed from a playlist's page passes `{ playlistId }`. The fake measures a sample track's loudness when its peaks are asked for, though the seed already has the peaks.

## Wave 4: w4-transfer

DAT-7 (Back up, move or share), the move report and DAT-8 (Find missing files): the .lyre file in the main process
and three screens (design/prototype/ROUND5.md "Three screens that had none").

| Where | What it does |
| --- | --- |
| `src/main/transfer/zip.ts` | A small zip writer (stored audio streamed with a data descriptor, deflated JSON, CRC-32) and a hostile-file reader (docs/security.md "w4-transfer"). Node's zlib only. |
| `src/main/transfer/lyreFile.ts` | The .lyre format (docs/data-model.md "The .lyre file"): `writeLyreFile`, `readLyreFile` (manifest, version, entries, every value rebuilt), `refusalWords`. |
| `src/main/transfer/bringIn.ts` | `describeFile` (new or yours already) and `bringIn` (Skip, Merge, Keep both; ids mapped; one undo step in batches). |
| `src/main/lyreApi/transferApi.ts` | `saveLyreFile`, `openLyreFile`, `bringInLyreFile` for `transfer.save`, `open`, `bringIn` in `libraryApi.ts` (a backup first, audio unpacked into `Brought in\<file>`). |
| `src/main/lyreApi/sampleComputer.ts` | Test builds of the sample library only: the prototype's computer (files 9 MB, three missing, E:\Music\Scores, Sam's "Curse of Strahd" file), so the specs check the design's own sample. `seedLibrary(…, { sample: true })` records the file sizes and the move from Kenku FM 1.5.5. |
| `src/lyre/screens/transfer/` | `BackupScreen` (`#/backup`), `MovedScreen` (`#/moved`), `RelinkScreen` (`#/relink`), `LibraryMoreMenu` (the ⋯ beside Add tracks), `model.ts` (words), `transfer.css` (the prototype's, scoped to `.view`). |

- **Host.** `LibraryHost` gains `chooseSaveFile(suggestedName)` and `chooseLyreFile()`; `startLibrary.ts` shows the
  dialogs at Documents\Lyre (test builds of the sample library answer them, and the folder chooser, by themselves).
  `LyreLibraryService` passes `transferFolder` in the library process's `init` message.
- **Relinking.** `findMissingTracks` and `planRelink` take a `FileProbe` (the disk by default). A file with the same
  name and another size is now offered as "name" (not ticked: "Same name, different size: check it").
- **Move report.** `transfer.movedReport()` names the app's version and the bookmarks when the record holds them.
- **Shared files touched:** `src/lyre/shell/routes.ts` (three routes, section Library), `src/lyre/screens/index.tsx`,
  `src/lyre/kit/icons.ts` (download, upload, warn), one import and one line in `LibraryScreen.tsx`, `e2e/specs/support/built.ts`.

## Wave 4: w4-normalise

Volume normalisation (PLY-15, DAT-15; design/prototype/ROUND5.md "Volume normalisation"). Lyre never changes your files: the level is evened out as Lyre plays them, and the measurement is kept in Lyre's library.

- **Rules** (`src/common/domain/normalise.ts`): `normaliseDecision` (track, then playlist, then library), `normaliseGain` (target - loudness, at most +12 dB, true peak at or below -1 dBTP), `normalisedGainDb`, and the words (`normaliseLine`, `playlistNormaliseLine`, `normaliseHover`, `libraryNormaliseWords`). `DomainTrack.normalise`, `loudness`; `DomainPlaylist.normalise`.
- **Data**: schema version 4 (docs/data-model.md). The library's process measures loudness with the bundled ffmpeg in the peaks job (`media/ffmpegLoudness.ts`) and queues unmeasured tracks 20 s after start.
- **LyreApi**: `library.normaliseSettings()`, `setNormaliseSettings({ on, target })`, `setNormalise(trackId, "on" | "off" | null)`; `playlists.setNormalise(id, choice)`; `LibraryTrack.normalise`, `loudness`; `PlaylistInfo.normalise`. The setting changes "tracks"; new loudness comes with "peaks".
- **Audio host**: `LyreAudioLibrary.normaliseSettings()`; `LaneNowPlaying.gainDb`, `PreviewNowPlaying.gainDb`; `PreviewTrackOptions.playlistId`. docs/playback-engine.md "Wave 4: volume normalisation".
- **Kit**: `kit/NormaliseChoice.tsx` (`NormaliseChoice`, `NormaliseDialog`, `trackNormaliseHint`, `playlistNormaliseHint`, `profileNormaliseHint`), not yet placed in screens.

## Wave 4: w4-live

The Live screen (`#/live`, UX-2, UX-8, UX-12, UX-14, SFX-2, OUT-6, SHW-1, SHW-2), ported from the prototype's `views/live.js` and `live.css`. It replaces the "comes in 0.4" page.

| Where | What it does |
| --- | --- |
| `screens/live/liveModel.ts` | The rules without a screen: the session Live loads (`defaultLiveSession`), the rooms from the outputs (`liveRooms`: each bot joining or in a voice channel, named after it) and their one status, Add a room's choices, the one-click Join, where a box plays (`boxTarget`), Off script search, what Scene music and the Pads box offer, the end words, and what each key does (`liveKey`). |
| `screens/live/liveState.ts` | What Live keeps while the page is open: the scene on now and on standby, the Undo offer (8 s), To: per box, the list Scene music shows, the board, the search, open rows. A visit to another screen finds Live as it was. |
| `screens/live/liveData.tsx` | One context for the boxes (library index, session, scene, rooms, names, play orders), and the engine's own sequence rules (`sequenceOf`) so the lists show the order that plays, a shuffled playlist dealt with the seed of the music on air. |
| `LiveScreen.tsx`, `LiveTop.tsx`, `Scenes.tsx`, `OnAir.tsx`, `Pads.tsx`, `ToChip.tsx`, `live.css` | The screen: one, two or three columns at 820 and 1200 px of the app; the keys on `document` (Space, /, pad keys, Shift+Esc, Ctrl+Z, Esc), the single-key switch kept as `lyre-live-keys1`. 0.5.0 replaced Scene music, Off script and the per-room boxes: see "0.5.0 step 2b: w6-live" below. |

Live reads `getNowPlaying()` and calls the audio host; it keeps no sound state. A room's volume and mute are the bot's (`useOutputs`, the same as Outputs and the Now playing bar). Live sets `showsOnAir`, so the bar there shows the preview only. Loading another session (Run, the session menu) fades what plays from elsewhere in the first room over 3 s, as `liveStandby` did.

PLY-15: the track name in an On air box has `normaliseHover` after its own name in its hover text (the lane's playlist, the library's setting from `library.normaliseSettings`); nothing is added on screen.

Engine change: a track picked from a shuffled playlist in a scene (`playTrack` with `from: { scene, at }`) plays from its place in the new deal, within the same scene item, instead of off script (`Director.itemFor`).

Not built: Copy what another room plays starts that room's tracks from the top (the audio host cannot start a track part-way).

## Wave 4: w4-prep-b

Phase B of wave 4 for the Campaigns screens, the session planner, the Audio profile and the pad boards (design/prototype/ROUND5.md).

| Where | What it does |
| --- | --- |
| `screens/campaigns/SessionScreen.tsx` | A scene's music rows: play order for playlists in the scene (PLY-13); a track's tags and shape on a second line, with the scene's name for it and its own name beside (ORG-11, DAT-14); the wave button "Waveform, end and fades in this scene" (PLY-14); ⋯ › Name in this scene… and Use in… (DAT-14, ORG-12). The folded scene's chip and hover text use the scene's names. Back from the Audio profile opens the scene and focuses the wave button (`kit/sceneReturn.ts`). |
| `screens/campaigns/OnHand.tsx` | Campaign and session lists: the play order button for that list; single tracks on hand after the playlists ("Single track", tags; ⋯ › Waveform, end and fades in this session, Use in…, Remove) (ORG-12). A session playlist's open tracks link to the session's own settings. |
| `screens/campaigns/parts.tsx` | `Contents` of a playlist in a scene or session list: names in the scene, tags, the wave button. |
| `screens/campaigns/pickers.tsx`, `kit/Picker.tsx` | ORG-10: in the music picker an open playlist lists its tracks, each with a box ticked in the picker's own list (`renderContents(item, ticks)`); tracks show their tags. |
| `screens/campaigns/trackDialogs.tsx` | Name in this scene… (`sessions.setTrackName`) and Use in… for a track (`campaigns.setUses({ kind: "track" })`). |
| `screens/profile/` | A session list is a place (`places.ts` `sessionOf`, `sss`; "Session list: …" under Sessions). Opened from a scene or session, Back to <scene> / Back to Session n returns to the planner; from a scene, Name in this scene in the header; the shape tag in the header (suggested from the peaks the waveform draws while the track list has none yet). |
| `screens/boards/` | SFX-11: the resize message as the prototype words it (`resizeMessage(after, moved, cameBack)`). SFX-12: ▶ Preview on every tile; Try pads in the Pads header (`useTryPads` in `BoardScreen.tsx`): a press, or the pad's key, plays it through `LyreAudio.tryPad`; tiles say Playing or Sounding; leaving the board or turning it off stops it. |
| `audio/lyreAudio.ts` | `tryPad(board, pad, phase, { from })`: the pad played as in Live (toggle, hold, one-shot, restart; variants random or in turn) on the preview, so only the game master hears it. `ScreenSound` fills in `from`. |
| PLY-15 (after merging w4-normalise) | The Audio profile header has `NormaliseChoice` for the track (line and hover for the playlist that Settings for names, else the track on its own); its previews, and previews of a scene's or session's playlist tracks (`PreviewButton` track target `playlistId`), follow that playlist's choice. The Now playing bar's track names add `normaliseHover` to their hover (`TrackName` `hover`). |
| `common/lyre/prototypeLevels.ts` | The prototype's made-up loudness (core.js `L.levels`). The fake answers it as peaks, and test builds seed it (`seedPrototypePeaks`), so the sample library suggests the design's shapes. |

## Wave 4: w4-guide

FND-8 (Help in the app, the first-run tour) and FND-9 (Save diagnostics); design in design/prototype/HELP.md.

| Where | What it does |
| --- | --- |
| `src/lyre/help/articles/*.md`, `articles.ts` | The help articles (one Markdown file each, bundled as text with `?raw`: webpack `asset/source` in `webpack.rules.js`), their head (`title`, `group`, `words`), `blocksOf` (paragraphs, steps, lists, labels, keys) and `searchArticles`. The prototype's build inlines the same files. |
| `src/lyre/help/HelpPanel.tsx`, `HelpText.tsx`, `help.css` | The side panel: search, groups, an article with Back, Take the tour and Save diagnostics… with its result line. A landmark (`aside`, "Help") in `#app`'s third column, over the screen below 900 px. |
| `src/lyre/help/Tour.tsx` | The five steps (`TOUR_STEPS`), a ring round the target and a popover with an arrow. |
| `src/lyre/help/useHelp.tsx` | What the shell places: the rail button's state, the panel, the tour; F1 on the window (after screens' own keys, so a Live pad on F1 wins); focus in and back; the tour shown once when `<Shell firstRunTour>` (the page root) and remembered as `tour: "done"` in `lyre-shell`. |
| `src/lyre/help/keys.ts` | `keepKeysHere`: keys in Help and the tour stop there, except Ctrl/Alt keys, F keys and Shift+Esc. |
| `src/lyre/shell/Rail.tsx` | The Help button (`#rail-help`) between Look and feel and Icons only. |
| `src/common/lyreDiagnostics.ts`, `src/lyre/help/preloadDiagnostics.ts` | `window.lyre.diagnostics` (`save`, `show`) and its result shape. |
| `src/main/diagnostics/` | `logBuffer.ts` (in-memory log and blocked warnings), `diagnosticsLog.ts` (started first in `src/index.ts`), `scrub.ts`, `diagnosticsZip.ts` (the zip, on `transfer/zip.ts`), `diagnosticsBridge.ts` (the two channels, the sources; wired in `SessionManager` at `--- w4-guide wiring ---`). |

## 0.4.1: w5-fixes

Fixes from Nik's test of 0.4.0 (BUG-19 to BUG-21).

- **What goes to the players is heard only through Discord** (BUG-19). The audio host joins no room audibly to the Lyre page's speakers (`LyreAudioParts` has no `speakers` any more; every room's mix feeds `keepAlive`, a gain of 0 into them, because Chromium runs only the parts of a graph that lead somewhere, and with no bot nothing else taps the rooms), and the capture window plays the Lyre page's room frames into the room's `volume` node, past `input`, so they reach that room's encoder and never "This Computer" (`RoomMix.localVolume` carries the room's tabs and input devices there at the same volume). Preview and Try pads still play in the headphones (PRV-1). With no bot in a voice channel the table plays to nobody: the Now playing row says "No bot is in a voice channel: nobody hears it", and Live's "On air: no room yet" box shows "Nobody hears it" while something plays there; the top strip keeps its Join. The old player and website tabs are unchanged.
- **Stop pads in Live** (BUG-20). `RoomPlayer.firePad` stops a pad that sounds in that room on a press, whatever its play mode (a toggle or hold pad with its own fade, a one-shot or restart pad in `DEFAULT_FADES.padStop`, 0.3 s), and the Director picks a variant only for a press that starts one. New cue action `stopPads` (`LyreAudio.stopPads()`, "Pads stopped"): every pad sound in every room; music, ambience and effects played on their own go on. It cannot be put on a hotkey (`cueActions.ts` refuses it). Live's pad tiles are pressed (and show On, with one room) while they sound, for every mode; the Pads header has Stop pads (dimmed with `aria-disabled` while none plays, so focus stays on it). Try pads follows the same rule (`LyreAudio.tryPad`, the board's tiles pressed while a pad sounds), and the play mode help says so. One-shot and Restart on press now behave the same in Live.
- **Rename a session on its page and in Live** (BUG-21). The session page's h1 is a button holding "Session n: name" (click or F2 turns the name, not the number, into `kit/RenameInPlace`'s box; Enter saves through `sessions.update`, Esc cancels, focus goes back to the title). Live's session menu button (`LiveTop.tsx`) takes F2 and has Rename session first in its menu; while editing, the strip shows the campaign, "Session n:" and the box. `PopMenuButton` gained `onKeyDown` and `dataK` for it.

## Wave 6: w6-contracts

Step 1 of the 0.5.0 build: the data, calls and sound state design round 6 needs (design/prototype/ROUND6.md parts 3 to
5, R6-NIK-DECISIONS.md), tested, with no screens. Schema version 5 is in docs/data-model.md.

**Shared rules** (`src/common/domain`): `round6.ts` (`TrackOrders`, `tracksInPlaceOrder`, `placeOrderToKeep`,
`RepeatOnes`, `repeatsOneIn`) and `roomList.ts`, each room's running list as pure functions over an immutable
`RoomList`: `playNext` (right after the current track, newest first; Play next of the track the plan plays next
anyway skips the planned copy), `addToQueue` (after the bottom of the plan, in the order added), `playNow` (a single
track while the plan plays), `pickNext` (Repeat one, the rest of a Play next playlist, Play next, the plan with its
skips and the play order's own loop inside a scene, what was added, then round again or stop), `upNext` (entries top to
bottom with the `ref` × takes), `removeFromUpNext`, `clearAdded`, `undoLast` (the last add, removal or clear, once),
`newPlan`, `sceneStarted` (clears what was added), `musicStopped`, and the room's Repeat (`RoomRepeat`,
`shownRepeat`, `nextRepeat`). The host gives each call a `PlanView` (the plan's steps and where it is).

**LyreApi** (`api.ts`, `LYRE_API_METHODS`, the fake, the main process, argument checks and the contract suite follow):

| Area | Added or changed |
| --- | --- |
| library | `find({ text, lane?, limit?, in? })`: tracks (as `search`) and playlists in one call; a playlist found in Live's session (or its campaign) comes with its tracks in that list's order and that place (ORG-14). |
| playlists | `trackOrders()`, `setTrackOrder(id, place, trackIds)` (answers the order that plays there, or null for the playlist's own), `clearTrackOrder(id, place)` (ORG-13). |
| sessions | `SceneInfo.repeatOnes`; `setRepeatOne(scene, trackId, on)` (PLY-17). `repeatOnesOf(campaigns)` (`lookup.ts`). |
| import | `previewFound(trackId)` and `endRelinkPreview()` (SEC-17). |
| every write | A write the computer could not save (SQLite FULL, IOERR, READONLY, CANTOPEN, BUSY, LOCKED, PERM) is refused with the new code `"not-saved"` and `NOT_SAVED`'s words, nothing changed, instead of a thrown fault (UX-19). `failNextWrite()` on the fake and the main API (tests; test builds through `__lyreLibraryTest`). |

**Audio host** (`src/lyre/audio`, engine `src/player/engine/queue`): `RoomPlayer` keeps a `RoomList` and the plan item
beside its music lane; every track end, Next and Previous go through `pickNext`; a scene start clears what was added
and the scene's Undo snapshot holds the list. `ShowLibrary`/`LyreAudioLibrary` gain `trackOrders()` and `repeatOnes()`
(`LibrarySnapshot` loads them), and `sequenceOf` deals a playlist in its place's track order (shuffle on top).

- `RoomNowPlaying` gains `upNextList` (`UpNextEntryNow`: `ref`, `kind` playNext / planned / added, `trackIds`, `title`,
  `playlistId`, `rest`), `repeat` (`{ chosen, shown }`) and `canUndoUpNext`. `upNext` and `queued` keep their meaning
  (the first entry; what was added).
- New calls: `playNext(what, { target })`, `addToQueue(what, { target })` (`what`: a track with its `from`, or a
  playlist with its `place`; a silent room plays it at once), `removeFromUpNext(ref)`, `clearAdded()`, `undoUpNext()`,
  `setRepeat(repeat)`, `cycleRepeat()`, `savedRepeatOneChanged(scene, trackId)`, `sessionLoaded()`. `playTrack({ when:
  "next" })` and `removeQueued` work on the same list; several Play next tracks now play the newest first.
- BUG-22: `profilePlan` keeps a start's distance before the file's real End, and a voice loops only when its plan has
  something to loop.

**Bots in the Lyre page** (OUT-8, OUT-7): `LyreBot` gains `savedName`, `tokenEnd` (last four characters), `tokenRemembered`,
`applicationId`, `inviteUrl`, `canRemove`; `LyreOutputs.encryption`. `src/common/lyreOutputs.ts` has
`BOT_INVITE_PERMISSIONS` (3146752), `botInviteUrl`, `isApplicationId`, `isBotToken`, `applicationIdProblem`,
`tokenProblem`, `undoOfMove` and `LyreBotResult`. `window.lyre.outputs` gains `addBot`, `replaceToken`, `rename`,
`setApplicationId`, `remove`, `restore`, `connect`, `disconnect`, `openInvite` (`OutputManager.addBotWithToken`,
`replaceToken`, `renameBot`, `setApplicationId`, `removeBotForUndo`, `restoreBot`, `disconnect`,
`inviteOpenedByDriver`; `BotTokenStore` keeps the name and Application ID, works out the token's end once, and
`takeOut`/`putBack` for Remove's Undo). Moving a bot or Kick (`move`, `leave`) are as before; `undoOfMove(before, bot)`
says what undoes them. `FakeOutputs` does all of it in memory; the test builds' Discord admits a new bot once its
invite was opened (`FakeWorld.notInvited`, `DiscordDriver.inviteOpened`).

What the screen streams must know: Find a track is `library.find`; Up next is `upNextList`; call
`savedRepeatOneChanged` after `sessions.setRepeatOne`, `sessionLoaded` when Live loads another session, and
`import.previewFound` before "Preview the file found" (`endRelinkPreview` when Find missing files closes). The order
of playlists in a session's or campaign's list is `campaigns.setOnHand`.

## 0.5.0 step 1b: w7-contracts

The data, calls and sound state design round 7 needs (design/prototype/ROUND7.md), tested, with no screens. Schema
version 6 is in docs/data-model.md.

**Shared rules** (`src/common/domain/round7.ts`): `TagTree`, `tagsInside`, `trackHasTag` (rules and `playlistTracks`
take the tree through `DomainLookup.tagTree`), `offerTags` ("sad" offers Melancholy); `folderPath`; `DropPlace` with
the prototype's keys (`dropPlaceKey`, `parseDropPlace`); `CueStep`, `MovesOn`, `usualSceneSteps`, `usualPadSteps`,
`stepsToKeep`, `checkSteps`; `roleChoices`, `roleProfile` (a sting never loops; Ending "Fades out" fades over 4 s
unless a profile has a fade out); `PlayedEntry`, `addPlayed`; `SHORTCUT_ACTIONS`, `shortcutKey`, `shortcutUsing`,
`keyName`, `normaliseKey`, `guardAllows`; `DisplaySettings`, `AudioDevices`, `Crossfade` with their checks.
`DomainTrack` gains `fadesOut`, `resume`, `follow`; `DomainScene` `steps`, `movesOn`; profile markers `mix`.

**LyreApi** (`api.ts`, `LYRE_API_METHODS`, `fake.ts` + `fakeRound7.ts`, `libraryApi.ts` + `libraryApiRound7.ts`,
`argChecks.ts`, the contract suite's "design round 7"; one IPC channel as before, `LYRE_API_CALL`):

| Area | Added or changed |
| --- | --- |
| library | `LibraryTrack.fadesOut`, `resume`, `follow`; `updateTrack` takes them. `find` also answers `pads` (label) and `scenes` (Live's session first). `put({ place, what, from?, move? })` (ORG-5): tracks into a manual playlist (Shift: out of `from`), effects and stings as new pads on a board, tracks, playlists or boards into a scene; one undo step. Up next is not a place here: it is `LyreAudio.addToQueue`. |
| tags | `TagGroup.color`, `tags` (`TagInfo`: parent, other words, colour); `createGroup`, `updateGroup`, `moveGroup(by)`, `deleteGroup`, `createTag`, `renameTag`, `mergeTag`, `deleteTag` (each of the last three answers how many tracks changed), `updateTag` (parent, other words, colour), `moveTag(by)` among the tags at its level. |
| folders (new) | `list(kind)`, `create(kind, { name, parentId?, moveIn? })`, `update`, `delete` (what was in it moves up), `moveInto(kind, itemId, folderId)`; kinds playlists and boards. `PlaylistInfo.folderId`, `PadBoard.folderId`. Folding a folder is the screen's (kept per computer like an open box), not a library change. |
| playlists | `PlaylistInfo.dividers` (`{ id, name, at }`, `at` the track it sits above); `addDivider`, `renameDivider`, `removeDivider`, `moveItem` (a track or divider to a place in the list as shown, `withDividers` in `lookup.ts`). `moveTrack` keeps counting tracks only. |
| boards | `PadBoard.dividers` (`{ row, name }`), `Pad.steps`; `setDivider(board, row, name \| null)`, `setPadSteps` (the usual steps keep none). |
| sessions | `SceneInfo.steps`, `movesOn`; `setSceneSteps(scene, steps, movesOn)`. A duplicated scene keeps both. |
| profiles | markers' `mix` (one per profile). |
| settings (new) | `get()` → `LyreSettings`; `setCrossfade`, `setShortcut` (a key in use is refused naming its action), `resetShortcuts`, `setNextSceneGuard` (with the library, undoable); `setComputer({ display, devices, globalKeys })` (this computer's, `this-computer.json` beside the library, no undo step). New area `"settings"`. |

`lookup.ts`: `tagTreeOf(groups)`, `withDividers(trackIds, dividers)`; `lookupFrom` takes the tree. The seed has the
prototype's other words (Melancholy: sad, sorrowful; Dread: fear, horror; Tense: suspense) and Grief inside Melancholy.

**Audio host** (`src/lyre/audio`, engine `src/player/engine/queue`): the Director runs a scene's own start and a pad's
steps (`runSteps`; waits on the engine's clock, `PlaybackEngine.scheduler`; a scene step starting scenes stops after
four rounds; a new scene start or Undo stops what waits), and a scene moving on after a time or when its music ends
(its list then plays once, `playsOnce`). Fade all and Stop all cancel everything waiting (review 0.5.0 CR-1,
`cancelWaitingIn`): the scene's moving on, its steps after a wait, every pad's steps (`padRunGeneration`) and the
scene's Undo, so nothing starts by itself until the game master starts something. Aimed at one room (a saved cue), they
cancel only what waits there (lead decision, 11 Nov): pad steps aimed at that room (`roomStops`), and the scene and its
Undo only when the scene plays in that room. The RoomPlayer applies
`roleProfile`, starts a track from a marker (`fromMs` on `playTrack` and on Play next / Add to queue's track), picks a
"Pick up" track up where it stopped (shared by the rooms, kept across restarts; forgotten when it plays to its end,
CR-5), hands a play step over at the mix-out marker, at the end of a loop or when the track ends (`handOverAt`; Next,
Previous, a new track, a stop or Undo call a waiting one off, CR-4), plays Follow with when nothing else waits (Play next, the queue and a scene's own next item come
first), fades the music to a step's level, and keeps What played (`played`, newest first, 100 at most).

- `RoomNowPlaying.played` (`trackId`, `title`, `at`, `from` for Play again); `LaneNowPlaying.level`;
  `NowPlaying.previewEar`.
- Events `show-board` (a step shows a board) and `scene-started` (`by`: press, step, moved-on: Live follows it).
- `setAudioDevices(devices)`: the preview's device, and the preview in one ear of a split headset
  (`BridgedPreviewOutput.setEar`, a stereo panner before the bridge, only while split).
- `LyreAudioLibrary.crossfade?()` (Next, a playlist moving on, play steps; default 3 s) and `nextScene?(ref)`;
  `LibrarySnapshot` loads `settings.get()` and `tags.listGroups()` (the tag tree) and hands pads their steps.
- PLY-11: read-ahead also holds what follows the playing track when nothing else waits.

What the screen streams must know: call `audio.setAudioDevices(settings.devices)` after `settings.get()` and after
`setComputer`; apply `display` with `webFrame.setZoomFactor(textSize / 100)` and `data-density` / `data-contrast` on
`<html>`; Live's keys read `shortcutKey(settings.shortcuts, …)` and Next scene uses `guardAllows`; Live follows
`scene-started` with `by: "moved-on"` or `"step"` and shows `show-board`'s board; What played's Play again is
`playTrack(trackId, { from })`; a pad's What it does… and a scene's What it does when it starts… save with
`stepsToKeep` semantics (sending the usual steps keeps none). Global keys (`globalKeys`) are stored but not yet
registered: the main process needs `globalShortcut` for Next scene and Fade everything out (a later step).

## 0.5.0 step 2a: w6-shell (the shell)

Round 6 parts 5 to 7 and round 7's shell (design/prototype/ROUND6.md, ROUND7.md), in `src/lyre/shell` and the kit.
What the other streams use:

| Piece | Where | Use |
| --- | --- | --- |
| Back and the trail (UX-18) | `shell/TopBar.tsx` (`TopLead`), `shell/history.ts`, `shell/restore.ts` | Put `<TopLead />` first in a screen's `.viewhead` (Live: first in `.lv-top`). The shell keeps one history of 50 places (every address change, the menu included), restores scroll positions (`data-scroll` names a scroller; else its place in `#view`) and the control used to leave (`data-k`, `id`, else kind, name and position). A screen with no history may pass `fallback={{ label, go }}`; a screen whose parents are not in its address passes `trail`. Labels and parents come from `ShellData.placeNames` (`history.ts` `placeLabel`, `trailOf`). Alt+Left and the mouse's back button go back too. |
| The Saved pop-up (UX-19) | `shell/Announcer.tsx` (`saved`, `saveFailed`, `toast`), `shell/useSave.ts`, `kit/SavedField.tsx` | Save with `const save = useSave(); save("The Sunken Crown notes", () => api.x(...), { key, detail })`: Saved on success, the failure card with Try again on `"not-saved"`, the refusal's words otherwise. A text field is a `SavedField` (Enter, leaving, or a second without typing; `SAVE_AFTER_MS`). No box shows Ready or Saved. The Undo note sits in the same corner (`UNDO_SLOT_ID`). |
| Find and play (UX-12) | `shell/FindAndPlay.tsx`, `shell/findModel.ts` | Ctrl+K anywhere (the key from `settings.shortcuts.palette`), over `library.find`; given to the shell as `ShellData.FindAndPlay`. |
| Display (UX-11) | `shell/display.ts`, Look and feel's Display | `settings.setComputer({ display })`; `applyDisplay` sets `data-density` and `data-contrast` on `<html>` and zooms through `window.lyre.display.setZoom` (preload, `webFrame.setZoomFactor`, 1 to 2). |
| No hidden text (UX-6) | `kit/noHiddenText.ts` | Installed by the shell on `#view`: a name cut short gets its full text as hover text and, on focus, in a tooltip. Nothing to do in a screen beyond using an ellipsis or a line clamp. |
| Help from a screen | `help/useHelp.tsx` `useOpenHelp()` | Opens Help's panel (Live's Keys has Help at its foot). |
| Kit pieces | `kit/icons.ts`, `styles/ui.css` | Icons `undo`, `mute`, `leave` (Kick), `playair`; `Pane kind="current"`; `.pane-scope`; row buttons greyed at rest (`.row-quiet` in a `.row-hot` row); trays (`.tray.tray-session`, `.tray.tray-campaign`, `.tray-h`). |

Rooms (OUT-9): the rail, the heading and Help say Rooms; the address stays `#/outputs`. Settings is on the rail with a
placeholder screen at `#/settings` until the Rooms and Settings stream builds it. Help has the round 6 drafts (Live
rewritten, "Play next, Add to queue and Repeat" new); `design/prototype/help-drafts` is gone, so the prototype reads
the app's articles again.

## 0.5.0 step 2c: w6-rooms (Rooms and Settings)

| Where | What it does |
| --- | --- |
| `src/lyre/screens/outputs/` | Rooms (OUT-7): each bot in a channel a chip with Kick; Add bot (one click with one free bot, else a short choice, `addBotChoice`); Kick and a move away from listening players get the undo bar (`kickLosesSound`, `moveLosesSound`); Undo of a Kick sends the bot back and plays its lanes from where they were (`roomToRestore`, `src/lyre/outputs/roomRestore.ts`); Nobody there with Move to the busiest free channel (`nobodyThere`, `busiestChannel`, review Must 2); a level meter (OUT-10, `meterFill`). The h1 still says Outputs: the shell renames it. |
| `src/lyre/audio` | `LyreAudio.roomLevel(roomId)`: an AnalyserNode beside a room's mix (`analyserMeter`), made on first ask, let go with its room. |
| `src/lyre/shell/UndoNote.tsx` | `offerUndo(text, restore)`: the undo bar for a change outside the library (Kick, Remove a bot); Ctrl+Z runs it while it shows. |
| `src/lyre/screens/settings/` | Settings (route `settings`, rail link above Look and feel): `BotsPane` (bots, Add a bot), `OtherPanes` (Sound to Discord with the crossfade, Headphones and speakers, Remote control, Keyboard shortcuts, Website tabs, Local files), `settingsModel.ts` (words, key capture `keyPressed`). Saves show "Saved: …" through the status note (`useSaved`, a TODO for the shell's pop-up). |
| `src/lyre/settings/SettingsAppliers.tsx` | In AppProviders: applies `settings.devices` to the audio host, registers the global keys, keeps their refusals (`useGlobalKeyRefusals`), and turns each global press into a cancelable `lyre-global-key` window event (`GLOBAL_KEY_EVENT`). **Live** must listen for it (a key registered globally is not seen by Lyre's own keydown) and `preventDefault()` what it handles; a Fade everything out nobody took fades every room. |
| `src/lyre/keys/`, `src/lyre/windowSettings/` | `window.lyre.keys`, `window.lyre.windowSettings` (docs/security.md w6-rooms). |
| `src/main/globalKeys.ts`, `src/main/windowSettings/`, `src/main/remote/homeNetwork.ts` | Global keys, the main window's settings for the Lyre page, the home-network address. |

Shared helpers for Live (OUT-7, Must 2): `outputsModel.ts` `kickLosesSound`, `moveLosesSound`, `roomToRestore`,
`nobodyThere`, `busiestChannel`; `restoreRoom` for Kick's Undo with the music.

## 0.5.0 step 2b: w6-live (Live in seven boxes)

Round 6 parts 3 to 7 and round 7 part 2 of Live (`design/prototype/src/views/live.js`, `live.css`; Nik's decisions in
R6-NIK-DECISIONS). Seven boxes, each a region with its own name: On air (at the top, the whole width, a part per
room), Scenes, Current scene, and the trays This session (Session playlists, Session pads) and Whole campaign
(Campaign playlists, Campaign pads). Find a track or playlist is a field in the top strip.

| Where (`src/lyre/screens/live/`) | What it does |
| --- | --- |
| `liveModel.ts` | The rules: rooms with Nobody there (`liveRooms`, `roomStatus`, `noRoomStatus`), the channel menu's "empty" and "· players" (`channelChoices`), how Up next folds (`upNextRows`: the plan's next track, "n more", one line past four), Find (`findSearch`: playlists and tracks, ORG-14), the trays (`trayContents`, `ownBoards`), the boxes' order (`LIVE_BOXES`, Alt+1 to 7 and F6), and the keys (`liveKey` with `LIVE_KEYS` or Settings › Keyboard shortcuts). |
| `liveState.ts` | What Live keeps: the scene on now, the scene's Undo and the other Undo (`undo2`: an add, a removal, Clear added, Kick, a move), `touched()` (Must 1: any other change ends them), To: per box, the boards chosen, Find, open scenes, Up next and What played open, the ambience waiting in each room (`aq`), the names of single tracks played from a place (`airNames`, DAT-14), and the last Next scene key (the guard). |
| `liveActions.ts` | What the row buttons do: Play on air, Play next and Add to queue (the audio host's `playNext` and `addToQueue`; an ambience waits in `aq` until Next on the ambience), Next in a room, × in Up next and Clear added, each with its Undo. |
| `Rows.tsx` | The rows: a track, a playlist that unfolds, a scene's ambience, a scene's music in play order (running: each row a step of the scene; not running: Play on air plays that item only, SHW-7). Preview, Play next, Add to queue, Repeat one (saved with the scene: `sessions.setRepeatOne`, then `audio.savedRepeatOneChanged`), play order, Play on air. |
| `OnAir.tsx` | On air: a part per room with its status, What played, Mute, volume, the bot's menu (move, another bot, copy a room, Rooms, Bots and tokens), Kick with Undo (`restoreRoom`), Nobody there with Move to, the lanes (markers as ticks, Repeat for what plays now), effects, Up next; No room with Join; one line per room under 480 px of height. |
| `Scenes.tsx`, `CurrentScene.tsx`, `Trays.tsx`, `Find.tsx`, `UndoStrips.tsx`, `focus.ts` | The other boxes, the Undo strips, and where focus goes. |
| `kit/Pane.tsx` | `scope`, `scopeHidden`, `label` (a tray's box: "Playlists" shown, "Session Playlists" read out) and `keys` (aria-keyshortcuts). |
| `kit/DestTag.tsx` | `nobody`: "On air · no room" (or "On air · nobody there", UX-R9, also on the Now playing bar) outlined in the warning colour, with why on hover (Should 10). |

Live takes F6 in the capture phase so it follows the boxes' order in every layout (the shell's F6 follows the page's
order). Loading a session calls `audio.sessionLoaded()`; Live follows `scene-started` (by a step or moving on by
itself) and `show-board`.


## 0.5.0 step 2d: w6-prep (the prep screens)

Round 6 and round 7 on Library, Tags, Playlists, Pad boards, Campaigns, the session planner and the Audio profile
(design/prototype/ROUND6.md, ROUND7.md; the prototype's r7tags.js, r7org.js, r7play.js). What the other streams use:

| Piece | Where | Use |
| --- | --- | --- |
| Tags (DAT-10) | `screens/tags/` (`#/tags`, section Library) | Groups, tags inside tags, other words, colours; rename, merge and delete with the Undo note. The Library's filters and counts take the tag tree (`model.matches(…, tree)`), and a track's tag box offers a tag for another word (`offerTags`). |
| Steps (PLY-8, SHW-3) | `screens/steps/StepsDialog.tsx`, `stepsModel.ts` | `<StepsDialog owner={{ kind: "scene", … } \| { kind: "pad", … }} />`: the usual steps when none are kept, Add a step, How it comes in, Up next, From (a marker), Then, Try in headphones; Done saves with `stepsToKeep` semantics. `<SceneMarks scene />` shows Moves on by itself and Own start; Live's Scenes box can use it. |
| Repeat one (PLY-17) | `kit/RepeatOneButton.tsx` | The saved Repeat one of a scene's track, as the planner shows it; it calls `sessions.setRepeatOne` and then `audio.savedRepeatOneChanged`. Live can use the same button in Current scene. |
| Order per place (ORG-13) | `screens/campaigns/PlaceTracks.tsx`, `api/hooks.ts useTrackOrders` | A playlist's tracks in a scene, a session or a campaign: Reorder (Move up, Move down), Alt+Up/Down, drag, Back to the playlist's order. The campaign's and session's playlists move with Alt+Up/Down (`OnHandList onMove`). |
| Folders (ORG-4) | `screens/folders/` (`useFolders(kind)`, `api/hooks.ts useOrgFolders`) | `const f = useFolders("playlists")`; draw the list with `f.list({ label, className, all, shown, filtered, renderItem, nameOf })`, put `f.dialogs` in the screen, offer `f.openMoveTo(item, name)` in an item's ⋯, and `orgDragProps(kind, id)` on what is dragged onto a folder. Folding is kept on this computer (`lyre-folders-closed`). |
| Dividers (ORG-4) | `PlaylistPage.tsx` (`withDividers`), `BoardScreen.tsx` (`BoardDivider`), `BoardDialogs.tsx` | A manual playlist's dividers are `PlaylistInfo.dividers` (`at`: the track they sit above); a board's are `PadBoard.dividers` (`row` counted from 0; the dialog shows rows from 1). Live draws a board divider as a heading above its row. |
| Drop on and Add to… (ORG-5) | `screens/drop/` (`DropTray`, `AddToDialog`, `usePut`, `dropTargets`) | `<DropTray resolve={(el) => ({ ids, from } \| null)} />` in a screen whose rows are draggable; places are the prototype's keys (`pl:`, `pb:`, `q:`, `sc:`); `library.put` writes, `audio.addToQueue` fills Up next. |
| Markers (DAT-3) | `screens/profile/boxes.tsx`, `useProfileController.ts` | Mix out (one per profile, `markers[].mix`) and Play on air from (`audio.playTrack(id, { fromMs })`). Live's progress lines read `profile.markers` (`mix` for the accent tick). |
| How a track behaves (PLY-4, SHW-3) | `screens/library/TrackBehaviour.tsx` | Ending, Pick up where it stopped and Follow with…, as `roleChoices` allows (since 0.5.1 Pick up for every music track but a sting); a sting's loop advice is off. |
| Resume positions (PLY-4) | `src/player/engine/queue/resumePositions.ts` | The lead's decision: where Pick up tracks stopped is kept across restarts, on this computer (`lyre-resume-positions`); the host hands the map to the Director. |
| Kit | `kit/Pane.tsx` `description`, `kit/Dialog.tsx` `description` | Round 6's "read out, not shown": a box's or dialog's how-to is its description (pickers pass their intro so). |

Also: Find missing files' Preview the file found calls `import.previewFound` first and `endRelinkPreview` when it
closes (SEC-17); a duplicated scene copies its track orders and play orders (the lead's decision, contract suite).

## 0.5.0 usability review fixes (w6-ux)

The independent review (UX-R1 to UX-R21) left these kit rules for every screen:

| Piece | Where | Use |
| --- | --- | --- |
| Dialog focus (UX-R1) | `kit/Dialog.tsx` | Focus goes to the first control that can take it (a greyed one is skipped), else the first enabled button. `enterSubmits`: Enter in a one-line text field presses the footer's main button (UX-R20). |
| Resting statuses (UX-R3) | `kit/Pane.tsx` `isRestingStatus`, `foldedSummary` | Round 6 rule 4, as the prototype's `L.quietStatus`: an idle "Empty", "Copied" or count ("4", "12 pads") shows only while the box is folded; `foldedSummary` does the same for a summary that repeats the open box. A status that says something happens (Playing, Trying, n sounding, a warning) always shows. |
| Key legends (UX-R3) | `styles/ui.css` `.keys-on-focus` | A key legend or reorder how-to shows only while the keyboard is in its box (round 6 rule 5); keep it the box's description too. |
| Focus after a change (UX-R4) | `kit/focusSoon.ts`, `screens/live/focus.ts` `focusLiveSoon` | When the control in use goes, focus a neighbour once it is drawn (or, with `move`, a new control such as a new room's bot button); it stops when the person moves focus. |
| One event, one message (UX-R6) | `shell/Announcer.tsx`, `shell/savedModel.ts` | The pop-up is shown at once and read out from the live region 120 ms later (`READ_NOTE_AFTER_MS`); a `say` in that moment is read instead. The pop-up itself is `aria-live="off"`. Live's Undo strips are groups named Undo, not statuses. |
| Counts while typing (UX-R7) | `kit/useSayWhenSettled.ts` | A result count is read out once typing pauses (500 ms); the count on screen is not a live region. |
| Undo's focus (UX-R19) | `shell/UndoNote.tsx` `offer(text, undoLabel, focusBack)` | Where focus goes once a library change is undone (a CSS selector); Tags gives the tag's ⋯. |
| Version (UX-R16) | `src/lyre/version.ts`, `webpack.plugins.js` | `__LYRE_VERSION__` from package.json; Settings shows it at the top right. |

Words that changed: a room nobody is in says **Nobody there** everywhere (Rooms' status too, never Playing; the bar's
tag "On air · nobody there"; "Players hear nothing" under it); **Fade all** is the one name for Shift+Esc; Settings'
shortcut list says **Find a track or playlist**; Undo is "at the bottom right"; Play on air's icon is `playair` on
every screen and What played has `history`. With two rooms or more the audio host names the room in every message.
