# Security in Cue Desk

## In plain language

Cue Desk opens websites (YouTube, Tabletop Audio, Spotify and so on) in tabs inside the app. Those websites are run by other people, so Cue Desk keeps them apart from its own pages and gives them as little access as possible.

**What a tab can open.** Only ordinary web pages, meaning addresses that start with `https://` or `http://`. If you type `youtube.com`, Cue Desk adds `https://` for you. Cue Desk will not open files on your computer (`file:`), browser settings pages, scripts typed into the address bar (`javascript:`) or links that launch other programs (`steam:`, `spotify:`, `mailto:` and similar). An address with a user name or password in it (`https://name:password@site`) is also refused; log in on the page instead. When an address is refused, Cue Desk shows a short message under the address bar or the bookmark's address field explaining why, and nothing is opened.

`http://` pages still open, but they are not encrypted; the address bar shows "Not secure" next to them. Prefer `https://` when a site offers it.

**Pop-ups.** When a website opens a new window, Cue Desk opens it as a new tab instead, but only if the address is allowed, and at most 3 new tabs from the same tab every 10 seconds. Anything beyond that is ignored.

**Microphone, camera and other permissions.** Websites in tabs are refused, without being asked, if they try to use your microphone or camera, show notifications, see your location, or open other programs. They can still go full screen. Cue Desk's own pages may use audio devices only, which they need to send sound to Discord and to list your input devices.

**Logins.** Websites in tabs keep their own cookies and logins, separate from Cue Desk's settings. Website logins are not carried over from Kenku FM, so you will need to log in to websites in tabs again once. "Clear cache" in Settings now clears website data as well.

**Links to help pages.** Links in Cue Desk (for example "Where do I get my token?") open in your normal web browser, but only if they are `https://` links. Other kinds of link are ignored.

**Your audio stays on your computer.** Sound travels from tabs to Discord over a private channel inside Cue Desk; there is no network connection for it at all, so nothing else on your computer or network can send audio into your Discord channel.

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
| Private audio channel from the capture window (SEC-2, WP2) | `AudioCaptureManagerMain.ts` (`MessageChannelMain`), `src/audioCapture/preload.ts` | `AudioCaptureManagerMain.test.ts` |
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
7. While broadcasting, Cue Desk has no listening network port for audio (`netstat -ano` on Windows, `lsof -i -P` elsewhere, shows only the remote API port when Remote is on).

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
| `BROWSER_VIEW_CREATE_BROWSER_VIEW` (sync) | Main window | url: text ≤ 2 MB or missing; x, y, width, height: finite numbers; kind: `"player"` or missing | `BrowserViewManagerMain` |
| `BROWSER_VIEW_REMOVE_BROWSER_VIEW`, `_HIDE_`, `_SHOW_`, `_GO_FORWARD`, `_GO_BACK`, `_RELOAD` | Main window | view id: integer | `BrowserViewManagerMain` |
| `BROWSER_VIEW_REMOVE_ALL_BROWSER_VIEWS` | Main window | none | `BrowserViewManagerMain` |
| `BROWSER_VIEW_SET_BROWSER_VIEW_BOUNDS` | Main window | view id: integer; x, y, width, height: finite numbers | `BrowserViewManagerMain` |
| `BROWSER_VIEW_LOAD_URL` | Main window | view id: integer; url: text ≤ 2 MB | `BrowserViewManagerMain` |
| `PLAYER_GET_URL` (sync) | Main window | none | `PlayerManager` |
| `PLAYER_REGISTER_VIEW` | Main window | view id: integer (must be the trusted player view) | `PlayerManager` |
| `PLAYER_START_REMOTE` | Main window | address, port: text ≤ 4096 | `PlayerManager` |
| `PLAYER_STOP_REMOTE` | Main window | none | `PlayerManager` |
| `AUDIO_CAPTURE_SET_MUTED` | Main window | view id: integer; muted: boolean | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE`, `_STOP_EXTERNAL_AUDIO_CAPTURE` | Main window | device id: text ≤ 4096 | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM`, `_STOP_BROWSER_VIEW_STREAM` | Main window | view id: integer (offers a loaded view for capture / withdraws it; see WP2 below) | `AudioCaptureManagerMain` |
| `AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS` | Main window | none | `AudioCaptureManagerMain` (new in WP1: before, nothing handled it and tab audio kept being captured) |
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
| `connect-src` | `'self'` | `'self' data: blob: file: https: http:` | `'self'` |
| `worker-src` | `'none'` | `'none'` | `'none'` |
| `object-src`, `base-uri`, `form-action`, `frame-src` | `'none'` | `'none'` | `'none'` |

Why each allowance is there:

- **`script-src 'self'`**: only the webpack bundles next to the page. Production builds use `source-map`, so no `eval` is needed. No page has inline scripts or inline event handlers.
- **`style-src 'unsafe-inline'`** (main window, player): MUI's styling engine (emotion) and webpack's style-loader insert `<style>` tags at run time. Removing it would need a per-load nonce threaded through emotion's cache; not worth the risk while styles cannot run code.
- **Images** (main window): tab favicons and bookmark icons come from whatever site is open (`https:`, `http:` or `data:`), Discord server icons come from `https://cdn.discordapp.com`, and the app's own icons are bundled files. **Images** (player): backgrounds are bundled files, files on your computer (`file:`) or web addresses you type (`https:`/`http:`).
- **Media and connect** (player): tracks and sounds can be files on your computer or web addresses. Playlists play through HTML audio (`media-src`); soundboard sounds without a fade-out are downloaded by Howler with XMLHttpRequest and played with Web Audio (`connect-src`). Howler also uses a tiny built-in `data:audio/wav` clip to unlock audio. `http:` stays allowed because tracks, sounds and backgrounds added with `http://` addresses worked before.
- **Capture window**: `script-src blob:` is for the PCM audio worklet, which webpack's `worklet-loader` (`inline: true`) turns into a `blob:` URL. Audio leaves the window over a private message channel (SEC-2, WP2), so `connect-src` allows no network address. `media-src blob:` covers the local loopback audio element.

**Development builds.** The templates are evaluated by html-webpack-plugin with `webpackConfig.mode`. In `development` (`yarn start`) they add `'unsafe-eval'` to `script-src` (forge uses `eval-source-map` for renderers in development) and `ws://localhost:*` to `connect-src` (webpack-dev-server live reload). Packaged builds are `production` and get neither. Forge's own dev-server CSP header is switched off in `forge.config.js` (`devContentSecurityPolicy: ""`), so the meta tag is the only policy in both modes.

`src/main/security/appPageCsp.test.ts` evaluates the three templates in both modes and compares every directive with the table above, so changing a page's policy means changing that test and this table too.

## Audio capture window sandbox (SEC-12)

The hidden capture window used to run with `sandbox: false` so that its preload could start a web worker. That worker was removed upstream when capture moved to an AudioWorklet. The capture preload now needs only `ipcRenderer` (available to sandboxed preloads) and browser APIs (`AudioContext`, `getUserMedia`, `AudioEncoder`, `MessagePort`); everything else it imports is bundled by webpack, and forge already builds every preload in this app for the sandbox. The window therefore runs with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`, like the other app pages.

Stopping a tab's or an input device's capture now also disconnects its audio nodes (PERF-5), so they no longer accumulate in the capture window's audio graph.

## Manual checks for WP1 (need a display)

Run the packaged app (or `yarn start` for the development policy) with DevTools open on each page (main window: View > Toggle Developer Tools; player and capture window: from the main process with `webContents.openDevTools()`), and confirm there are **no "Refused to …" Content-Security-Policy messages and no "Ignored a … message" warnings in the terminal** while doing each of these:

1. Start the app: the main window and the player tab appear and work.
2. Open the player and play a local track from a playlist, then a soundboard sound with and without a fade-out.
3. Add a background image from a file and from an `https://` address.
4. Open Settings, connect the Discord bot: the server icons show next to the server names.
5. Join a voice channel and play a YouTube tab: the sound reaches Discord (capture window: worklet loads, the audio channel works, sandboxed preload runs).
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

**Files from your computer (SEC-15).** You can open a file from your computer in a tab, for example a map or a page of notes saved as HTML: type its address (`file:///C:/Maps/dungeon.html`) or paste its path (`C:\Maps\dungeon.html`) into the address bar, or open a bookmark to it. Cue Desk then asks "Open this file from your computer?" and shows the full path. Choose Open or Cancel (Cancel is the default). If you tick "Don't ask again for files in … and its subfolders", files in that folder and its subfolders open straight away from then on; Settings > Local files lists those folders, and the cross next to one makes Cue Desk ask again. Files in a shared network folder (`\\server\share`) are never opened.

Only you can open a file. A website cannot open, link to, redirect to or pop up a file from your computer. A file opens in a tab of its own, kept apart from websites, with no more permissions than a website; it can read the other files in its own folder and subfolders only, and cannot reach the web (see "WP1 security fixes" below). If the file links to a web page, the web page opens in a new website tab; links to other files do nothing.

**Your own windows cannot record the screen (SEC-16).** Cue Desk's own windows may use your audio devices, but nothing can use them to record your screen.

### Technical details

**Local files (SEC-15).** `urlPolicy.ts` stays the one place that decides. `checkTabUrl` (popups, `will-navigate`, `will-redirect`, `BROWSER_VIEW_LOAD_URL`, view creation) still allows web pages only. `checkTypedTabUrl` (address bar, bookmark editor, opening a bookmark) returns a third kind of result, `{ ok: "ask", kind: "local-file", url }` (`isLocalFile`), for a file address or a pasted Windows (`C:\…`) or absolute (`/…`) path. `checkLocalFileUrl` refuses a host (`file://server/…`, code `network-file`), a UNC path (`file:////server/…`) and encoded separators (`%2F`, `%5C`). The renderer sends such an address on `BROWSER_VIEW_OPEN_LOCAL_FILE`; the main process re-checks it (`LocalFileGate` in `src/main/security/localFiles.ts`), converts it with `fileURLToPath`, and unless the file is inside a remembered folder shows `dialog.showMessageBox` on the main window (Open / Cancel, Cancel default, checkbox "Don't ask again for files in <folder> and its subfolders"). The answer never comes from a page. Remembered folders (never a drive root) are saved by the main process in `local-files.json` in the data folder (`localFileStore.ts`, opened on first use). A file opens in a new `WebContentsView` in `LOCAL_FILE_PARTITION` (`persist:local-files`), loaded from the `cue-local-file:` scheme rather than `file:` (see "WP1 security fixes"), with no preload and the same permission handlers as website tabs (role `null`: `fullscreen` only), cleared by "Clear cache". `guardLocalFileTab` cancels every cross-document navigation and main-frame redirect in a file's tab; http(s) links and popups go through the popup rate limiter to a new website tab, anything else is dropped. `BROWSER_VIEW_LOAD_URL` is refused for a file's tab, so files and websites never share a tab: the renderer opens the other kind in a new view that takes the old tab's place (`replaceTab`).

**App pages and screen capture (SEC-16).** Probe on Electron 44 under xvfb (WP2): `getUserMedia({ audio: { deviceId } })` from an app page, with a plain or `exact` deviceId, reaches the permission request handler as `mediaTypes: ["audio"]`; `chromeMediaSource: "desktop"` (screen capture) arrives as `[]`. `isPermissionAllowed` therefore refuses an empty list for `main-window` and `audio-capture` (a permission check without a media type, `undefined`, is still allowed for device enumeration). Tab capture is unaffected: it is raised on the captured page and decided by `captureTargets.isCaptureRequest` first. `e2e/screenCapture.spec.ts` checks both windows get `NotAllowedError`.

**Hidden tabs (PERF-5).** Removed after the WP1 security review; see "WP1 security fixes" below.

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

## WP2 Pipeline / Outputs and bots

### Capture only while broadcasting (PERF-4)

Tab audio is no longer recorded from the moment the app starts. The hidden capture window creates its audio context, worklet and Opus encoder only when the first output joins a Discord voice channel, and closes them when the last one leaves. While broadcasting, the main process asks for a view's audio only when Chromium reports the view audible (`audio-state-changed`) or an audio/video element starts (`media-started-playing`), and releases it after 30 seconds of silence (`SILENCE_HOLD_MS`). `captureTargets` follows the same rule, so a page is a capture target only while it is actually recorded; outside a broadcast no page can be tab-captured at all. Opus is encoded in the capture window with WebCodecs, so the main process only forwards packets; it accepts only binary packets of at most 4000 bytes and only while broadcasting.

A view that is not being recorded plays on this computer by itself, so its tab mute (`AUDIO_CAPTURE_SET_MUTED`) and "This Computer" being off are applied with `webContents.setAudioMuted`; muting a page does not mute its captured audio (checked in WP2).

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `AUDIO_CAPTURE_SET_STREAMING_MODE` | Main window | `"lowLatency"` or `"performance"` (replaces `AUDIO_CAPTURE_START`; applied when a broadcast starts) | `AudioCaptureManagerMain` |

### Fake Discord in test builds

`src/main/broadcast/discordDriver.ts` uses `src/main/broadcast/testing/fakeDiscord.ts` only when the package was built with `CUE_DESK_E2E_BUILD=1` (`__CUE_DESK_TEST_BUILD__`) and the app is started with `CUE_DESK_FAKE_DISCORD=1`. Release builds compile the branch and the module out.

### Private audio channel (SEC-2)

The capture window used to send audio to the main process over a WebSocket on `127.0.0.1` (a random port any local program could connect to). Now the main process creates a `MessageChannelMain` each time the capture window finishes loading, keeps one end and hands the other to that window only (`webContents.postMessage("AUDIO_CAPTURE_PORT", null, [port])`). There is no server, no port and no `connect-src` allowance; `AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS` and `src/common/security/loopback.ts` are gone. Each message must be one Opus packet (an `ArrayBuffer` or `Uint8Array` of 1 to 4000 bytes) or it is dropped; a reload of the capture window replaces the channel, so an old end goes dead. Packets are copied (about 300 bytes each), not transferred: Electron delivers a transferred `ArrayBuffer` to the main process as `null`. Latency is equal or better: from a tab's sound to the fake Discord in "Low Latency" mode, two interleaved runs (median of three each) took 136 and 127 ms over the WebSocket and 132 and 118 ms over the channel (`e2e/broadcast.spec.ts`).

### Discord bot tokens (SEC-5)

**In plain language.** Your bot token is like a password for your bot. Cue Desk used to save it as plain text with its other settings. Now it is saved encrypted with your computer's own password protection (Windows: your Windows account; macOS: the Keychain; Linux: the desktop keyring), in `discord-bots.json` in Cue Desk's data folder. Cue Desk's windows can check whether a bot has a token, give it a new one or remove it, but can never read it back. If your computer has no such protection (some Linux set-ups), Cue Desk keeps the token only until it closes and says so in Settings; it never writes it as plain text. A token saved by an older version is moved once, the first time this version starts, and removed from the old place.

**How.** `src/main/broadcast/botTokenStore.ts` encrypts each bot's token with `safeStorage.encryptString` and saves the list atomically (`discord-bots.json`, mode 0600). Linux's `basic_text` fallback encrypts with a fixed, public key, so it counts as no encryption: the token stays in memory (`canEncrypt`). `OutputManager` hands the store's tokens only to `DiscordBot.connect`; `OUTPUTS_STATE` carries `hasToken` and `tokenRemembered`, never the token. The redux-persist migration to version 5 (`src/renderer/features/settings/tokenMigration.ts`) sends the old `settings.discordToken` once over `BOT_IMPORT_LEGACY_TOKEN` (ignored if the first bot already has a token) and drops it, with the old `multipleOutputsEnabled`, from `persist:root`. Chromium's LevelDB may keep an overwritten value in its log file until it compacts it, so Settings recommends resetting a moved token (see "WP1 security fixes"); a token typed into this version never goes to browser storage at all (`e2e/outputs.spec.ts` scans the whole data folder).

### Outputs and bots (OUT-1, BUG-6, BUG-7)

`src/main/broadcast/OutputManager.ts` holds "This Computer" and any number of `DiscordBot`s (`DiscordBot.ts`), each with its own discord.js client, audio player and voice connections (joined with `group: <bot id>`, so two bots in one server do not share a connection). Every bot hears the same mix; each output can be muted. Joining reports every failure in plain language (channel gone, not joinable, no Ready within 15 s); leaving destroys the connection of any channel type, Stage channels included. The channels below replace `DISCORD_CONNECT`, `DISCORD_DISCONNECT`, `DISCORD_JOIN_CHANNEL`, `DISCORD_LEAVE_CHANNEL` and `AUDIO_CAPTURE_SET_LOOPBACK`. Bot ids are made by the main process (`bot-<uuid>`); the checks refuse anything else.

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `OUTPUTS_GET_STATE` (invoke) | Main window | none; answers the state without tokens | `OutputManager` |
| `OUTPUTS_CONNECT_SAVED` | Main window | none | `OutputManager` |
| `BOT_ADD` (invoke) | Main window | none; answers the new bot id | `OutputManager` |
| `BOT_REMOVE`, `BOT_REMOVE_TOKEN`, `BOT_CONNECT`, `BOT_DISCONNECT` | Main window | bot id (`bot-<uuid>`) | `OutputManager` |
| `BOT_SET_TOKEN` (invoke) | Main window | bot id; token: non-blank text ≤ 4096; answers whether it is remembered | `OutputManager` |
| `BOT_IMPORT_LEGACY_TOKEN` | Main window | token: non-blank text ≤ 4096 | `OutputManager` |
| `BOT_JOIN_CHANNEL`, `BOT_LEAVE_CHANNEL` | Main window | bot id; channel id: 1–25 digits | `DiscordBot` |
| `OUTPUT_SET_MUTED` | Main window | `"local"` or a bot id; boolean | `OutputManager` |
| `BOT_RECONNECT` (OUT-2) | Main window | bot id | `OutputManager` / `DiscordBot` |


### Manual checks for WP2 (real Discord, Windows)

1. Fresh start, nothing playing: Task Manager shows Cue Desk using almost no processor; no "Audio Capture" sound activity in the Windows volume mixer.
2. Update from 0.1 with a saved token: the bot connects by itself; Settings shows "A token is saved, encrypted on this computer"; `%APPDATA%\cue-desk\discord-bots.json` does not contain the token text.
3. Two bots (Settings > "Add a second bot"), both invited to one server: Bot 1 joins one voice channel, Bot 2 another; a friend in each channel hears the music; muting Bot 2 in the side bar silences only its channel.
4. Join a voice channel, play a soundboard sound: the first word or hit of the sound is not cut off in Discord.
5. "Lighter on the computer" and "Best sound quality": speech in a YouTube tab reaches Discord with no noticeable extra delay in either.
6. Unplug the network cable (or turn Wi-Fi off) for 10 seconds while in a channel: the chip shows "Reconnecting…", then "Connected" again without touching anything. Off for two minutes: "Error" with a reason and a Reconnect button that works once the network is back.
7. Remove the bot's Connect permission on a channel and click it: a plain message explains why; the bot does not hang on "Joining…".
8. Join a Stage channel, then click it again: the bot leaves the stage in Discord.

## WP1 security fixes

Fixes for the independent security review of wave 1 (findings 1 to 12).

### In plain language

- **Files from your computer stay in their folder.** A page you open from your computer (a handout, a map, a home-made soundboard) can show pictures, play sounds and load other pages from its own folder and the folders inside it. It cannot read anything else on your computer, cannot load anything from the internet and cannot show a website inside itself. Links to websites still open in a new website tab. A shortcut or link inside the folder that points somewhere else is refused too. The address bar still shows the file's own address (`file:///…`), and bookmarks to files work as before.
- **A file cannot record your screen.** Even while its sound is being sent to Discord.
- **"Don't ask again"** now says what it does: "Don't ask again for files in <folder> and its subfolders". A path such as `C:x.html` (no backslash after the drive letter) is refused, because it would depend on where Cue Desk happens to run.
- **A moderator's choice is respected.** If a moderator moves or disconnects the bot from a voice channel, Cue Desk no longer pulls it back. The bot's status shows "Left" and says "A moderator moved or disconnected the bot from …"; choose a channel to join again.
- **Short Discord outages no longer stop the broadcast.** While Cue Desk logs the bot in again by itself, it stays in its channels as "Reconnecting…" and "This Computer" stays as it was. Only if the attempts give up does the broadcast stop.
- **Old bot tokens.** Older versions saved the bot token unprotected. After moving it, Cue Desk shows a note in Settings, once, recommending that you reset the token in the Discord Developer Portal (your bot's Bot page, "Reset Token") and enter the new one, because a copy of the old one can stay in Cue Desk's storage files. If your computer has no secure place to save passwords, a message also says that the moved token lasts only until Cue Desk closes.

### Technical details

| Finding | Fix | Where |
|---|---|---|
| 1, 2 | Files load from `cue-local-file://<host>/<path>`. `registerLocalFileScheme` (called at the top of `src/index.ts`) declares it standard, secure, fetch and stream; it does not bypass CSP. Only `persist:local-files` handles it (`serveLocalFiles` in `sessions.ts`); that session also answers `file:` with 403 and cancels, in `webRequest.onBeforeRequest`, every request that is not `cue-local-file:`, `data:` or `blob:`. `LocalFileServer` gives each approved file's folder a host (first 32 hex digits of SHA-256 of the folder path, lower-cased on Windows, so a page's own storage survives a restart) and answers a request only for a regular file whose real path (`fs.realpathSync.native`, so symlinks and junctions are resolved) is inside the folder's real path, checked on every request; encoded separators, `.`/`..`, NUL and (Windows) `:` in a name are refused with 403. Range requests are answered (206) so media can seek. Every answer carries `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'` and `X-Content-Type-Options: nosniff`. `guardLocalFileTab` also cancels `will-frame-navigate` of a subframe to anything but the same host (or `about:blank`/`about:srcdoc`). `BrowserViewManagerMain` translates the page's address back to its `file:` address for `BROWSER_VIEW_DID_NAVIGATE` and passes no favicons of file tabs to the main window. A file page's permission requests now carry `cue-local-file://<host>/` as `securityOrigin`, which never equals the capture window's `file:///`, so `captureTargets.isCaptureRequest` cannot match it. | `localFileServer.ts`, `sessions.ts`, `navigationGuards.ts`, `BrowserViewManagerMain.ts`, `localFiles.ts` |
| 1 (fuse) | `GrantFileProtocolExtraPrivileges`: see "Fuse decision" below. | `scripts/forge-options.cjs` |
| 3 | A join that drops before it is ready is retried from a timer (1, 2, 4, 8 s), never inside the `stateChange` handler, and not at all when the reason is `AdapterUnavailable` (the join timer gives up after 15 s). A failed `rejoin()` during reconnecting is counted once. | `DiscordBot.ts` (`retryJoin`) |
| 4 | Redux-persist migration 6 sets `settings.legacyTokenNotice`; Settings shows `LegacyTokenNotice` (role `note`, link through the existing https-only window-open guard) until "Got it". Compacting LevelDB ourselves was judged unsafe. | `tokenMigration.ts`, `LegacyTokenNotice.tsx`, `Settings.tsx`, `settingsSlice.ts` |
| 5 | Close code 4014 (`WebSocketClose`): the session is removed and its connection destroyed, `notice` is set on the bot (shown by the status line, chip "Left") and the message box shows it; cleared on the next join, connect or disconnect. | `DiscordBot.ts` (`leftByModerator`), `BotStatusLine.tsx`, `OutputStatusChip.tsx`, `common/outputs.ts` |
| 6 | PERF-5 debugger throttling removed (`tabSleep.ts`, its tests, `CUE_DESK_TAB_SLEEP_MS`). | `BrowserViewManagerMain.ts`, `docs/ARCHITECTURE.md` |
| 7 | `LocalFileGate` refuses a path that is not absolute after `fileURLToPath`. | `localFiles.ts` |
| 8 | Folders and files compared by real path; the prompt shows the real path; checkbox label says "and its subfolders"; a file that does not exist is refused with a message ("That file could not be found on this computer."). | `localFiles.ts`, `BrowserViewManagerMain.ts` |
| 9 | An automatic login retry keeps each channel as a placeholder session ("reconnecting", no connection), so `active` stays true; `handleReady` rejoins and replaces them; `fail()` (attempts exhausted) leaves all. | `DiscordBot.ts` (`holdChannels`, `dropPlaceholder`) |
| 10 | Moot: `tabSleep.ts` is gone. | |
| 11 | The token store removes a stale `.tmp` and creates it with `flag: "wx"`, mode 0600. `OutputsState.legacyTokenSessionOnly` is set when a moved token could not be encrypted; Settings shows the message box once. | `botTokenStore.ts`, `OutputManager.ts`, `Settings.tsx` |
| 12 | The e2e test now uses a real server-side redirect (302) and real links. Chromium refuses a web page's link, new-window link, jump and redirect to `file:` before any app code runs (probed: "Not allowed to load local resource", `ERR_UNSAFE_REDIRECT`, no window-open handler call), so the test also sends the open file's own `cue-local-file:` address through a link, a new-window link and a redirect, which Chromium lets through, and checks the main-process log for the app's own refusals. | `e2e/localFiles.spec.ts` |

No IPC channel was added or changed.

**Fuse decision (`GrantFileProtocolExtraPrivileges`): left on.** A test package built with the fuse off opened no window content: the main window and the capture window failed with `ERR_FILE_NOT_FOUND` for `file:///…/resources/app.asar/.webpack/renderer/…/index.html`, because reading `file:` addresses inside `app.asar` is one of the privileges the fuse grants, and every e2e test failed at start-up. The app's own pages (and the player's Howler XHR and `file:` audio and backgrounds) depend on it. Local-file tabs no longer use `file:` at all and their session answers `file:` with 403, so the fuse no longer reaches them. Switching it off needs the app's own pages served from a custom scheme first (a backlog item for the lead).

**What a file page can still do.** Run its own inline script; read every file in its folder and subfolders (the folder the user approved); open a website in a new tab through a link or `window.open` (rate-limited, SEC-6), which can carry data in the address; use WebRTC, which no CSP directive covers. Opening only files you trust remains the advice in the question.

### Tests

| Test | Covers |
|---|---|
| `localFileServer.test.ts` | Addresses and hosts, `file:` address for the address bar (POSIX and Windows), refusals (parent folder, encoded `..`, `/`, `\`, NUL, symlink and folder link leading out, folder, missing file, unknown host, other schemes, Windows streams), link replaced after opening, range parsing, 200/206/403/416 answers with CSP, content types, the CSP itself |
| `localFiles.test.ts` | Drive-relative paths refused; label; a link out of a remembered folder is asked about (prompt shows the real path); a folder remembered under a link's name; missing file refused |
| `navigationGuards.test.ts` | Subframe navigation inside the folder allowed; to another folder, `file:`, `https:`, `data:` cancelled |
| `captureTargets.test.ts` | A `file:` page cannot be told from the capture window (why files no longer load from `file:`); a `cue-local-file:` origin never matches |
| `sessions.test.ts` | Scheme privileges; handlers on the local-files session only; `file:` answered 403; web requests cancelled |
| `BrowserViewManagerMain.test.ts` | File tab loads the scheme (keeping `#section`); address bar gets the `file:` address; no favicons; missing file reported |
| `OutputManager.test.ts` | Review 3 (no stack overflow with a connection that re-enters Disconnected synchronously; rejoin deferred), 5, 9, 11 |
| `botTokenStore.test.ts`, `tokenMigration.test.ts`, `LegacyTokenNotice.test.tsx`, `OutputStatusChip.test.tsx` | Review 11 temp file mode, 4, 5 |
| `e2e/localFiles.spec.ts` | A file reads a sibling and a subfolder file but not the parent folder, an encoded parent, a `file:` address, a symlink out, a web address (fetch, frame, frame moved to the web); a captured file tab gets `NotAllowedError` for screen and desktop audio; review 12 as above |
| `e2e/outputs.spec.ts` | Review 4: the notice, its link (system browser) and "Got it" (gone after a restart); the disk scan documents that the old token is left only in `Local Storage/leveldb`. Review 11: the session-only message |
| `e2e/hiddenTabs.spec.ts` | A hidden tab that plays keeps playing (audible, audio clock keeps real time) |

### Manual checks (Windows)

1. Save `map.html` and a picture `picture.png` in a new folder `C:\Users\you\Documents\Handout`, and a `secret.txt` in `Documents`. In `map.html` put `<img src="picture.png">` (a picture in the same folder) and `<iframe src="../secret.txt"></iframe>`. Open `map.html` in a tab: the picture shows, the frame stays empty. The address bar shows `file:///C:/Users/you/Documents/Handout/map.html`.
2. Bookmark it, close the tab, open the bookmark: the question appears again (or not, for a remembered folder) and the file opens.
3. Make a junction inside the folder to another folder (`mklink /J outside C:\Users\you\Desktop`) and open `outside\any.html` from the address bar: Cue Desk asks, showing the Desktop path. Tick the box: it reads "Don't ask again for files in … and its subfolders".
4. Type `file:///C:x.html` in the address bar: nothing opens.
5. With a bot in a voice channel, have a moderator drag the bot to another channel or disconnect it: the bot does not come back by itself; its status shows "Left" and the reason.
6. Turn Wi-Fi off for 10 seconds while the bot is in a channel and music plays: the chip shows "Reconnecting…", "This Computer" stays off, and the music comes back in Discord.
7. Update from 0.1 with a saved token: Settings shows the note about resetting the token; "Discord Developer Portal" opens in your browser; "Got it" removes the note for good.
