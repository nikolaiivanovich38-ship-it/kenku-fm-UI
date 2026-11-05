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
- **One stream per room.** The capture window (`AudioCaptureManagerPreload`) keeps one mix per room, each with its own volume, frame worklet and Opus encoder; packets go over the private port as `{ room, packet }`, and `OutputManager.sendPacket(packet, room)` hands them to that room's bot only. Each source has a route (`CaptureRoute`: every room, the table, or one room; a departed room means the first). Tabs and input devices follow `DEFAULT_CAPTURE_ROUTE`, which is "all" so the current interface keeps working as in Lyre 0.2; the new interface calls `AudioCaptureManagerMain.setDefaultRoute("table")` and `routeView(viewId, route)`. "This Computer" plays the first room. When a room goes, its mix and encoder are freed at once. PERF-4 (capture only while a bot is in a voice channel), silence release, reconnecting and mute per bot are unchanged.
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
- Host wiring for wave 3 (player page): `const link = new PlayerAudioLink(); listenForPlayerAudioPort(window, link);` `const context = new AudioContext({ latencyHint: "playback", sampleRate: 48000 });` `createBrowserEngine({ audioContext: context, … })`, `const mixer = new RoomMixer(fromAudioContext(context)); window.player.onRooms((rooms) => mixer.setRooms(rooms));` `new RoomStreams({ mixer, link, createTap: await createBrowserFrameTaps(context) })`; the preview: `new PreviewPlayer({ output: await createBrowserBridgedPreview(link), … })`. While `RoomStreams` reports a broadcast, do not also connect room outputs to this page's speakers (the page would be captured and heard twice); outside a broadcast connect `mixer.output("table")` to `context.destination` to hear the engine locally.

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
| `lyreAudio.ts` | `LyreAudio` (the screens' calls: play a track, playlist or scene on air to a room or every room, Next/Previous, pause, stop a lane with a fade, fade all, stop all, pads, Play next queue, Undo, preview a track/playlist/pad, preview device; `getNowPlaying`/`subscribe`; `announce` and `error` events) and `EngineLyreAudio`, its implementation over the Director, `RoomMixer`, `RoomStreams` and `PreviewPlayer`. Every failed call returns its plain message and sends it once as `error`. The library comes in as `LyreAudioLibrary`: domain lookups, the `ProfileOverrides` provider, each track's file (`media`) and each pad; it must answer synchronously, so the data layer answers from what it has loaded. |
| `stableRooms.ts` | The rooms as the Director sees them. When the first bot joins, the mixer hands the table's mix to that room; the Director would see "table" vanish and stop it. Here that room keeps the table's id for the Director, so music started before joining goes on into Discord. A fresh table after the last bot leaves gets a new id, so the old one's voices stop. |
| `browserLyreAudio.ts` | `startLyreAudio`: engine context at 48 kHz, read-ahead with `MEDIA_PREPARE`, worklet taps, the bridged preview in a sink-less context; `assembleLyreAudio` joins the parts (unit-tested with fakes). The preview device is attached again on every new channel. |
| `preloadAudio.ts` | `createLyreAudioBridge(ipcRenderer, window)`: the new page's preload half (`window.lyre.audio`): holds and posts the channel's end, rooms, `MEDIA_PREPARE`. |
| `LyreAudioProvider.tsx` | `LyreAudioProvider`, `useLyreAudio`, `useNowPlaying` (useSyncExternalStore), `useLyreAudioEvent`. |
| `testing/` | `FakeLyreAudio` for screen tests; `lyreAudioOnFakes` (the real parts on the fake audio graph). |

Where sound goes: each room's mix reaches its bot only through `RoomStreams`; the page (role `lyre-view`) is never tab-captured. This page's speakers play the first room only while no broadcast runs; during one, the capture window's "This Computer" plays it, so it is never heard twice. The preview never reaches a room or this page's speakers.

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
- **Location.** `%LOCALAPPDATA%\lyre\library`; a UNC path, or a folder where WAL is refused, falls back to a rollback journal. The WAL is kept under 8 MB and checkpointed after bulk work.
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
| `previewClock.ts` | The preview's clock: play from the playhead or the last 10 s before End, loop back (counted), move on to the next track and stop a few seconds into it, stop at End, the end of the file. Pure; each step returns the sentence for the live region. |
| `useProfileEditor.ts` | The profile shown for one track in one place: a draft that shows at once, kept through `profiles.set` right away for a click, after 600 ms for a run of keys or typing, at the end of a drag, and when the screen closes; refusals are toasted and taken back. Give this place its own settings, Back to the track's settings (with Undo, kept while the track stays open). |
| `useProfileController.ts` | The actions (handles, playhead, fields, steppers, fades, markers, places, Play on air), the animation-frame clock, the preview's sound, and the single-key shortcuts (Space, I, O, L, M, arrows; switchable, kept under `lyre-profile-keys1`). |
| `ProfileScreen.tsx`, `boxes.tsx`, `Waveform.tsx`, `waveDrawing.ts` | The header with "Settings for", and the boxes Waveform and listening, At the end, Fades, Markers. |
| `ProfileLink.tsx` | The prototype's "Audio profile" link-button (L.profileLink), for other screens too; a candidate for `src/lyre/kit`. |
| `OnAirFallback.tsx` | The prototype's On air bar, shown by this screen only while `ShellData.onAirBar` is not fed; it steps aside when the shell has one. |

Limits of this version (each needs the audio host or the library first):
- **Preview sound.** `previewTrack(id)` plays the whole file from 0:00 without the profile, so the sound matches the playhead only from 0:00 and does not loop or fade as set. The playhead, the Looped count, the hand-over and the volume meter come from the screen's own clock (as in the prototype). Wanted from LyreAudio: `previewTrack(id, { startAtMs, profile })` (the Voice already takes `startAt` and `profile`) and the preview's position, so the clock can follow the sound.
- **Waveform.** The library has no loudness peaks for a file, so the waveform is an even band (shaped by the fades and the parts not played); the prototype's made-up shape is not drawn. `waveDrawing.ts` takes `levels` when peaks exist.

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
| `shared.tsx`, `drops.ts` | Preview and Play on air buttons, a playlist's contents, `PopMenu` (the kit menu's keys, with two-line items and a filter box), the on-air bar, refusals as toasts (`useWriteResult`, `useWriteOk`); paths from a drop. |

- **Sound** only through `useLyreAudio()`: Preview (`previewTrack`, `previewPlaylist`, state from `useNowPlaying().preview`), Play on air (`playTrack`, `playPlaylist`, 3 s fade). Errors and announcements become toasts and live-region text while a screen is shown.
- **On-air bar**: the shell shows `ShellData.onAirBar`; nothing supplies it yet, so these screens draw `OnAirBarFallback` (core.js `onAirBar`) when it is missing. When the page wires one, the fallback steps aside.
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
| `hooks.ts` | `useWrite` (refusals toasted in their own words), `useBoardSound` (preview and on-air state from `useNowPlaying`; the audio host's announcements and errors go to the live region and toasts while the screen is open), `usePendingFocus` (focus that waits until the reloaded data shows its target), `useSavedText` (fields saved as you type). |

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
| `parts.tsx` | `useLibraryIndex` (tracks, playlists, boards in one look-up), `useWrite` (refusals become toasts), `useAudioMessages` (the audio host's sentences to the live region, its failures to a toast), `useFocusLater` (focus a control once the library has redrawn the screen), `PreviewButton`, `PlayOnAirButton`, `Contents`, `RowMenu`, `ModeSwitch`, `DraftField` (saves after a 300 ms pause, on leaving the field and on closing, so a reload never moves the cursor and typing makes one undo step per pause). |
| `model.ts`, `reorder.ts`, `drops.ts` | Wording and look-ups; drag to reorder by a handle; dropped files to paths. |

- **Run and Live.** Run, Run next session and the Live side of the switch call `runInLive` (`src/lyre/kit/liveSession.ts`): the session is loaded in Live, ready to start, and `#/live` opens. The Live screen reads `useLiveSession()`; the shell can show it through `ShellData.liveCampaign` and `liveLabel`.
- **Themes.** A theme change is a `campaigns.update`; the shell follows through `ShellData.campaignTheme`, fed from `useCampaigns()` in `AppProviders`.
- **Session numbers** come from order: moving a session renumbers them from the lowest number, as the library does.
- **Dropped files** are imported with `import.start({ from: "paths" })`. The page learns a file's place on the computer from `window.lyre.files.pathOf(file)` (Electron's `webUtils.getPathForFile`); without it (tests), the file's name is sent.
