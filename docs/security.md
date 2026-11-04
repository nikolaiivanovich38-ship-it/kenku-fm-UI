# Security in Cue Desk

## In plain language

Cue Desk opens websites (YouTube, Tabletop Audio, Spotify and so on) in tabs inside the app. Those websites are run by other people, so Cue Desk keeps them apart from its own pages and gives them as little access as possible.

**What a tab can open.** Only ordinary web pages, meaning addresses that start with `https://` or `http://`. If you type `youtube.com`, Cue Desk adds `https://` for you. Cue Desk will not open files on your computer (`file:`), browser settings pages, scripts typed into the address bar (`javascript:`) or links that launch other programs (`steam:`, `spotify:`, `mailto:` and similar). An address with a user name or password in it (`https://name:password@site`) is also refused; log in on the page instead. When an address is refused, Cue Desk shows a short message under the address bar or the bookmark's address field explaining why, and nothing is opened.

`http://` pages still open, but they are not encrypted; the address bar shows "Not secure" next to them. Prefer `https://` when a site offers it.

**Pop-ups.** When a website opens a new window, Cue Desk opens it as a new tab instead, but only if the address is allowed, and at most 3 new tabs from the same tab every 10 seconds. Anything beyond that is ignored.

**Microphone, camera and other permissions.** Websites in tabs are refused, without being asked, if they try to use your microphone or camera, show notifications, see your location, or open other programs. They can still go full screen. Cue Desk's own pages may use audio devices only, which they need to send sound to Discord and to list your input devices.

**Logins.** Websites in tabs keep their own cookies and logins, separate from Cue Desk's settings. Website logins are not carried over from Kenku FM, so you will need to log in to websites in tabs again once. "Clear cache" in Settings now clears website data as well.

**Links to help pages.** Links in Cue Desk (for example "Where do I get my token?") open in your normal web browser, but only if they are `https://` links. Other kinds of link are ignored.

**Your audio stays on your computer.** The connection that carries sound from tabs to Discord accepts connections from your own computer only, so other devices on your network cannot send audio into your Discord channel.

**Dragging files.** Dropping a file onto Cue Desk outside a drop zone does nothing, and the pointer shows that it cannot be dropped there. Dragging a link from a web page onto the address bar or a bookmark's address field puts the link's text in the field. Drop zones (adding tracks, sounds or images) work as before.

## Technical details

### Where the rules live

| Rule | File | Tests |
|---|---|---|
| Tab and external URL policy (SEC-6, SEC-10) | `src/common/security/urlPolicy.ts` | `urlPolicy.test.ts` |
| Permissions per page (SEC-3) | `src/main/security/permissions.ts` | `permissions.test.ts` |
| Which web contents are app pages (SEC-3) | `src/main/security/trustedContents.ts` | `trustedContents.test.ts` |
| Tab session partition name (SEC-3) | `src/main/security/partitions.ts` | `sessions.test.ts` |
| Session handlers, user agent, clear cache (SEC-3) | `src/main/security/sessions.ts` | `sessions.test.ts` |
| Navigation guards for app pages and tabs (SEC-6, SEC-7) | `src/main/security/navigationGuards.ts` | `navigationGuards.test.ts` |
| Player view recognition (SEC-3) | `src/main/security/viewKind.ts` | `viewKind.test.ts` |
| Popup rate limit (SEC-6) | `src/main/security/popupRateLimiter.ts` | `popupRateLimiter.test.ts` |
| External links from the main window (SEC-10) | `src/main/security/externalLinks.ts` | `externalLinks.test.ts`, `src/index.test.ts` |
| Loopback audio socket (SEC-2) | `src/common/security/loopback.ts`, `AudioCaptureManagerMain.ts` | `loopback.test.ts`, `AudioCaptureManagerMain.test.ts` |
| Document drop guard (SEC-7) | `src/common/security/dragGuard.ts` | `dragGuard.test.ts` |

The policy modules import nothing from Electron, so they are unit-tested directly. The Electron wiring is thin and tested with `vi.mock("electron")`.

### URL policy

`checkTabUrl(raw)` parses with the WHATWG `URL` parser (so case, surrounding whitespace, embedded tabs/newlines and IDN hosts are normalised exactly as Chromium does) and returns `{ ok: true, url, insecure }` or `{ ok: false, code, reason }`. Allowed: `https:` and `http:` (`insecure: true`) with a non-empty host and no username or password. Everything else is refused, including `about:blank`, which the app does not rely on: a new empty tab is simply not loaded. `checkExternalUrl(raw)` allows `https:` only. `checkTypedTabUrl(raw)` removes Unicode format characters (`\p{Cf}`, such as zero-width spaces pasted with an address), then applies `prependHttp`, and is what the URL bar, the bookmark editor and opening a bookmark use (bookmarks carried over from Kenku FM may lack a scheme). `prependHttp` treats any leading `scheme:` (letters, digits, `+`, `.`, `-`, so `chrome-extension:` too) as a scheme for the policy to judge, except `host:port`. `MAX_URL_LENGTH` applies to both the input and the normalised `href`. The URL bar shows an accessible "Not secure" hint for `insecure` (http) pages. Use `isRefused(result)` to branch, because the project's `tsconfig` does not narrow on `ok`.

Enforced in the main process (`BrowserViewManagerMain`) on every path into a tab: view creation, `BROWSER_VIEW_LOAD_URL`, `setWindowOpenHandler` (popups become tabs only if allowed and within `POPUP_LIMIT`), and `will-navigate` / `will-redirect` on the tab's main frame. The renderer checks are for user feedback only; the main process is the boundary. Refusals from the main process are reported on the main window's `ERROR` channel; refusals found in the renderer (opening a bookmark) go to the same message box through `src/renderer/common/appErrors.ts`. A refused view request returns `REFUSED_VIEW_ID` (-1); renderer callers go through `openBrowserView`, which returns `undefined` for anything that is not a positive id, so -1 never reaches the tabs or player state (where -1 means "player not created yet").

### Permissions

`setPermissionRequestHandler` and `setPermissionCheckHandler` are installed on the default session and on the tab partition, and both call `isPermissionAllowed`. Deny by default.

| Caller | Allowed |
|---|---|
| Main window (`main-window`) | `media`, audio only (input device names for external inputs) |
| Audio capture window (`audio-capture`) | `media`, audio only (tab capture and external inputs) |
| Player view (`player-view`) | `clipboard-sanitized-write` (copy ids for Kenku Remote) |
| Any website tab | `fullscreen` |
| A page the app is capturing for Discord (the player view, website tabs) | `media` with no media types, from its top-level frame only (tab capture; see below) |
| Any embedded frame inside an app page (not its top-level frame) | nothing |

App pages are identified by web-contents id in `trustedContents`, registered by `lockAppPage` (main window in `src/index.ts`, capture window in `AudioCaptureManagerMain`) and by `BrowserViewManagerMain` for the player view. The main window asks for the player view by kind (`"player"`), and the main process chooses the player preload itself; any other preload is refused (`REFUSED_VIEW_ID`, -1).

**Tab capture (found in WP1).** Discord hears the player and website tabs through tab capture: the capture window calls `getUserMedia` with `chromeMediaSource: "tab"`, and Chromium raises that as a `media` request on the *captured* page, with an empty media-types list. A website asking for its own screen or desktop audio (`chromeMediaSource: "desktop"`, `getDisplayMedia`) raises the same request with empty media types too, so the media types alone prove nothing. What differs is `details.securityOrigin`: for tab capture it is the origin of the page that called `getUserMedia`, the capture window (`file:///` in a packaged build); for the website's own request it is the website's origin. `AudioCaptureManagerMain` names the capture window (`captureTargets.setCapturer`), adds the page to `captureTargets` (`src/main/security/captureTargets.ts`) just before it hands the capture window the page's media source id, and removes it when the stream stops, when all streams stop, or when the page is destroyed. The handler grants that one request only when the page is listed and the request comes from the capture window's origin (`isCaptureRequest`). Only website tabs and the player can be captured; the main window and the capture window are refused. Permission checks (which report a media type) never match. The WP1 review found the first version of this rule, which looked at the media types only, let a captured website record the whole screen without asking; `e2e/capture.spec.ts` now checks that a captured site gets `NotAllowedError` for screen and desktop-audio capture. `e2e/capture.spec.ts` covers the player and a local website tab; mediaKeySystem (DRM) is refused, since standard Electron has no Widevine.

Website tabs use the `persist:tabs` partition (`TAB_PARTITION`) with no preload. App pages use the default session. The Google sign-in user-agent workaround is applied to both sessions.

### Navigation guards

`lockAppPage` cancels `will-navigate` on the main window, capture window and player view unless only the `#fragment` changes, and denies every `window.open`. The main window passes `https` links to `shell.openExternal` through `openExternalIfAllowed`; the player view turns allowed links into new tabs. The renderer and player also install `installDocumentDropGuard(document)` so drops outside drop zones are cancelled and show the "no drop" cursor (`dropEffect = "none"`). Text and links dropped into a text field are left to the browser, which inserts them as text.

### How to change a rule

- **Allow another permission:** add it to `APP_PAGE_PERMISSIONS` or `TAB_PERMISSIONS` in `permissions.ts`, then update `EXPECTED` in `permissions.test.ts` and the table above.
- **Allow another URL scheme:** add it to `TAB_PROTOCOLS` or `EXTERNAL_PROTOCOLS` in `urlPolicy.ts` and add test cases. Think twice: anything other than web pages can read local files or launch programs.
- **Change the popup limit:** edit `POPUP_LIMIT` in `popupRateLimiter.ts`.
- **Rename the tab partition:** edit `TAB_PARTITION`. Every user is logged out of every website once.
- **Add a new app page with a preload:** call `lockAppPage(webContents, role)` before loading it and add the role to `AppPageRole`.

### Manual checks (cannot run in CI without a display)

1. Open a YouTube tab and play a video: it plays, and the sound reaches Discord.
2. Open a site that asks for the microphone (for example an online mic test): it is refused without a prompt.
3. Type `file:///` in the address bar: a message appears under the bar and nothing loads.
4. Tabs that were logged in before the update need logging in again once.
5. Settings > "Where do I get my token?" opens in the system browser.
6. Drop an audio file outside a drop zone: nothing happens. Drop it on "Add track": it is added.
7. From another computer on the same network, the audio socket port (shown with `netstat` or `lsof` on the Cue Desk process) refuses connections.

## Messages between the app's pages and the main process (SEC-8)

### In plain language

Cue Desk's own pages (the main window, the player and a hidden audio window) ask the main part of the app to do things: open a tab, join a Discord channel, start the remote control. Before WP1 the main part did whatever any page asked. Now it checks who is asking. A website in a tab, or something embedded inside one of Cue Desk's pages, is ignored. Requests with odd values (text where a number belongs, very long text) are ignored too. Nothing changes for you: Cue Desk's own pages ask in exactly the same way as before.

### How it works

`guardIpc(ipcMain)` (`src/main/security/ipcGuard.ts`) wraps `ipcMain.on` and `ipcMain.handle`. A message reaches its handler only when all of these hold:

1. The sending web contents is alive and registered in `trustedContents` with a role allowed for the channel in `IPC_CHANNELS` (`src/main/security/ipcChannels.ts`).
2. `event.senderFrame` is that web contents' main frame (not an iframe, and not a frame that has gone away).
3. The arguments pass the channel's checks (`src/main/security/ipcArgs.ts`): ids are safe integers, numbers are finite, booleans are booleans, text has a length limit, and there are no extra arguments.

A refused message is dropped and logged once per channel and reason. A refused `sendSync` gets a harmless answer (`""`, or `-1` for a view) so the sender is not left waiting; a refused `invoke` rejects. Each manager disposes of its guard in `destroy()`, which removes exactly the listeners it added.

Handlers also cope with ids that no longer exist: starting tab audio capture for a closed tab, registering an unknown view as the player, and leaving or disconnecting Discord without a bot all do nothing instead of throwing.

**Player view.** The main window used to pass the player's preload script path when it created the player view (WP0 then checked that path). It now passes the kind `"player"`, and the main process chooses the player preload itself (`classifyViewRequest` in `viewKind.ts`). A script path is always refused. `PLAYER_REGISTER_VIEW` only accepts a live view registered as the player, so a website tab can never receive remote control commands.

**src/index.ts.** `GET_VERSION`, `GET_PLATFORM` and `CLEAR_CACHE` are registered through `registerAppInfoIpc` (`src/main/security/appInfoIpc.ts`), so they go through the guard like every other channel.

### Channel table

"Main window" is `src/preload.ts` with `src/preload/managers/BrowserViewManagerPreload.ts`; "player" is `src/player/preload.ts`; "capture window" is `src/audioCapture/preload.ts` with `src/preload/managers/AudioCaptureManagerPreload.ts`. Website tabs have no preload and may send nothing. Keep this table and `IPC_CHANNELS` in step.

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `GET_VERSION`, `GET_PLATFORM` (sync) | Main window | none | `src/index.ts` (`appInfoIpc.ts`) |
| `CLEAR_CACHE` (invoke) | Main window | none | `src/index.ts` (`appInfoIpc.ts`) |
| `WINDOW_TOGGLE_MAXIMIZE`, `WINDOW_MINIMIZE`, `WINDOW_CLOSE` | Main window | none | `WindowManager` |
| `DISCORD_CONNECT` | Main window | token: text ≤ 4096 | `DiscordBroadcast` |
| `DISCORD_DISCONNECT` | Main window | none | `DiscordBroadcast` |
| `DISCORD_JOIN_CHANNEL`, `DISCORD_LEAVE_CHANNEL` | Main window | channel id: text ≤ 4096 | `DiscordBroadcast` |
| `BROWSER_VIEW_CREATE_BROWSER_VIEW` (sync) | Main window | url: text ≤ 2 MB or missing; x, y, width, height: finite numbers; kind: `"player"` or missing | `BrowserViewManagerMain` |
| `BROWSER_VIEW_REMOVE_BROWSER_VIEW`, `_HIDE_`, `_SHOW_`, `_GO_FORWARD`, `_GO_BACK`, `_RELOAD` | Main window | view id: integer | `BrowserViewManagerMain` |
| `BROWSER_VIEW_REMOVE_ALL_BROWSER_VIEWS` | Main window | none | `BrowserViewManagerMain` |
| `BROWSER_VIEW_SET_BROWSER_VIEW_BOUNDS` | Main window | view id: integer; x, y, width, height: finite numbers | `BrowserViewManagerMain` |
| `BROWSER_VIEW_LOAD_URL` | Main window | view id: integer; url: text ≤ 2 MB | `BrowserViewManagerMain` |
| `PLAYER_GET_URL` (sync) | Main window | none | `PlayerManager` |
| `PLAYER_REGISTER_VIEW` | Main window | view id: integer (must be the trusted player view) | `PlayerManager` |
| `PLAYER_START_REMOTE` | Main window | address, port: text ≤ 4096 | `PlayerManager` |
| `PLAYER_STOP_REMOTE` | Main window | none | `PlayerManager` |
| `AUDIO_CAPTURE_START` | Main window | streaming mode: `"lowLatency"`, `"performance"` or missing | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_SET_LOOPBACK` | Main window | boolean | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_SET_MUTED` | Main window | view id: integer; muted: boolean | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE`, `_STOP_EXTERNAL_AUDIO_CAPTURE` | Main window | device id: text ≤ 4096 | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM`, `_STOP_BROWSER_VIEW_STREAM` | Main window | view id: integer | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS` | Main window | none | `AudioCaptureManagerMain` (new in WP1: before, nothing handled it and tab audio kept being captured) |
| `AUDIO_CAPTURE_STREAM_START` | Capture window | channels 1–32, frame size 1–1048576, sample rate 1–384000: integers | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_STREAM_END` | Capture window | none (not sent today) | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS` (invoke) | Capture window | none | `AudioCaptureManagerMain` |
| `PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY`, `_PLAYLIST_PLAYBACK_REPLY`, `_SOUNDBOARD_GET_ALL_REPLY`, `_SOUNDBOARD_PLAYBACK_REPLY` | Player | reply: object; request id: integer ≥ 1 | `src/main/remote/playerRequests.ts` |

### How to add a channel

Add it to `IPC_CHANNELS` with the page(s) that send it and an argument check, register it with the manager's guard (`this.ipc.on(...)`), and add a row above. The type of `guardIpc().on` only accepts channels listed in `IPC_CHANNELS`, so forgetting the first step is a compile error.

## Remote API replies (PERF-9)

The remote API's GET routes (`/v1/playlist`, `/v1/playlist/playback`, `/v1/soundboard`, `/v1/soundboard/playback`) ask the player for its state through `PlayerRequests` (`src/main/remote/playerRequests.ts`). Each request gets a number that the player sends back with its answer, so several requests at once (for example Stream Deck buttons refreshing together) each get their own answer. One listener per reply channel serves every request, and a request that is not answered within 5 seconds is forgotten, so listeners no longer pile up. The HTTP responses are unchanged; `src/main/remote/remote.test.ts` checks their status codes, bodies and content type with `fastify.inject()`. If the player view disappears just as a request is sent, the request fails at once with the usual 408 answer.

## Content-Security-Policy (SEC-11)

### In plain language

Each of Cue Desk's own pages now tells the built-in browser exactly what it is allowed to load. If a bug ever let someone slip code into one of these pages, the browser would refuse to run it or to send data anywhere unexpected. You should not notice any difference.

### The policy

Set with `<meta http-equiv="Content-Security-Policy">` as the first tag after `charset` in each page template. `frame-ancestors` cannot be set from a meta tag and is not needed (these pages are never framed).

| Directive | Main window (`src/index.html`) | Player (`src/player/index.html`) | Capture window (`src/audioCapture/index.html`) |
|---|---|---|---|
| `default-src` | `'none'` | `'none'` | `'none'` |
| `script-src` | `'self'` | `'self'` | `'self' blob:` |
| `style-src` | `'self' 'unsafe-inline'` | `'self' 'unsafe-inline'` | `'self'` |
| `img-src` | `'self' data: blob: file: https: http:` | `'self' data: blob: file: https: http:` | `'none'` |
| `font-src` | `'self' data:` | `'self' data:` | `'none'` |
| `media-src` | `'none'` | `'self' data: blob: file: https: http:` | `'self' blob:` |
| `connect-src` | `'self'` | `'self' data: blob: file: https: http:` | `'self' ws://127.0.0.1:*` |
| `worker-src` | `'none'` | `'none'` | `'none'` |
| `object-src`, `base-uri`, `form-action`, `frame-src` | `'none'` | `'none'` | `'none'` |

Why each allowance is there:

- **`script-src 'self'`**: only the webpack bundles next to the page. Production builds use `source-map`, so no `eval` is needed. No page has inline scripts or inline event handlers.
- **`style-src 'unsafe-inline'`** (main window, player): MUI's styling engine (emotion) and webpack's style-loader insert `<style>` tags at run time. Removing it would need a per-load nonce threaded through emotion's cache; not worth the risk while styles cannot run code.
- **Images** (main window): tab favicons and bookmark icons come from whatever site is open (`https:`, `http:` or `data:`), Discord server icons come from `https://cdn.discordapp.com`, and the app's own icons are bundled files. **Images** (player): backgrounds are bundled files, files on your computer (`file:`) or web addresses you type (`https:`/`http:`).
- **Media and connect** (player): tracks and sounds can be files on your computer or web addresses. Playlists play through HTML audio (`media-src`); soundboard sounds without a fade-out are downloaded by Howler with XMLHttpRequest and played with Web Audio (`connect-src`). Howler also uses a tiny built-in `data:audio/wav` clip to unlock audio. `http:` stays allowed because tracks, sounds and backgrounds added with `http://` addresses worked before.
- **Capture window**: `script-src blob:` is for the PCM audio worklet, which webpack's `worklet-loader` (`inline: true`) turns into a `blob:` URL; `connect-src ws://127.0.0.1:*` is the loopback audio socket (SEC-2, random port). `media-src blob:` covers the local loopback audio element.

**Development builds.** The templates are evaluated by html-webpack-plugin with `webpackConfig.mode`. In `development` (`yarn start`) they add `'unsafe-eval'` to `script-src` (forge uses `eval-source-map` for renderers in development) and `ws://localhost:*` to `connect-src` (webpack-dev-server live reload). Packaged builds are `production` and get neither. Forge's own dev-server CSP header is switched off in `forge.config.js` (`devContentSecurityPolicy: ""`), so the meta tag is the only policy in both modes.

`src/main/security/appPageCsp.test.ts` evaluates the three templates in both modes and compares every directive with the table above, so changing a page's policy means changing that test and this table too.

## Audio capture window sandbox (SEC-12)

The hidden capture window used to run with `sandbox: false` so that its preload could start a web worker. That worker was removed upstream when capture moved to an AudioWorklet. The capture preload now needs only `ipcRenderer` (available to sandboxed preloads) and browser APIs (`AudioContext`, `getUserMedia`, `WebSocket`); everything else it imports is bundled by webpack, and forge already builds every preload in this app for the sandbox. The window therefore runs with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`, like the other app pages.

Stopping a tab's or an input device's capture now also disconnects its audio nodes (PERF-5), so they no longer accumulate in the capture window's audio graph.

## Manual checks for WP1 (need a display)

Run the packaged app (or `yarn start` for the development policy) with DevTools open on each page (main window: View > Toggle Developer Tools; player and capture window: from the main process with `webContents.openDevTools()`), and confirm there are **no "Refused to …" Content-Security-Policy messages and no "Ignored a … message" warnings in the terminal** while doing each of these:

1. Start the app: the main window and the player tab appear and work.
2. Open the player and play a local track from a playlist, then a soundboard sound with and without a fade-out.
3. Add a background image from a file and from an `https://` address.
4. Open Settings, connect the Discord bot: the server icons show next to the server names.
5. Join a voice channel and play a YouTube tab: the sound reaches Discord (capture window: worklet loads, socket connects, sandboxed preload runs).
6. Turn an external input on and off several times; close and reopen a tab that plays sound several times. Audio keeps working.
7. With the remote enabled, call `GET /v1/playlist/playback` from two clients at the same time (or press two Stream Deck buttons together): both get an answer; with the player tab closed, requests return 503 as before.
8. Trigger the error screen (or call `window.kenku.removeAllBrowserViews()` from the main window's DevTools): tab audio stops being sent to Discord.

## Kenku FM backgrounds

### In plain language

When Cue Desk starts, it looks for Kenku FM installed on your computer and copies Kenku FM's background pictures into Cue Desk's own data folder, so playlists and soundboards made in Kenku FM show their pictures again. It only reads Kenku FM's program folder and only writes to the `backgrounds` folder inside Cue Desk's data folder. It never changes or deletes anything, never replaces a picture that is already there, and downloads nothing. The pictures stay on your computer and are not part of Cue Desk's installer.

### What is read and written

| What | Where | Rules |
|---|---|---|
| Folder names | `%LOCALAPPDATA%` (top level), `kenku-fm*` folders in it, their `app-x.y.z\resources` folders | Listing only. Only Windows is searched. |
| Kenku FM's player bundle | `…\resources\app\.webpack\renderer\player_window\index.js`, or the same path inside `app.asar` (Electron's main process reads inside asar archives) | At most 64 MB, read as text and searched with regular expressions; nothing in it is run. |
| Pictures | files named in that bundle, directly in `.webpack\renderer` | Names in the bundle must be plain file names (no slashes, no `..`), files must be `<letters, digits, _ or ->.<jpg, jpeg, png, webp or svg>`, at most 20 MB, not empty. |
| Copies | `<userData>\backgrounds\<name>.<ext>` | Written as a hidden `.part` file, then renamed. Skipped when any picture with that name is already there. |

An install packed in `app.asar` is read with plain file reads (`original-fs`, `src/main/legacyBackgrounds/asarArchive.ts`), each file opened and closed at once: Electron's own asar support keeps an archive open for the whole session, which on Windows would block Kenku FM's updates and uninstall. Limits, because the bundle and pictures come from another app's folder: the bundle is read only up to 16 MB and parsed in single passes with bounded patterns (time grows with its size, whatever it contains); at most 100 pictures, each up to 20 MB and 200 MB together per start; links are not followed; files are written with exclusive-create flags, so an existing picture is never replaced.

Test builds read `CUE_DESK_LOCAL_APP_DATA_DIR` instead of `%LOCALAPPDATA%` (end-to-end tests); release builds ignore it (`__CUE_DESK_TEST_BUILD__` is false there).

### Channel

Add to the SEC-8 channel table (kept here so branches merge cleanly):

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `PLAYER_GET_BACKGROUNDS` (sync) | Player | none | `src/main/legacyBackgrounds/index.ts` |

The answer is `{ name: file:// address }` for the pictures in `<userData>/backgrounds` only (built with `url.pathToFileURL`, so spaces and quotes are percent-encoded and the address is safe inside CSS `url("…")`). A refused message gets `{}`, and the player shows its blank background. The answer waits for the start-up copy, at most 5 seconds; that blocks the player page, not the main window.

Content-Security-Policy: no change. The player's `img-src` already allows `file:`, which custom backgrounds from disk use; the built-in pictures used to be bundled files (`'self'`) and are now `file:` addresses in the data folder. In development (`yarn start`) the player loads from `http://localhost`, and Chromium does not show `file:` pictures on such a page, so built-in backgrounds show only in packaged builds, like custom backgrounds from disk.

### Tests

`kenkuInstall.test.ts` (name map parsing with refused names and files, install search, the test-folder gate), `backgroundFiles.test.ts` (copying with temporary folders: never overwrite, never delete, size and type limits; listing), `index.test.ts` in the same folder (the channel answers the player only, waits for the copy, refuses arguments and other pages), `src/player/backgrounds/index.test.ts`, and `e2e/backgrounds.spec.ts`.

### Manual checks (Windows, with Kenku FM installed)

1. Start Cue Desk. Open a playlist or soundboard brought over from Kenku FM: its picture shows.
2. Add a playlist: the picture choices are Kenku FM's (autumn, beach, … winter).
3. Open `%APPDATA%\cue-desk\backgrounds`: 23 `.jpg` files. Replace one with a picture of your own under the same name and restart: yours stays.
4. On a computer without Kenku FM: Cue Desk starts normally and backgrounds are blank.


## WP4 Engine core

The new playback engine (`src/player/engine`, design in `docs/playback-engine.md`) adds no IPC channel, no permission and no Content-Security-Policy change. It runs in the player page and reads audio files the way the player already does: `<audio>` elements for streaming (`media-src file: https: http:`) and `XMLHttpRequest` for small files to decode (`connect-src file: https: http:`; Chromium's `fetch()` refuses `file://`).

**Preview and whisper must not reach the broadcast.** Tab capture records everything the player page plays through its audio context's speakers (`AudioCaptureManagerPreload.ts`, `chromeMediaSource: "tab"`). The engine therefore never connects its outputs itself: only the table output may be connected to the context's speakers in the captured player page. PRV-1 must play the preview output from a context or page that is not captured, and OUT-5 must take the whisper output as its own stream, before either is offered to users.

**Test-build hook.** `src/player/renderer.ts` installs `window.__cueDeskEngineTest` (`src/player/engine/testHook.ts`) only when `__CUE_DESK_TEST_BUILD__` is true. `webpack.renderer.config.js` now defines that constant (as `webpack.main.config.js` already did), so release builds compile the branch and the module out; checked by building a release package and searching `player_window/index.js` for `__cueDeskEngineTest` (no match). The hook plays files named by the test and listens to the outputs; it has no IPC and is only reachable from the page itself.

## WP2 Tabs

### In plain language

**Files from your computer (SEC-15).** You can open a file from your computer in a tab, for example a map or a page of notes saved as HTML: type its address (`file:///C:/Maps/dungeon.html`) or paste its path (`C:\Maps\dungeon.html`) into the address bar, or open a bookmark to it. Cue Desk then asks "Open this file from your computer?" and shows the full path. Choose Open or Cancel (Cancel is the default). If you tick "Don't ask again for files in …", files in that folder open straight away from then on; Settings > Local files lists those folders, and the cross next to one makes Cue Desk ask again. Files in a shared network folder (`\\server\share`) are never opened.

Only you can open a file. A website cannot open, link to, redirect to or pop up a file from your computer. A file opens in a tab of its own, kept apart from websites, with no more permissions than a website. If the file links to a web page, the web page opens in a new website tab; links to other files do nothing.

**Your own windows cannot record the screen (SEC-16).** Cue Desk's own windows may use your audio devices, but nothing can use them to record your screen.

### Technical details

**Local files (SEC-15).** `urlPolicy.ts` stays the one place that decides. `checkTabUrl` (popups, `will-navigate`, `will-redirect`, `BROWSER_VIEW_LOAD_URL`, view creation) still allows web pages only. `checkTypedTabUrl` (address bar, bookmark editor, opening a bookmark) returns a third kind of result, `{ ok: "ask", kind: "local-file", url }` (`isLocalFile`), for a file address or a pasted Windows (`C:\…`) or absolute (`/…`) path. `checkLocalFileUrl` refuses a host (`file://server/…`, code `network-file`), a UNC path (`file:////server/…`) and encoded separators (`%2F`, `%5C`). The renderer sends such an address on `BROWSER_VIEW_OPEN_LOCAL_FILE`; the main process re-checks it (`LocalFileGate` in `src/main/security/localFiles.ts`), converts it with `fileURLToPath`, and unless the file is inside a remembered folder shows `dialog.showMessageBox` on the main window (Open / Cancel, Cancel default, checkbox "Don't ask again for files in <folder>"). The answer never comes from a page. Remembered folders (never a drive root) are saved by the main process in `local-files.json` in the data folder (`localFileStore.ts`, opened on first use). A file opens in a new `WebContentsView` in `LOCAL_FILE_PARTITION` (`persist:local-files`), with no preload and the same permission handlers as website tabs (role `null`: `fullscreen` only), cleared by "Clear cache". `guardLocalFileTab` cancels every cross-document navigation and main-frame redirect in a file's tab; http(s) links and popups go through the popup rate limiter to a new website tab, anything else is dropped. `BROWSER_VIEW_LOAD_URL` is refused for a file's tab, so files and websites never share a tab: the renderer opens the other kind in a new view that takes the old tab's place (`replaceTab`).

**App pages and screen capture (SEC-16).** Probe on Electron 44 under xvfb (WP2): `getUserMedia({ audio: { deviceId } })` from an app page, with a plain or `exact` deviceId, reaches the permission request handler as `mediaTypes: ["audio"]`; `chromeMediaSource: "desktop"` (screen capture) arrives as `[]`. `isPermissionAllowed` therefore refuses an empty list for `main-window` and `audio-capture` (a permission check without a media type, `undefined`, is still allowed for device enumeration). Tab capture is unaffected: it is raised on the captured page and decided by `captureTargets.isCaptureRequest` first. `e2e/screenCapture.spec.ts` checks both windows get `NotAllowedError`.

**Hidden tabs (PERF-5).** Because every website tab is captured for Discord, Chromium keeps a hidden tab "visible" and Page Lifecycle freezing has no effect on it (probed). `TabSleep` (`src/main/managers/tabSleep.ts`) marks a website or file tab that has been hidden, silent (`audio-state-changed`) and without playing media (`media-started-playing` / `media-paused`) for 60 seconds; `BrowserViewManagerMain` then attaches `webContents.debugger` and sends `Emulation.setCPUThrottlingRate { rate: 10 }`, and on showing the tab or when it makes sound sends rate 1 and detaches. The player view is never slowed. Test builds read `CUE_DESK_TAB_SLEEP_MS`.

| Rule | File | Tests |
|---|---|---|
| Local-file confirmation and remembered folders (SEC-15) | `src/main/security/localFiles.ts`, `localFileStore.ts` | `localFiles.test.ts`, `BrowserViewManagerMain.test.ts`, `e2e/localFiles.spec.ts` |
| Local-file tab partition (SEC-15) | `src/main/security/partitions.ts`, `sessions.ts` | `sessions.test.ts` |
| Local-file tab navigation guard (SEC-15) | `src/main/security/navigationGuards.ts` (`guardLocalFileTab`) | `navigationGuards.test.ts` |
| App pages: no screen capture (SEC-16) | `src/main/security/permissions.ts` | `permissions.test.ts`, `sessions.test.ts`, `e2e/screenCapture.spec.ts` |

### Channels

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `BROWSER_VIEW_OPEN_LOCAL_FILE` (invoke) | Main window | url: text ≤ 2 MB; x, y, width, height: finite numbers. Answers the view id, or -1 when the address is not a local file or the user said no | `BrowserViewManagerMain` |
| `LOCAL_FILES_LIST_FOLDERS` (invoke) | Main window | none. Answers the remembered folders | `BrowserViewManagerMain` |
| `LOCAL_FILES_FORGET_FOLDER` (invoke) | Main window | folder: text ≤ 32767. Answers the folders still remembered | `BrowserViewManagerMain` |

### Manual checks (Windows)

1. Save a small `.html` file in a folder, paste its path (for example `C:\Users\you\Documents\map.html`) into the address bar of a tab and press Enter: "Open this file from your computer?" appears with the full path. Cancel: nothing opens. Again, Open: the file opens in the tab.
2. Open it once more and tick "Don't ask again…": later files in that folder open without the question. Settings > Local files lists the folder; click the cross: the question comes back.
3. Type `\\anyserver\share\x.html`: a message says network folders are not opened.
4. Open YouTube in a tab, start a video, switch to another tab and wait two minutes: the sound keeps reaching Discord. Leave a silent website tab in the background for a few minutes, then switch to it: it works normally.
5. With an external input switched on (Settings > External Inputs), the input still reaches Discord.
