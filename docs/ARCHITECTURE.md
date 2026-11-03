# Architecture

Cue Desk is an Electron app (castlabs Electron 37, for Widevine) built with Electron Forge and webpack. Every page is TypeScript; the interface uses React 18, Redux Toolkit and MUI.

```
 Main window (renderer)          Tabs (WebContentsView)              Hidden capture window
 src/renderer, preload.ts  --->  websites, or the player page   ---> src/audioCapture, preload/managers
          |  IPC                 src/player                          getUserMedia(tab audio) -> PCM
          v                             ^                                   |  WebSocket (local)
 Main process  src/index.ts, src/main   |  IPC (remote commands)           v
   SessionManager -> PlaybackManager -> AudioCaptureManagerMain -> Opus -> DiscordBroadcast -> Discord
                  -> BrowserViewManagerMain, WindowManager
                  -> PlayerManager -> fastify remote API (127.0.0.1:3333 by default)
```

## Main process

- `src/index.ts`: start-up. Its first import, `src/main/migration`, points the data folder at `<appData>/cue-desk` (and sets the Windows app ID). `src/main/startup.ts` then runs the Windows installer check (`electron-squirrel-startup`), the single-instance lock and, in the one primary instance only, the Kenku FM library carry-over (`src/main/migration/carryOver.ts`), before any window or settings file is created. If Kenku FM was still running or the library failed to copy, a prompt offers to quit so the copy is retried on the next start. After that: session hardening, the main window (with the `window.navigator` user agent), auto-update and a few IPC handlers (`GET_VERSION`, `GET_PLATFORM`, `CLEAR_CACHE`).
- `src/main/security`: `sessions.ts` applies deny-by-default permission handlers and the request-header user-agent spoofing (a Chrome user agent, without the Chrome token for google.com sign-in) to the app's session and to the website-tab session (`persist:tabs`, `partitions.ts`), and clears both on "Clear cache". `navigationGuards.ts` keeps app pages on their own page, `externalLinks.ts` sends only https links to the system browser, `trustedContents.ts` records which web contents are the app's own pages.
- `src/main/managers/SessionManager.ts`: one per main-window load; creates and destroys the managers below.
- `BrowserViewManagerMain.ts`: the tabs. Each tab is a `WebContentsView` laid over the main window. Website tabs use the separate `persist:tabs` session; the player view uses the app's own session and preload.
- `PlaybackManager.ts`, `AudioCaptureManagerMain.ts`: receive mixed PCM from the capture window over a local WebSocket, encode it to Opus (`prism-media`) and hand it to `src/main/broadcast/DiscordBroadcast.ts`, which uses discord.js and `@discordjs/voice` with the user's bot token.
- `WindowManager.ts`: minimise, maximise and close for the frameless window.
- `src/menu.ts`: application menu. `src/bounds.ts`: window position, stored with electron-store in `config.json` (opened on first use, so it never touches the file before the carry-over).
- `src/autoUpdate.ts` with `src/main/updateFeed.ts`: Windows updates from the fork's GitHub releases through update.electronjs.org, only for copies set up by the installer (the zip build has no `Update.exe` and gets no updates).
- `src/main/appIdentity.json` and `appIdentity.ts`: data-folder name, app ID and GitHub repository, shared with `forge.config.js`.

## Main window (renderer)

`src/renderer` (entry `src/renderer.ts`, preload `src/preload.ts`). The shell around everything: tab bar and URL bar, bookmarks, Discord connection and output channel, inputs, settings. The preload exposes a fixed list of IPC channels as `window.kenku`.

## Player view

`src/player` (entry `src/player/renderer.ts`, preload `src/player/preload.ts`). The built-in music player, loaded into a tab like a website. Playlists and soundboards live in Redux slices under `src/player/features`; audio plays with Howler (`soundboards/Sound.ts`, `playlists/usePlaylistPlayback.ts`). Folder and file import: `src/player/common/useFolderDrop.ts`, `useFileDrop.ts`. Its preload exposes `window.player`.

## Capture window

`src/audioCapture` with `src/preload/managers/AudioCaptureManagerPreload.ts` and `PCMStream.worklet.js`. A hidden window that captures each tab's audio (and optional OS inputs) with `getUserMedia`, mixes it in a Web Audio context and streams PCM to the main process. It runs without the Chromium sandbox so the preload can use a worker (backlog SEC-12).

## Remote API

`src/main/remote` registers fastify routes on the server that `PlayerManager` starts when Remote is enabled in Settings: `/v1/playlist`, `/v1/playlist/play`, `/v1/playlist/playback`, `/v1/soundboard`, `/v1/soundboard/play`, `/v1/soundboard/stop`, `/v1/soundboard/playback`. Routes forward commands to the player view over IPC. Used by the Stream Deck plugin. No authentication yet (backlog SEC-4).

## Data storage

Everything lives in one folder, `<appData>/cue-desk` (`%APPDATA%\cue-desk` on Windows), fixed in `appIdentity.json` so renaming the app does not move it.

| What | Where | Written by |
| --- | --- | --- |
| Bookmarks, settings, Discord token (`persist:root`) | `Local Storage/leveldb` | `src/renderer/app/store.ts` (redux-persist) |
| Playlists and soundboards (`persist:player`), playback state (`persist:playback`) | `Local Storage/leveldb` | `src/player/app/store.ts` |
| Window position | `config.json` | `src/bounds.ts` |
| Website tab cookies and storage | `Partitions/tabs` | Chromium (`persist:tabs` session) |
| Kenku FM carry-over record (folder and item names only; written once the copy succeeded or was not needed) | `data-carry-over.json` | `src/main/migration` |

The app's own pages load from `file://` (packaged) so they share one localStorage origin; websites in tabs keep their data apart in `persist:tabs`. Audio files are not copied; tracks store their file paths. The bot token is stored in plain text for now (backlog SEC-5).
