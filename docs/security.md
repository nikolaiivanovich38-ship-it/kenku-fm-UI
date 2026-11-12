# Security in Lyre

## In plain language

Lyre opens websites (YouTube, Tabletop Audio, Spotify and so on) in tabs inside the app. Those websites are run by other people, so Lyre keeps them apart from its own pages and gives them as little access as possible.

**What a tab can open.** Only ordinary web pages, meaning addresses that start with `https://` or `http://`. If you type `youtube.com`, Lyre adds `https://` for you. Lyre will not open files on your computer (`file:`), browser settings pages, scripts typed into the address bar (`javascript:`) or links that launch other programs (`steam:`, `spotify:`, `mailto:` and similar). An address with a user name or password in it (`https://name:password@site`) is also refused; log in on the page instead. When an address is refused, Lyre shows a short message under the address bar or the bookmark's address field explaining why, and nothing is opened.

`http://` pages still open, but they are not encrypted; the address bar shows "Not secure" next to them. Prefer `https://` when a site offers it.

**Pop-ups.** When a website opens a new window, Lyre opens it as a new tab instead, but only if the address is allowed, and at most 3 new tabs from the same tab every 10 seconds. Anything beyond that is ignored.

**Microphone, camera and other permissions.** Websites in tabs are refused, without being asked, if they try to use your microphone or camera, show notifications, see your location, or open other programs. They can still go full screen. Lyre's own pages may use audio devices only, which they need to send sound to Discord and to list your input devices.

**Logins.** Websites in tabs keep their own cookies and logins, separate from Lyre's settings. Website logins are not carried over from Kenku FM, so you will need to log in to websites in tabs again once. "Clear cache" in Settings now clears website data as well.

**Links to help pages.** Links in Lyre (for example "Where do I get my token?") open in your normal web browser, but only if they are `https://` links. Other kinds of link are ignored.

**Your audio stays on your computer.** Sound travels from tabs to Discord over a private channel inside Lyre; there is no network connection for it at all, so nothing else on your computer or network can send audio into your Discord channel.

**Dragging files.** Dropping a file onto Lyre outside a drop zone does nothing, and the pointer shows that it cannot be dropped there. Dragging a link from a web page onto the address bar or a bookmark's address field puts the link's text in the field. Drop zones (adding tracks, sounds or images) work as before.

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
7. While broadcasting, Lyre has no listening network port for audio (`netstat -ano` on Windows, `lsof -i -P` elsewhere, shows only the remote API port when Remote is on).

## Messages between the app's pages and the main process (SEC-8)

### In plain language

Lyre's own pages (the main window, the player and a hidden audio window) ask the main part of the app to do things: open a tab, join a Discord channel, start the remote control. Before WP1 the main part did whatever any page asked. Now it checks who is asking. A website in a tab, or something embedded inside one of Lyre's pages, is ignored. Requests with odd values (text where a number belongs, very long text) are ignored too. Nothing changes for you: Lyre's own pages ask in exactly the same way as before.

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
| `PLAYER_START_REMOTE` | Main window | address, port: text ≤ 4096 | `PlayerManager` (removed in review 0.5.0 CR-3; see `REMOTE_MOVE_OLD_SETTING`) |
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

Each of Lyre's own pages now tells the built-in browser exactly what it is allowed to load. If a bug ever let someone slip code into one of these pages, the browser would refuse to run it or to send data anywhere unexpected. You should not notice any difference.

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

## WP4 Engine core

The new playback engine (`src/player/engine`, design in `docs/playback-engine.md`) adds no IPC channel, no permission and no Content-Security-Policy change. It runs in the player page and reads audio files the way the player already does: `<audio>` elements for streaming (`media-src file: https: http:`) and `XMLHttpRequest` for small files to decode (`connect-src file: https: http:`; Chromium's `fetch()` refuses `file://`).

**Preview and whisper must not reach the broadcast.** Tab capture records everything the player page plays through its audio context's speakers (`AudioCaptureManagerPreload.ts`, `chromeMediaSource: "tab"`). The engine therefore never connects its outputs itself: only the table output may be connected to the context's speakers in the captured player page. PRV-1 must play the preview output from a context or page that is not captured, and OUT-5 must take the whisper output as its own stream, before either is offered to users.

**Test-build hook.** `src/player/renderer.ts` installs `window.__cueDeskEngineTest` (`src/player/engine/testHook.ts`) only when `__CUE_DESK_TEST_BUILD__` is true. `webpack.renderer.config.js` now defines that constant (as `webpack.main.config.js` already did), so release builds compile the branch and the module out; checked by building a release package and searching `player_window/index.js` for `__cueDeskEngineTest` (no match). The hook plays files named by the test and listens to the outputs; it has no IPC and is only reachable from the page itself.

## WP2 Tabs

### In plain language

**Files from your computer (SEC-15).** You can open a file from your computer in a tab, for example a map or a page of notes saved as HTML: type its address (`file:///C:/Maps/dungeon.html`) or paste its path (`C:\Maps\dungeon.html`) into the address bar, or open a bookmark to it. Lyre then asks "Open this file from your computer?" and shows the full path. Choose Open or Cancel (Cancel is the default). If you tick "Don't ask again for files in … and its subfolders", files in that folder and its subfolders open straight away from then on; Settings > Local files lists those folders, and the cross next to one makes Lyre ask again. Files in a shared network folder (`\\server\share`) are never opened.

Only you can open a file. A website cannot open, link to, redirect to or pop up a file from your computer. A file opens in a tab of its own, kept apart from websites, with no more permissions than a website; it can read the other files in its own folder and subfolders only, and cannot reach the web (see "WP1 security fixes" below). If the file links to a web page, the web page opens in a new website tab; links to other files do nothing.

**Your own windows cannot record the screen (SEC-16).** Lyre's own windows may use your audio devices, but nothing can use them to record your screen.

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

**In plain language.** Your bot token is like a password for your bot. Kenku FM and Cue Desk 0.1 saved it as plain text with its other settings. Now it is saved encrypted with your computer's own password protection (Windows: your Windows account; macOS: the Keychain; Linux: the desktop keyring), in `discord-bots.json` in Lyre's data folder. Lyre's windows can check whether a bot has a token, give it a new one or remove it, but can never read it back. If your computer has no such protection (some Linux set-ups), Lyre keeps the token only until it closes and says so in Settings; it never writes it as plain text. A token saved by an older version is moved once, the first time this version starts, and removed from the old place.

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

1. Fresh start, nothing playing: Task Manager shows Lyre using almost no processor; no "Audio Capture" sound activity in the Windows volume mixer.
2. First start of Lyre after Cue Desk 0.1 or Kenku FM with a saved token: the bot connects by itself; Settings shows "A token is saved, encrypted on this computer"; `%APPDATA%\lyre\discord-bots.json` does not contain the token text.
3. Two bots (Settings > "Add a second bot"), both invited to one server: Bot 1 joins one voice channel, Bot 2 another; a friend in each channel hears the music; muting Bot 2 in the side bar silences only its channel.
4. Join a voice channel, play a soundboard sound: the first word or hit of the sound is not cut off in Discord.
5. "Lighter on the computer" and "Best sound quality": speech in a YouTube tab reaches Discord with no noticeable extra delay in either.
6. Unplug the network cable (or turn Wi-Fi off) for 10 seconds while in a channel: the chip shows "Reconnecting…", then "Connected" again without touching anything. Off for two minutes: "Error" with a reason and a Reconnect button that works once the network is back.
7. Remove the bot's Connect permission on a channel and click it: a plain message explains why; the bot does not hang on "Joining…".
8. Join a Stage channel, then click it again: the bot leaves the stage in Discord.

## Standalone backgrounds

### In plain language

Lyre does not look into an installed Kenku FM for background pictures. Its own 23 pictures are part of the app, so nothing outside Lyre's program and data folders is read for them, and nothing is copied. Pictures an earlier version (0.1.1) copied into the `backgrounds` folder in Lyre's data folder are no longer used and are left alone; you can delete that folder.

### Technical details

- Removed: `src/main/legacyBackgrounds` (the `%LOCALAPPDATA%` search, the reading of Kenku FM's player bundle and `app.asar`, the copy into `<userData>/backgrounds`), the `PLAYER_GET_BACKGROUNDS` channel with its preload function `window.player.getBackgrounds`, and the test-only `CUE_DESK_LOCAL_APP_DATA_DIR` switch. The channel table has one channel fewer; `ipcGuard.test.ts` checks it stays gone.
- The pictures are bundled by webpack (`asset/resource`) from `src/player/backgrounds`, so they load from the app's own files: `'self'` in the player's `img-src`. The Content-Security-Policy is unchanged.
- The pictures are generated by a script in the repository (`scripts/backgrounds`), contain no third-party material and are covered by the project's GPL-3.0 licence (`src/player/backgrounds/LICENSE.md`).
- Not changed: the one-time copy of the user's own Kenku FM library on first start (FND-1, `src/main/migration`).

### Manual checks (Windows)

1. Start Lyre on a computer without Kenku FM. Click **Add Playlist**: 23 pictures and a blank one are offered.
2. Open a playlist or soundboard brought over from Kenku FM: it shows a picture.
3. If `%APPDATA%\cue-desk\backgrounds` exists from Cue Desk 0.1.1, rename it: nothing changes in Lyre.

## Rebrand (Lyre)

**In plain language.** Lyre is the new name of the app the drafts called Cue Desk. The first time Lyre starts, it copies the library of Cue Desk (if you tried a draft) or else of Kenku FM, under the same rules as before: only into a new, empty Lyre folder, never while that app is open, and the old folder is only read. Your saved bot tokens stay encrypted while they are copied.

**Technical details.**
- Earlier apps are listed newest first in `src/main/appIdentity.json` (`earlierApps`); `carryOverEarlierData` in `src/main/migration/carryOver.ts` takes the first whose folder has `Local Storage`. If that app is running (its LevelDB `LOCK` is held), nothing is copied and the next start retries; it never falls back to an older app's library meanwhile.
- From Cue Desk it also copies `discord-bots.json` with `Local State`. `Local State` holds Chromium's `os_crypt` key, itself wrapped by Windows DPAPI for the same Windows user, which `safeStorage` needs to read the copied tokens. The tokens are never decrypted during the copy. On Linux and macOS the key sits in the system keyring under the app's name, so tokens saved by Cue Desk there cannot be read by Lyre and must be entered again (Windows is the only target).
- Not copied: website-tab data (`Partitions/`), caches, Cue Desk's own `data-carry-over.json` and `backgrounds/`.
- The Windows app ID becomes `com.squirrel.lyre.lyre`, so Lyre, Cue Desk and Kenku FM are three separate apps to Windows (taskbar, notifications, uninstall entries).
- No new IPC channels, permissions or network listeners.

**Manual checks (Windows).**
1. On a computer with a Cue Desk 0.1 draft that has a playlist and a saved bot token, and Kenku FM: close both, install Lyre. Lyre opens with the Cue Desk playlist, and the bot connects without entering the token again.
2. Repeat with Cue Desk open: Lyre says "Cue Desk is still running. Close it and restart Lyre to bring your library across." and offers Quit.
3. On a computer with only Kenku FM: its library appears in Lyre.

## WP1 security fixes

Fixes for the independent security review of wave 1 (findings 1 to 12).

### In plain language

- **Files from your computer stay in their folder.** A page you open from your computer (a handout, a map, a home-made soundboard) can show pictures, play sounds and load other pages from its own folder and the folders inside it. It cannot read anything else on your computer, cannot load anything from the internet and cannot show a website inside itself. Links to websites still open in a new website tab. A shortcut or link inside the folder that points somewhere else is refused too. The address bar still shows the file's own address (`file:///…`), and bookmarks to files work as before.
- **A file cannot record your screen.** Even while its sound is being sent to Discord.
- **"Don't ask again"** now says what it does: "Don't ask again for files in <folder> and its subfolders". A path such as `C:x.html` (no backslash after the drive letter) is refused, because it would depend on where Lyre happens to run.
- **A moderator's choice is respected.** If a moderator moves or disconnects the bot from a voice channel, Lyre no longer pulls it back. The bot's status shows "Left" and says "A moderator moved or disconnected the bot from …"; choose a channel to join again.
- **Short Discord outages no longer stop the broadcast.** While Lyre logs the bot in again by itself, it stays in its channels as "Reconnecting…" and "This Computer" stays as it was. Only if the attempts give up does the broadcast stop.
- **Old bot tokens.** Older versions saved the bot token unprotected. After moving it, Lyre shows a note in Settings, once, recommending that you reset the token in the Discord Developer Portal (your bot's Bot page, "Reset Token") and enter the new one, because a copy of the old one can stay in Lyre's storage files. If your computer has no secure place to save passwords, a message also says that the moved token lasts only until Lyre closes.

### Technical details

| Finding | Fix | Where |
|---|---|---|
| 1, 2 | Files load from `cue-local-file://<host>/<path>`. `registerLocalFileScheme` (called at the top of `src/index.ts`; since 0.5.1 `registerAppSchemes({ websiteTabs: true })`, which nothing calls until OUT-12, CR51-3) declares it standard, secure, fetch and stream; it does not bypass CSP. Only `persist:local-files` handles it (`serveLocalFiles` in `sessions.ts`); that session also answers `file:` with 403 and cancels, in `webRequest.onBeforeRequest`, every request that is not `cue-local-file:`, `data:` or `blob:`. `LocalFileServer` gives each approved file's folder a host (first 32 hex digits of SHA-256 of the folder path, lower-cased on Windows, so a page's own storage survives a restart) and answers a request only for a regular file whose real path (`fs.realpathSync.native`, so symlinks and junctions are resolved) is inside the folder's real path, checked on every request; encoded separators, `.`/`..`, NUL and (Windows) `:` in a name are refused with 403. Range requests are answered (206) so media can seek. Every answer carries `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'` and `X-Content-Type-Options: nosniff`. `guardLocalFileTab` also cancels `will-frame-navigate` of a subframe to anything but the same host (or `about:blank`/`about:srcdoc`). `BrowserViewManagerMain` translates the page's address back to its `file:` address for `BROWSER_VIEW_DID_NAVIGATE` and passes no favicons of file tabs to the main window. A file page's permission requests now carry `cue-local-file://<host>/` as `securityOrigin`, which never equals the capture window's `file:///`, so `captureTargets.isCaptureRequest` cannot match it. | `localFileServer.ts`, `sessions.ts`, `navigationGuards.ts`, `BrowserViewManagerMain.ts`, `localFiles.ts` |
| 1 (fuse) | `GrantFileProtocolExtraPrivileges`: see "Fuse decision" below. | `scripts/forge-options.cjs` |
| 3 | A join that drops before it is ready is retried from a timer (the waits of `RECONNECT_DELAYS_MS`: 1, 2, 4, 6 s, …), never inside the `stateChange` handler, and not at all when the reason is `AdapterUnavailable` (the join timer gives up after 15 s). A failed `rejoin()` during reconnecting is counted once. | `DiscordBot.ts` (`retryJoin`) |
| 4 | Redux-persist migration 6 sets `settings.legacyTokenNotice`; Settings shows `LegacyTokenNotice` (role `note`, link through the existing https-only window-open guard) until "Got it". Compacting LevelDB ourselves was judged unsafe. | `tokenMigration.ts`, `LegacyTokenNotice.tsx`, `Settings.tsx`, `settingsSlice.ts` |
| 5 | Close code 4014 (`WebSocketClose`): the session is removed and its connection destroyed, `notice` is set on the bot (shown by the status line, chip "Left") and the message box shows it; cleared on the next join, connect or disconnect. | `DiscordBot.ts` (`leftByModerator`), `BotStatusLine.tsx`, `OutputStatusChip.tsx`, `common/outputs.ts` |
| 6 | PERF-5 debugger throttling removed (`tabSleep.ts`, its tests, `CUE_DESK_TAB_SLEEP_MS`). | `BrowserViewManagerMain.ts`, `docs/ARCHITECTURE.md` |
| 7 | `LocalFileGate` refuses a path that is not absolute after `fileURLToPath`. | `localFiles.ts` |
| 8 | Folders and files compared by real path; the prompt shows the real path; checkbox label says "and its subfolders"; a file that does not exist is refused with a message ("Can't find this file. Check the name and folder.", wording from UX finding 7). | `localFiles.ts`, `BrowserViewManagerMain.ts` |
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
3. Make a junction inside the folder to another folder (`mklink /J outside C:\Users\you\Desktop`) and open `outside\any.html` from the address bar: Lyre asks, showing the Desktop path. Tick the box: it reads "Don't ask again for files in … and its subfolders".
4. Type `file:///C:x.html` in the address bar: nothing opens.
5. With a bot in a voice channel, have a moderator drag the bot to another channel or disconnect it: the bot does not come back by itself; its status shows "Left" and the reason.
6. Turn Wi-Fi off for 10 seconds while the bot is in a channel and music plays: the chip shows "Reconnecting…", "This Computer" stays off, and the music comes back in Discord.
7. Update from 0.1 with a saved token: Settings shows the note about resetting the token; "Discord Developer Portal" opens in your browser; "Got it" removes the note for good.

## Wave 1 core fixes

### In plain language

When you close Lyre while you are still dragging a volume slider in the player, the player is now asked to save that last change before it is closed. Closing waits for its answer for at most one second.

### Channel

Add to the SEC-8 channel table (kept here so branches merge cleanly):

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `PLAYER_SAVED` | Player | none; only the registered player view's answer is used | `PlayerManager` (`saveBeforeClose`) |

`PLAYER_SAVE_NOW` goes the other way (main process to the player view, `webContents.send`), so it is not in `IPC_CHANNELS`; the player preload listens for it (`onSaveRequest`) and always answers `PLAYER_SAVED`, even if saving failed. The first quit (at `before-quit`) or the main window's first close is held (`src/main/saveBeforeClose.ts`) until that answer or one second has passed, then repeated. Nothing else changes: no new permission, no Content-Security-Policy change.

## wave1-uxfix

- Error messages on the main window's `ERROR` channel may carry a second argument, what they are about: `{ kind: "output", id }` (a Discord bot, from `OutputManager`) or `{ kind: "address" }` (a refused address, or a missing file, from `BrowserViewManagerMain`). The main window checks its shape (`isErrorCause`, `src/common/errorCause.ts`) and ignores anything else; it only decides when the message closes. Channel direction is main process → main window, so the IPC guard's table is unchanged.
- SEC-15 / UX finding 7: a file that does not exist is not asked about. `LocalFileGate` checks it first (`fileExists`, a `stat` in the main process) and the main window says "Can't find this file. Check the name and folder."; no tab opens.
- Merge of wave1-uxfix with WP1 security fixes: the missing-file check runs on the real path (`realpath`, which fails for a missing file) and then `fileExists` (a folder is not a file), after the network-folder check, and reports through `onRefused("not-found")`. "Try now" while the bot waits to log in again makes that attempt at once with its channels held (WP1 review 9), keeping the remaining attempts. A moderator's notice (WP1 review 5) counts as the bot's problem for the error message, so the message closes once the bot joins a channel again; "Try now" is not offered for a bot that "Left".
- UX finding 5: a token Discord refuses ("invalid token", 401, unauthorised) is removed from `botTokenStore` at once, so a token known not to work is never kept, encrypted or not.

## Rooms and buses

### In plain language

Each Discord bot in a voice channel is now a room, and each room gets its own sound: Lyre encodes one stream per room and gives it to that room's bot only. Moving a bot to another voice channel during play keeps its room and what it plays. A room has its own volume. Nothing new reaches the network, and website tabs still cannot send Lyre any message.

### Technical details

- Packets on the private audio channel (SEC-2) may now be `{ room, packet }`: `room` is text of at most 64 characters (`MAX_ROOM_ID_LENGTH`), `packet` must pass the same check as before (1 to 4000 bytes); anything else is dropped (`roomPacketFrom`). `OutputManager.sendPacket` gives a room's packet only to a bot that is in a voice channel now; a packet for an unknown or departed room is dropped, never played in another room. A packet without a room goes to the first room.
- The capture window is told the rooms, their volumes and where each tab goes over `AUDIO_CAPTURE_SET_ROOMS`, `AUDIO_CAPTURE_SET_ROOM_VOLUME`, `AUDIO_CAPTURE_ROUTE_VIEW` and `AUDIO_CAPTURE_SET_DEFAULT_ROUTE`. They go from the main process to the capture window (`webContents.send`), so they are not in `IPC_CHANNELS`; the capture window still checks their shape and ignores odd values.
- The preview bus in the engine (`src/player/engine/rooms`) is made once, apart from every room, and no room lane can be the preview (unit-tested over rooms coming and going).
- No new permission, no Content-Security-Policy change.

Add to the SEC-8 channel table (kept here so branches merge cleanly):

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `BOT_MOVE_TO_CHANNEL` (OUT-6) | Main window | bot id (`bot-<uuid>`); channel id: 1–25 digits | `OutputManager.moveBot` (uses `DiscordBot.join` / `leave`) |
| `ROOM_SET_VOLUME` (OUT-5) | Main window | bot id (`bot-<uuid>`); volume: finite number from 0 to 1 | `OutputManager.setRoomVolume` |

A room is muted with `OUTPUT_SET_MUTED` and the room's bot id, as before.

### Player audio channel and preview (OUT-5, PRV-1)

- The main process makes a second private `MessageChannelMain` (`src/main/broadcast/playerAudioBridge.ts`) and hands one end to the capture window (`AUDIO_CAPTURE_PLAYER_PORT`) and the other to the player page only (`PLAYER_AUDIO_PORT`): the page must be registered as the player (`trustedContents` role `player-view`), never a website tab. A new channel replaces the old one whenever either page loads, and the old ends are closed. The player preload holds its end until the page asks for it (`window.player.connectAudio()`), then posts it to its own window; the page takes only a message from its own window.
- Messages are checked on arrival (`src/common/playerAudio.ts`): room and preview frames must be exactly 1920 float samples with a whole-number index, a room id at most 64 characters, a device id at most 256; anything else is dropped. A room frame is played only into a room the capture window has, only while broadcasting. Rooms go to the player page as `PLAYER_ROOMS` (main process to page, not in `IPC_CHANNELS`).
- **Preview never reaches Discord.** Preview voices are made in the player page in an audio context with no sound device (`sinkId: { type: "none" }`), whose only connection is a tap; the page never sounds it, so tab capture has nothing to record. The frames are played by the capture window in a separate audio context on the game master's device; that context is not the broadcast's, so it cannot be connected to any room's mix, and the capture window is never captured. `e2e/rooms.spec.ts` plays a preview tone while a room plays and finds none of it in any room; the same test fails if the preview is played in the player page directly (checked once by hand).
- The player page loads the PCM worklet as a file next to its bundle (webpack `?asset`), so its Content-Security-Policy is unchanged (`script-src 'self'`).

### Device permission for the player page (PRV-2)

The player page may now see the names of sound output devices and play on a chosen one (`setSinkId`), for the preview and monitor device choice. Probed on Electron 44: listing output devices and `setSinkId` ask only the `speaker-selection` permission check (without it, `setSinkId` on a chosen device fails with "No permission to use requested device"). So the player page gets `speaker-selection` as a **check only** (`APP_PAGE_CHECKS` in `permissions.ts`, `isCheck` set by the check handler in `sessions.ts`), from its own top frame only. It is still refused `media` (no microphone, camera or screen), and a `speaker-selection` request (the `selectAudioOutput` picker) is refused. Website tabs and the other app pages get nothing new. Tested in `permissions.test.ts`, `sessions.test.ts` and `e2e/rooms.spec.ts` (choosing a missing device says "not found", not "not allowed").

### Manual checks (Windows, real Discord, two bots, two voice channels)

1. Bot 1 joins "Table", Bot 2 joins "Side". Play a YouTube tab: a friend in each channel hears it (tabs go to every room until the new interface routes them).
2. Move Bot 2 from "Side" to another channel while music plays (once the new interface offers it): its sound continues in the new channel within a second or two, and the old channel goes quiet; Bot 1's room is not interrupted.
3. Move Bot 2 into a channel it has no permission for: a plain message says why, and Bot 2 stays in "Side".
4. Bot 2 leaves its channel: "Side" goes silent at once; "Table" keeps playing; Task Manager shows Lyre's processor use drop a little.
5. Mute Bot 2: only "Side" goes silent. Unmute: it comes back.
6. Both bots leave: "This Computer" plays again (as in WP2) and Lyre's processor use falls to almost nothing.
7. (Once the new interface plays engine rooms) Music started in "Side" is heard only in "Side", music in "Table" only in "Table".
8. (Once the new interface has Preview) Preview a track while a room plays: you hear it in your headphones; a friend in either channel does not.
9. (Once the new interface has the device choice) Settings lists your sound devices by name; choosing headphones moves the preview there; unplugging them says so and the preview plays on the default device.

## Files and preview

### In plain language

**Old formats (BUG-10).** Lyre can play WMA files and a few other formats the built-in player cannot. The first time such a file plays, Lyre converts a copy in the background and keeps it in its own cache folder (`%APPDATA%\lyre\media-cache`); your file is only read, never changed. Only files inside your library folders are converted. When the original file is deleted or changed, its copy is removed the next time Lyre tidies up.

**Preview (PRV-1).** Preview plays only in your headphones. It is built so it cannot be connected to the sound that goes to Discord.

### Technical details

- **One new channel**, `MEDIA_PREPARE` (below). The player page could already read any `file:` address itself (its page is `file:`), so the channel adds two powers only: copying a file into the cache folder and running the converter on it. Both are confined to library folders by `MediaAccess` (`src/main/media/mediaAccess.ts`): the address must pass `checkLocalFileUrl` (no host, no `\\server`, no encoded separators), be a full path, and its real path (`fs.realpath`, links and junctions resolved) must be inside the real path of a library folder; folders are refused. A mapped network drive inside a library folder is allowed (the game master chose the folder; PLY-11 exists for network shares); a typed `\\server` address is still refused, as for tabs.
- **Writes only in Lyre's cache folder.** `MediaCache` writes and deletes only names of the form `<40 hex digits>.<extension>` (or that plus `.part`) directly in `<data folder>/media-cache`; names read back from `index.json` are checked against that pattern before use, so a damaged index cannot point it elsewhere (tested). Copies are written as `.part` files and renamed when complete.
- **The converter** (`ffmpegConverter.ts`) runs ffmpeg without a shell, arguments passed as a list, `-protocol_whitelist file`, both paths prefixed `file:` (no name is read as a network protocol), first audio stream only, stopped on cancel or after 10 minutes. Messages to the page are plain and carry no paths; details go to the log.
- **Preview** voices are made in the `PreviewOutput`'s context and connect only to its input, never to the engine's mixer; the test fake uses a separate context, which cannot be connected to the player page's nodes. See ARCHITECTURE.md "Wave 2: Files and preview" for the open tab-capture check before the preview is offered.
- **Read-ahead** plays from `blob:` addresses made in the player page (`media-src` and `connect-src` already allow `blob:`). No Content-Security-Policy or permission change.

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `MEDIA_PREPARE` (invoke) | Player | address: text ≤ 2 MB; options: exactly `{ keepLocal: boolean }`. Answers `{ url }` (a `file:` address) or `{ error }` (plain words) | `src/main/media/mediaIpc.ts` (`MediaCache`) |

| Test | Covers |
|---|---|
| `mediaAccess.test.ts` | Library folders and subfolders allowed; outside, link out, encoded and plain `..`, folder, missing file, network and web addresses refused |
| `mediaCache.test.ts` | Convert once, lossless to FLAC and lossy to Opus, one at a time, across restarts, again when changed; sweep; damaged index cannot reach outside; failures leave no part file; background disk copies; disk cap |
| `ffmpegConverter.test.ts` | Arguments (files only, no shell), probe, failure, missing program, cancel, timeout |
| `mediaIpc.test.ts` | Player only; argument checks; plain failure answer |

## w3-host

### In plain language

The new Lyre interface sends each room's sound to its own Discord bot over Lyre's private channel, never by recording the page, so nothing else on the page can reach Discord. The preview is heard only in the game master's headphones. The new page may see the names of sound devices to choose where the preview plays, and nothing more: no microphone, camera or screen.

### Technical details

- New page role `lyre-view` (`AppPageRole`, `permissions.ts`). It gets `speaker-selection` as a check only (device names and `setSinkId` for the preview device, PRV-2), from its own top frame; nothing as a request. Any `media` permission is refused to it, so it can never be tab-captured even if marked as a capture target (`AudioCaptureManagerMain` already refuses to capture any app page but the old player). Tested in `permissions.test.ts`.
- `PlayerAudioBridge.setLyre` hands the private channel (`PLAYER_AUDIO_PORT`) and the rooms (`PLAYER_ROOMS`) only to a page registered as `lyre-view`; anything else, the old player included, is refused. While it is open the old player gets neither; when it closes, the old player gets a new channel. Main to page only, not in `IPC_CHANNELS`. Tested in `playerAudioBridge.test.ts`.
- The new page's preload (`src/lyre/audio/preloadAudio.ts`) checks rooms as the player preload does (only `botId` and `name` strings cross) and posts the channel's end to its own window only.
- No new IPC channel from this stream. For the lead: `MEDIA_PREPARE` needs `lyre-view` added to its senders; arguments unchanged.

### Manual checks (Windows, real Discord, two bots in two voice channels)

1. Open the Lyre tab, play music before any bot joins: you hear it on this computer. Join Bot 1 to "Table": the music goes on, now in Discord, and you hear it once (not doubled).
2. Play music to "Side" only: a friend in "Side" hears it, one in "Table" does not; you do not hear it on this computer.
3. Preview a track while music plays: you hear it in your headphones; neither friend hears it.
4. Choose your headphones as the preview device; unplug them: a message says the preview plays on the default device.
5. With the Lyre tab open, play something in the old Player tab: friends still hear it (tab capture), and the Lyre tab's music is not doubled.
6. Close the Lyre tab while music plays: its music stops in Discord within a second.

## w3-shell

### In plain language

The new interface opens in a tab of its own, "Lyre", beside the old player. It is one of Lyre's own pages and gets exactly the player page's protections: it cannot leave its own page, cannot open windows, cannot run scripts from anywhere else, cannot be asked to show a website, and a file dropped on it does not replace it. It asks for no browser permissions yet, and Discord never hears it through tab capture (its sound will reach Discord only through the private player channel, wave 3).

### Technical details

- **View kind.** The main window asks for the page with the kind `"lyre"` (`LYRE_VIEW_KIND`, `BROWSER_VIEW_CREATE_BROWSER_VIEW` now accepts `"player"` or `"lyre"`). `classifyViewRequest` accepts it only together with the page's own address (`LYRE_WINDOW_WEBPACK_ENTRY`); the main process picks `LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY` itself (`APP_PAGES` in `BrowserViewManagerMain.ts`). Any other pairing, or a script path, is refused (`REFUSED_VIEW_ID`).
- **Trusted role** `lyre-view`, registered by `lockAppPage`: `will-navigate` cancelled unless only the `#route` changes, every `window.open` denied (allowed web links become ordinary tabs, as for the player), `BROWSER_VIEW_LOAD_URL` refused for it. Default session, sandboxed, context isolation on (Electron defaults, as for the player; `e2e/lyre.spec.ts` checks them in the packaged app).
- **Permissions.** `lyre-view` can ask for nothing; its `speaker-selection` check and the never-captured rule are w3-host's (`permissions.ts`, identical in both branches). It is never offered for tab capture: `BrowserViewManagerMain` does not send `BROWSER_VIEW_LOADED` for it (the main window offers every loaded view), and `AudioCaptureManagerMain` refuses any app page other than the player.
- **Audio host hook.** `BrowserViewManagerMain` calls `onLyreView` once the page is created and trusted; `SessionManager` passes it to `LyreManager.attachView`, whose `onAttachView` is where `playbackManager.setLyreView(view)` goes (marked `--- w3-host wiring ---`).
- **Content-Security-Policy** (`src/lyre/index.html`, pinned in `appPageCsp.test.ts`): `script-src 'self'` (bundles and audio worklets), `media-src 'self' blob: file:` and `connect-src 'self' blob: file:` (the playback engine and preview host: prepared library files and read-ahead, nothing from the web), `img-src 'self' data:`, `font-src 'self' data:` for the bundled fonts, `style-src 'unsafe-inline'` for style-loader's `<style>` tags, `worker-src 'none'`; no inline or eval script in production. Narrower than the player page, which still allows web addresses.
- **Drop guard**: `installDocumentDropGuard(document)` in `src/lyre/index.tsx`.
- **Preload** `src/lyre/preload.ts` exposes `window.lyre`: `page: "lyre"`, the LyreApi bridge (`api`, sends `LYRE_API_CALL` only), the audio bridge (`audio`, w3-host: the private player channel, the rooms, `MEDIA_PREPARE`) and `files.pathOf` (w3-library). It sends nothing else. (Corrected by w3-secfix, security review 15: this line said the preload sent nothing.)

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `LYRE_GET_URL` (sync) | Main window | none; answers the Lyre page's address (`""` when refused) | `src/main/managers/LyreManager.ts` |
| `BROWSER_VIEW_CREATE_BROWSER_VIEW` (changed) | Main window | as before; kind: `"player"`, `"lyre"` or missing | `BrowserViewManagerMain` |

## w3-api

### In plain language

Lyre's library (tracks, tags, playlists, pad boards, campaigns) lives in a database that only a separate background process of Lyre opens. The new interface asks for what it needs through one checked channel, and only the new interface may ask. The new interface may read sound files only from the folders in your library (since w3-secfix; the old player can still read any file it is given until it retires). If the background process stops unexpectedly, Lyre starts it again and tells you in plain words; your library and its backups stay on disk.

### Technical details

- **Own process.** `src/main/lyreApi/libraryProcess.ts` (webpack entry `lyreLibrary`) runs in an Electron `utilityProcess` started by `LyreLibraryService` (`startLibrary.ts`). It opens `libraryFolder(userData)` and runs the backups' worker thread. The main process never opens the database; it relays over the utility process's port (`src/common/lyre/rpc.ts`). The library asks the main process for host work by name only (`chooseFiles`, `chooseFolder`, `showItemInFolder`); `showItemInFolder` acts only on an absolute path. The process restarts after a crash (three crashes within a minute: it stops trying and says so).
- **Seeded test library.** `CUE_DESK_LYRE_SEED=prototype` fills a new, empty library with the prototype's sample data, in test builds only (`wantsSeededLibrary(env, __CUE_DESK_TEST_BUILD__)`). In test builds `globalThis.lyreLibraryPid` lets the e2e tests stop the process.
- **The old player's library** (`persist:player`) is read once per start, on the Lyre page's first call, with `executeJavaScriptInIsolatedWorld` (page scripts cannot change `localStorage.getItem` there). `importLegacyLibrary` then runs once ever; the database keeps its report.
- **MEDIA_PREPARE** now accepts `lyre-view` too, and is registered (`wireLyreLibrary`). `MediaAccess` allows only the library folders and the folders of tracks added from elsewhere (`{ t: "media-folders" }`). The list is refreshed when tracks or folders change, and a request waits for the newest list. Converting (WMA, AIFF) is refused in plain words until ffmpeg is bundled (`noConverter.ts`).

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `LYRE_API_CALL` (invoke) | Lyre page | `area`, `method` (a `LYRE_API_METHODS` entry), argument list (at most 4, at most 8 MB as JSON) | `src/main/lyreApi/lyreIpc.ts` |
| `LYRE_API_EVENT` (main to page) | main process | one `LyreEvent`; sent only to pages registered as `lyre-view` | `src/lyre/api/preloadApi.ts` |
| `MEDIA_PREPARE` (changed) | player page, Lyre page | as before | `src/main/media/mediaIpc.ts` |

### Manual checks (Windows)

1. Start Lyre for the first time after Kenku FM. Open the Lyre tab: your old playlists and soundboards are in the library.
2. In Task Manager, end the "Lyre library" process. The Lyre tab says the library is starting again, then that it is working again; your last changes are still there.
3. Add a file from a folder outside your library folders: it plays. A file you never added does not.

## w3-library

- **Dropped files' paths.** The Lyre page's preload adds `window.lyre.files.pathOf(file)`, which returns `webUtils.getPathForFile(file)`, as the old player's preload does: the page learns where a file the user dropped is, and nothing else. It sends no IPC; the paths go to the library only through `LYRE_API_CALL` (`import.start` with `{ from: "paths" }`), whose checks are unchanged. A page-made `File` gives "".
- No new IPC channels. Copy path writes to the clipboard from the page (`navigator.clipboard.writeText`); if the page may not, the toast still shows the path.

## w3-media

### In plain language

Lyre now ships two helpers. One reads the titles, artist, album and length written inside your audio files. The other, ffmpeg, does two jobs: it makes a playable copy of a WMA or AIFF file in Lyre's own cache folder (as described under "Files and preview"), and it measures how loud each track is along its length, so the Audio profile screen can draw the track's wave. ffmpeg only ever reads your audio files; it never changes them, never goes on the internet, and the loudness measurement writes nothing to disk. Both run inside Lyre's background processes, never in the pages you click on.

### Technical details

- **Which ffmpeg runs.** The program that ffmpeg-static 5.3.0 bundles (GPL-3.0-or-later), found by `findBundledFfmpeg(app.getAppPath())` (`src/main/media/bundledFfmpeg.ts`) in `resources/app.asar.unpacked/node_modules/ffmpeg-static/`. ffmpeg-static's own `index.js` is not used, because it lets the `FFMPEG_BIN` environment variable choose another program (the same reason `NODE_OPTIONS` is switched off, SEC-13). The program sits outside app.asar (`ASAR_UNPACK_GLOB`, matching only that file by its full place), so like the `.node` files it is not covered by the asar integrity check: anyone who can write to Lyre's install folder could replace it, which is no more than they could already do to `lyre.exe`. A missing program is logged and said plainly when a file needs converting; peaks are then simply not drawn.
- **Converting (main process)** is unchanged from "Files and preview": reads one file inside a library folder (`MediaAccess`), writes one `.part` file in `<data folder>/media-cache`.
- **Loudness peaks (library process)** (`src/main/media/ffmpegPeaks.ts`): ffmpeg is started without a shell, each argument passed as it is, at below-normal priority on one thread. It may read plain files only (`-protocol_whitelist file`, the path prefixed `file:` so no name is read as a network or other protocol), the first audio stream only, and it writes nothing: its output is raw samples on its standard output pipe (`pipe:1`), read by the library process. The file it reads is a track's own file as stored in the library (a library folder, or a file the game master added from elsewhere); web-address tracks are never read. It is stopped when the library closes or after 10 minutes. Messages carry the file's name only; details go to the log.
- **Tags** are read by music-metadata (pure JavaScript, MIT) inside the library's utility process, from the files being imported; covers are skipped. Text is cleaned (`cleanTags`: control characters dropped, lengths capped) before it is stored.
- **No new IPC channel.** `LYRE_API_CALL` gains the method `library.peaksOf` (argument: a track id; the existing per-call checks apply: at most 4 arguments, 8 MB as JSON). It answers at most 4,096 numbers. The `changed` event gains the area `peaks`. No Content-Security-Policy or permission change.

| Test | Covers |
|---|---|
| `bundledFfmpeg.test.ts` | Where the program is (packaged on Windows and Linux, `yarn start`), missing program; the real program converts AIFF to FLAC and WMA to Opus |
| `ffmpegPeaks.test.ts` | Arguments (plain files only, nothing written, no shell, low priority), cancel, unreadable file, and the real program |
| `scripts/forge-options.test.mjs` | Only the ffmpeg program is unpacked, not the rest of ffmpeg-static |
| `e2e/lyreMedia.spec.ts` | The packaged test build finds ffmpeg in app.asar.unpacked, converts an AIFF, reads tags, works out peaks |

## w3-secfix

### In plain language

Fixes from the wave 3 security review. The new interface now reads your audio files only through addresses Lyre gives it for files in your library, so even a fault in the page could not read other files on your computer. A damaged library offers to put back its latest backup. Lyre's audio cache is tidied a minute after Lyre starts, emptied by Settings > Clear cache, and closed properly when Lyre quits. Folders such as a whole drive, Windows or Program Files, your user folder itself and network shares typed as `\\server` cannot be added to the library. The ffmpeg program Lyre ships is checked against a known fingerprint when Lyre is built, its licence notice is in the NOTICE file, and it is never left to guess what kind of file it is reading.

### Technical details

- **lyre-media: (review 6).** `MEDIA_PREPARE` from the Lyre page (role `lyre-view`) answers `lyre-media://<page token>/<file token>/<name>` for the prepared file (`MediaGrants`, `src/main/media/mediaProtocol.ts`; 128-bit random tokens, one page token per page, grants dropped on `destroyed`, at most 20,000 per page). `secureSessions` handles the scheme on the default session only (website and local-file tabs have their own sessions and cannot reach it); unknown or altered addresses and methods other than GET/HEAD get 403. Answers carry `nosniff`, `no-store` and `Access-Control-Allow-Origin: *` (the page's origin is `file:`, and Web Audio silences a cross-origin `<audio>` without CORS; the address is the capability). The scheme is registered with `registerLocalFileScheme` (`registerAppSchemes` since 0.5.1) in one `registerSchemesAsPrivileged` call (Electron keeps only the last list): standard, secure, fetch, stream, `corsEnabled`. The engine's and the preview's `<audio>` elements in the Lyre page are `crossOrigin="anonymous"`; `MainMediaResolver` accepts `file:` and `lyre-media:` answers only.
- **Lyre page CSP:** `media-src blob: lyre-media:`, `connect-src blob: lyre-media:`, without `'self'`: on a `file:` page Chromium lets `'self'` match every `file:` address, so dropping `file:` alone changed nothing (found by `e2e/mediaProtocol.spec.ts`). Development builds add `'self'` to `connect-src` for the dev server.
- **The old player is unchanged:** it still receives `file:` answers and its CSP keeps `file:` (and `'self'`, which matches `file:` anyway). Its playlists, soundboards (Howler) and backgrounds read `file:` addresses directly, including files the new library does not know, so routing it through `lyre-media:` would stop files the game master adds to it from playing. It retires in 0.5.
- **Fuse `GrantFileProtocolExtraPrivileges`: still on, the narrowest setting that works.** Re-tested on 5 Nov 2026: a test package with the fuse off shows blank pages (`e2e/smoke.spec.ts`: "No page titled Lyre", 4 of 4 failed), because the app's own pages load from `file:` inside `app.asar`. Turning it off needs the app pages served from a custom scheme first, which changes their origin (the old player's `localStorage` library and the capture window's `securityOrigin` check would need moving): a backlog item.
- **MEDIA_PREPARE never hangs (review 1).** Control requests to the library's process carry ids; every waiting request is failed when the process stops, is closed, or gives up. MEDIA_PREPARE waits at most 5 s for a refreshed folder list, then uses the last good one, or answers "Lyre's library is not answering yet…".
- **Arguments (review 5, 10).** `ARGUMENT_SHAPES` (`src/main/lyreApi/argChecks.ts`) checks every LyreApi method's arguments in the library's process (kinds, lengths, full paths, branch choices); a malformed write is refused (`invalid`), a malformed read fails, both in plain words. `LYRE_API_CALL`'s guard refuses anything that is not plain data (`isPlainData`). `addRoot` (so `watchFolder`) and `planRelink` refuse a drive root, system folders, the profile folder, its AppData, the folder of all profiles and `\\server` paths (`unsafeFolderReason`, `src/main/data/paths.ts`).
- **Relink (review 4):** only the last plan's matches and the files it offered for ambiguous tracks; the plan is used up when applied and not kept across a restart.
- **Damaged library (review 8):** the library's process closes a library the background check finds damaged, finds the latest good backup in its own backups folder, and reports it; the main process shows "Restore the latest backup" / "Not now" (`dialog.showMessageBox`, never a page); on yes the process restores that backup (the damaged file kept beside it) and opens it again.
- **ffmpeg (review 2, 7):** packaging stops unless the program matches the SHA-256 pinned for the platform (`scripts/ffmpeg-builds.cjs`, forge `prePackage` hook); macOS arm64 is refused (its build uses `--enable-nonfree`). The converter, the probe and the peaks name the demuxer with `-f` from the extension (Musepack: `-format_whitelist mpc,mpc8`); a file with no known reader is not given to ffmpeg. Tests run the Linux build (7.0.2); Windows ships 6.1.1, which could not be run here; with `-f asf` the HLS and concat demuxers are never chosen on either. NOTICE names each build, its source and licence; NOTICE and LICENSE go to `resources/`; ffmpeg's licence and README and each bundle's `THIRD_PARTY_LICENSES.txt` are unpacked from app.asar.
- **No synchronous file calls** on track paths in the library's process (review 9): `fileThereWithin` (async stat, 5 s).
- **Tags (review 12):** bidi controls U+202A–U+202E and U+2066–U+2069 are removed. **Host work (review 14):** looked up with `hasOwnProperty`.
- No IPC channel added; `MEDIA_PREPARE` keeps its senders and argument checks; its answer to the Lyre page is now a `lyre-media:` address.

| Test | Covers |
|---|---|
| `libraryService.test.ts`, `wiring.test.ts` | Overlapping requests, crash and give-up with a request pending, time limit; restore offered, accepted, declined; damage found after opening; grants per page, revoked when the page goes |
| `argChecks.test.ts`, `folderSafety.test.ts`, `lyreIpc.test.ts` | The review's malformed calls; every method has a shape; unsafe folders; non-plain data |
| `libraryApi.test.ts` | Unplanned relink refused; plan used up; refused after a restart |
| `mediaProtocol.test.ts`, `sessions.test.ts`, `appPageCsp.test.ts` | Tokens, revocation, cap, 200/206/403/404/416, CORS header; scheme on the app session only; the Lyre CSP |
| `mediaCache.test.ts`, `mediaUpkeep.test.ts`, `index.test.ts` | Close stops a conversion and removes its part file; tidy-up after the window shows; Clear cache |
| `ffmpegConverter.test.ts`, `ffmpegPeaks.test.ts`, `formats.test.ts` | `-f` per extension; the real ffmpeg refuses the review's HLS and concat files named `.wma` |
| `scripts/ffmpeg-builds.test.mjs`, `scripts/licences.test.mjs` | Pinned hashes, refused platforms, NOTICE agrees with the bundled README, licence files outside app.asar |
| `e2e/mediaProtocol.spec.ts`, `e2e/lyreMedia.spec.ts` | The packaged Lyre page reads a prepared file through `lyre-media:` and cannot read a file outside the library (`file:` fetch and XHR refused, altered address 403, MEDIA_PREPARE refuses) |

### Manual checks (Windows)

1. Open the Lyre tab, play a track and a WMA file; preview a track: all play. In Settings, choose Clear cache: `%APPDATA%\lyre\media-cache` is empty afterwards (except `index.json`).
2. In the Library, try to watch `C:\`, `C:\Windows` or `C:\Users\<you>`: a message explains why not. `C:\Users\<you>\Music` works.
3. Quit Lyre while a long WMA converts: Lyre closes within a few seconds; no `.part` file is left in `media-cache`.
4. Close Lyre, rename `%LOCALAPPDATA%\Lyre Library\library.sqlite` and put any other file there under that name; start Lyre: a box offers "Restore the latest backup". Choose it: your library is back as of the last backup, and the damaged file sits beside it as `library-damaged-….sqlite`.
5. In the installed folder, `resources\NOTICE` names ffmpeg 6.1.1 and its source; `resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.LICENSE` is there.

## w4-contracts

No new IPC channel: the round 5 calls go through `LYRE_API_CALL` like every LyreApi call, so the guard checks their names against `LYRE_API_METHODS` and the call's size. Their arguments are checked in the library before it acts (`src/main/lyreApi/argChecks.ts`, security review 5): `library.setShape` (an id, a short text or null), `playlists.setPlayOrder` and `clearPlayOrder` (an id, a place branched by `kind` with its ids, `{ shuffle: boolean, repeat: text }`), `sessions.setTrackName` (a scene address, an id, a text of at most 1,000 characters; the library keeps 200), `campaigns.setOnHand` (now also "tracks") and `setUses` (now also a track), a session place for `profiles.set`/`clear`, rule `shapes` and search `shapes` (lists of short texts), and `transfer.*` (a scope branched by `kind`, a full path when given, a duplicate choice from skip, merge, keepBoth). The .lyre files themselves are opened and written as "w4-transfer" below says.


## w4-outputs

### In plain language

The Outputs screen in the new interface shows your Discord bots, the voice channels they can join and who is in each, and lets you move a bot to another channel, take it out, mute it, change its volume and play a test chime. It cannot see or change a bot's token and cannot log a bot in or out: that stays in Settings in the main window. Only the Lyre page may use these channels.

### Technical details

- `LyreOutputsBridge` (`src/main/broadcast/lyreOutputsBridge.ts`) registers the channels below through `guardIpc`, for the `lyre-view` role only, and sends the page `lyreOutputsOf(state)` (`src/common/lyreOutputs.ts`): bot ids, Discord names, login status and plain error text, the room (server, channel, status), mute, volume, server ids, and each server's voice channels with the display names of the people in them (bots left out). No token and no `hasToken`/`tokenRemembered`.
- The preload (`src/lyre/outputs/preloadOutputs.ts`) accepts only that shape (`isLyreOutputs`) and copies it before it reaches the page.
- People in channels: `DiscordBot` reads `channel.members` when it lists the servers and again from discord.js's cache 200 ms after the last `VoiceStateUpdate`; no extra request to Discord, no new gateway intent (Guilds and GuildVoiceStates, as before).
- The test chime is made in the Lyre page's own audio host and played into that room's effects lane; nothing is sent over IPC for it.
- Test builds only: `CUE_DESK_FAKE_DISCORD=prototype` starts the fake Discord with the prototype's two servers and two bots, joins the first to Table, and exposes `globalThis.__lyreOutputsTest` for the acceptance specs' `joinRoom` and `leaveAllRooms` (`src/main/broadcast/testing/prototypeWorld.ts`, required only behind `__CUE_DESK_TEST_BUILD__`).

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `LYRE_OUTPUTS_GET` (invoke) | Lyre page | none; answers `LyreOutputs` | `src/main/broadcast/lyreOutputsBridge.ts` |
| `LYRE_OUTPUTS_STATE` (main to page) | main process | one `LyreOutputs`; sent only to the page registered as `lyre-view` | `src/lyre/outputs/preloadOutputs.ts` |
| `LYRE_OUTPUT_MOVE` | Lyre page | bot id (`bot-<uuid>`), Discord channel id (digits) | `OutputManager.moveBot` |
| `LYRE_OUTPUT_LEAVE` | Lyre page | bot id | `OutputManager.leaveAll` |
| `LYRE_OUTPUT_SET_MUTED` | Lyre page | bot id, boolean | `OutputManager.setMuted` |
| `LYRE_OUTPUT_SET_VOLUME` | Lyre page | bot id, number from 0 to 1 | `OutputManager.setRoomVolume` |
| `LYRE_OUTPUT_RETRY` | Lyre page | bot id | `OutputManager.reconnect` |

### Manual checks (Windows, real Discord)

1. With two bots logged in (Settings in the main window), open Lyre > Outputs: each bot has a box; the one in a voice channel is titled with that channel and lists the people in it.
2. Join or leave that voice channel yourself in Discord: within a second the box's "Hears it" line changes.
3. Use Room to move a bot to another channel: Discord shows it there; Leave takes it out.

## w4-transfer

DAT-7 opens files that came from somewhere else (another computer, another game master, an e-mail), so every .lyre
file is treated as hostile. No new IPC channel: Save to a file, Open a file and Bring in are LyreApi calls over
`LYRE_API_CALL` (argument checks as in w4-contracts: a full path, a scope, duplicate choices). The work runs in the
library's own process (`src/main/transfer`, `src/main/lyreApi/transferApi.ts`), never beside the Discord bots.

- **Nothing is run.** A .lyre file is data only: two JSON entries and audio files. Lyre never loads code, HTML or
  scripts from it, and only entries named as Lyre names them are accepted (`lyre.json`, `library.json`,
  `audio/<number>.<audio extension>`); any other entry ("run.exe", "../../evil.dll") refuses the whole file.
- **Checked before anything changes.** Opening reads the zip's own list of entries (central directory) within the
  file's size and checks every entry against it: no encryption, no method but stored and deflate, sizes and offsets
  inside the file, a local header that agrees. Each JSON entry is read only up to a cap (8 MB and 256 MB) and inflated
  at most one byte past its stated size, so a zip bomb or a lying size is refused without filling memory; its CRC must
  match. At most 200,002 entries, a 32 MB list of entries, one audio file 2 GB, the whole file under 4 GB.
- **Zip-slip.** Entry names that are absolute, hold a backslash, a drive letter, a NUL, or an empty, "." or ".."
  part are refused (`isSafeEntryName`). Audio is unpacked under names Lyre makes from the track's file name (its last
  part only, characters Windows refuses replaced, Windows' reserved names prefixed, 150 characters at most) with the
  entry's own audio extension (w4-review-fix), inside `Brought in\<file name>`, and the target is checked once more to be inside that folder before writing. A track whose
  file name holds a folder refuses the file. Unpacked files are written through "<name>.part" with their CRC checked
  and removed again if bringing in fails.
- **Every value rebuilt.** library.json is never used as parsed: each track, playlist, rule, pad, board, campaign,
  session, scene, audio setting and play order is rebuilt field by field into a fresh object (texts with lengths,
  numbers in range, choices from Lyre's own fixed lists, ids), records keyed by ids refuse "__proto__", "constructor"
  and "prototype". The repository functions check again as for any write; one they refuse undoes the whole bring-in.
- **No new readable folders.** A brought-in track keeps its old path only when that path is under one of this
  library's own folders; otherwise it points into the brought-in folder (missing until relinked). A file therefore
  cannot make the player's media access (MEDIA_PREPARE, which allows the folders of the library's tracks) reach a
  folder it would not reach before.
- **Refusals** are in plain words and say nothing changed (`refusalWords`): not a Lyre file, damaged (cut off), damaged
  (changed), saved by a newer Lyre, names Lyre never writes, too large. The page shows them as they come.
- **Paths from the page.** `transfer.open({ from: "path" })` takes the path of a dropped file (the preload's
  `webUtils.getPathForFile`). Only a name ending in .lyre is read; for anything else Lyre answers "not a Lyre file"
  without opening it, and nothing of a refused file's content goes back to the page.
- **Saving** writes only where the game master chose in the save dialog (the main process asks; the library sends a
  suggested name, of which only the last part is used), through "<name>.part" moved into place at the end.
  `transfer.save` has a `path` for tests that call the library directly; the library's process drops it from the
  page's calls (`withSaveDialogOnly`, w4-review-fix), except in a seeded test build.
- **Test builds only** (`CUE_DESK_LYRE_SEED=prototype`, gated on `__CUE_DESK_TEST_BUILD__` through `wantsSeededLibrary`):
  the two dialogs and the folder chooser answer by themselves, and the library looks at the prototype's computer
  (`sampleComputer.ts`) instead of the disk. Release builds never seed, so none of this is reachable there.

## w4-normalise

No new IPC channel. The four normalisation calls go through `LYRE_API_CALL`; their arguments are checked in the library before it acts (`argChecks.ts`): `library.normaliseSettings` (none), `library.setNormaliseSettings` (`{ on: boolean, target: short text }`), `library.setNormalise` and `playlists.setNormalise` (an id, a short text or null). The data layer then refuses any target other than quiet, standard and loud and any choice other than on, off or null. Measuring loudness runs the bundled ffmpeg with the same safety as the peaks (`src/main/media/ffmpegLoudness.ts`): no shell, each argument as it is, `-protocol_whitelist file`, the reader fixed by the extension (security review 7), the first audio stream only, below-normal priority, a time limit, and nothing written (`-f null`); its report is read from the error stream as text and only numbers are kept.

## w4-guide

### In plain language

Help › Save diagnostics makes one zip file for a bug report, in a folder you choose. Lyre never sends it anywhere:
it has no code that could. Before writing, Lyre takes out your bot tokens, anything named like a secret and your
user name in folder paths. Help's articles are plain text bundled with Lyre: they cannot open links, pages or files.

### Technical details

- **Channels** (both from the Lyre page only, no arguments, registered by `DiagnosticsBridge` through `guardIpc`):

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `LYRE_DIAGNOSTICS_SAVE` (invoke) | Lyre page | none; answers `{ ok: true, folder, file }` (names only), `{ ok: false, cancelled: true }` or `{ ok: false, cancelled: false, message }` | `src/main/diagnostics/diagnosticsBridge.ts` |
| `LYRE_DIAGNOSTICS_SHOW` | Lyre page | none; shows the last file this session saved, if it is still there | `src/main/diagnostics/diagnosticsBridge.ts` |

- **The folder** is asked for in the main process (`dialog.showOpenDialog`, Documents first); the page never names a
  path, and only the folder's and file's names go back to it. The zip is written through "<name>.part" and never
  replaces a file ("(2)" is added).
- **What is gathered**: the version, Electron, Chrome, the operating system, architecture and language; the last 500
  log lines and 200 blocked-content warnings, kept in memory only (`diagnosticsLog.ts`: the main process's console,
  the app pages' warnings and errors, and of a website tab only Content-Security-Policy refusals, never its own
  messages); the main window's Settings (the `settings` part of its saved state, not bookmarks), the Lyre page's
  `lyre-shell`, each read by the main process from that page (`executeJavaScript` of one `localStorage.getItem`,
  2 s at most); each bot's name ("Bot 1"), status, error, number of servers, voice status, mute and volume (no
  token, no server, channel or people's names).
- **Scrubbing** (`scrub.ts`), on every text and value before writing: Discord token patterns become
  "[token removed]"; values whose name matches token, secret, passw, credential, api key, private key or auth
  become "[removed]"; the home folder (either slash, any case) becomes "~".
- **No network**: `src/main/diagnostics` imports no network module (`http`, `https`, `net`, `tls`, `dns`, Electron's
  `net`, `fetch`); `diagnostics.test.ts` checks the source and that saving calls none of them.
- **Test builds of the sample library only** (`CUE_DESK_LYRE_SEED=prototype` behind `__CUE_DESK_TEST_BUILD__`):
  the folder is the data folder's `Documents`, without a dialog.
- **Help articles** (`src/lyre/help/articles/*.md`) are bundled as text and drawn as React text: paragraphs, lists,
  bold and keys only. No HTML, link or picture is read from them.

### Manual checks (Windows)

1. Help › Save diagnostics…: a folder chooser opens at Documents; choose one. The line under the button names the
   folder and the file; Show in folder opens Explorer on it.
2. Open the zip: no bot token anywhere (search for the first 10 characters of yours), and paths start with `~`.
3. With the network cable out or Wi-Fi off, saving works the same.

## w4-review-fix

### In plain language

Fixes from the independent review of wave 4. A Lyre file someone sends you can now only ever put audio files on
your computer: a part of the file that is not audio Lyre plays is left out, and Lyre says how many. A file cannot make
Lyre write more than the file itself holds.

### Technical details

- **Only audio is unpacked (review Must 1).** A .lyre entry is unpacked only when its name (already restricted to
  `audio/<number><audio extension>`) has an extension in `AUDIO_EXTENSIONS` and its first 4 KB start the way that
  format starts (`looksLikeAudio`, `src/main/transfer/audioBytes.ts`: `fLaC`, `ID3` or an MPEG frame, `RIFF…WAVE`,
  `OggS`, `ftyp`, the ASF GUID, `FORM…AIFF`, EBML, `MAC `, `wvpk`, `TTA1`, the AC-3 sync word, `MPCK`). The file lands
  under the track's name with the entry's extension, never the extension of the track's `fileName`:
  `Session notes.pdf.exe` with an MP3 entry becomes `Session notes.pdf.mp3`. `unpackAudio` refuses a target whose
  extension differs from the entry's. Parts left out are counted in the summary ("3 audio files in it were not audio
  Lyre can play, so Lyre left them out."); their tracks are brought in as missing files, which Find missing files can
  relink only to audio files (`collectAudioFiles`).
- **No more written than the file holds (review Should 2).** Stored parts lie side by side, so `readLyreFile` refuses
  ("damaged") a file whose distinct audio parts together say they are larger than the file (zip entries that overlap).
  A part named by several tracks is unpacked once; the library keeps one track per file, so those tracks are brought
  in as the one that has it, and the summary says so. Before unpacking, the drive's free space (`statfs`) must hold
  the parts, or Bring in is refused with nothing written. The review's 5 MB file that wrote 1,048 MB now writes 5 MB.
- **No file holds the library for long (review Should 3).** Bringing in compares the file with the library through
  maps (names, ids, tag values), never by scanning a list for each item, and does its work as one list in batches of
  250 (tracks, then playlists, boards, campaigns and each of their sessions, then settings) with the event loop free
  between them; reading the library and comparing take turns of their own. 8,000 playlists, 2,000 boards and 2,000
  campaigns beside as many of yours open and come in with no turn over 200 ms (`hostileFile.test.ts`).
- **Preview the file found (review Should 5).** Find missing files' Preview on a "check it" row (a match by name
  only) plays the file Lyre found, through MEDIA_PREPARE like any track, not the track's old address. The main process
  reads only folders the library names; while a relink plan lasts, the library also names each file of a planned
  match by name only (`previewableFiles`, sent with the media folders), so exactly those files may be prepared, not
  the files beside them (`MediaAccess` treats a listed file as a folder of one). Planning sends a "folders" change so
  the list is asked for again. When a file leaves the list (a new plan, a relink, a restart), the main process drops
  every page's `lyre-media:` address for it (`MediaGrants.revokeFile`). No IPC channel or argument check changed.
- **Undo of a bring-in (review, could).** The audio files a bring-in unpacked stay while Redo can bring it back; once
  it cannot (a new step, another bring-in, the library closing), the files no track uses are removed, with their
  brought-in folder when it is left empty. Only files that bring-in wrote itself are ever removed.

## w5-fixes

- **BUG-19.** No room of the Lyre page ever plays on this computer. The audio host joins no room to the page's speakers, and the capture window plays the page's room frames (the private `PLAYER_AUDIO_PORT` channel) past each room's `input`, into the `volume` node towards that room's encoder only; "This Computer" is fed from a separate `localVolume` that only tabs and input devices reach (`AudioCaptureManagerPreload.test.ts`, `e2e/onAir.spec.ts`). Preview and Try pads keep their own path to the headphones (PRV-1). The w3-host manual check 1 ("play music before any bot joins: you hear it on this computer") is replaced by: play music before any bot joins: nothing is heard on this computer, and Live and the Now playing bar say nobody hears it; join Bot 1 to "Table": the players hear it in Discord, you hear it only if you are in "Table" yourself.
- **BUG-20.** New cue action `stopPads` (`{ type, target?, fadeMs? }`), checked by `isCueAction` like `fadeAll` (target and a fade of 0 to 60 s). It cannot be put on a hotkey (`cueActions.ts` refuses it). It reaches the engine only from the Lyre page's own audio host; it crosses no process boundary.
- **BUG-21.** Renaming goes through the existing `sessions.update` call and its argument checks.
- No IPC channel, argument check, permission or Content-Security-Policy changed.

## w6-contracts

### In plain language

Settings in Lyre can add a Discord bot, replace its token, rename or remove it, and open its invite. A token you paste
goes straight to the part of Lyre that keeps it encrypted, as before; the screen only ever gets its last four
characters back. The invite link is made by Lyre itself from the Application ID, so the screen cannot open any other
address. Find missing files can play a file it found only when you press its Preview, and only that one file, until
you leave the screen.

### Technical details

- **Bot channels** (`lyreOutputsBridge.ts`, rules in `ipcChannels.ts` "w6-contracts", Lyre page only): `LYRE_BOT_ADD`
  (a token of at most 200 characters and an Application ID of digits or null), `LYRE_BOT_SET_TOKEN`, `_RENAME` (at most
  200 characters), `_SET_APP_ID`, `_REMOVE`, `_RESTORE` (invoke; a bot id first), `_CONNECT`, `_DISCONNECT` (send; a
  bot id), `_OPEN_INVITE` (send; an Application ID, `isApplicationId`). The main process checks a token's and an
  Application ID's shape (`tokenProblem`, `applicationIdProblem`) and answers in plain words, so Discord only sees a
  token that could be one.
- **SEC-5 kept**: tokens are encrypted by `BotTokenStore` as before; `LyreOutputs` carries `tokenEnd` (four characters,
  worked out once in memory, never written in clear). A removed bot is held in memory with its encrypted token for
  Remove's Undo; a token kept for this session only is held apart (`SESSION_TOKENS`), so it is in nothing sent or
  written. The Application ID is not a secret and is saved in `discord-bots.json`.
- **The invite** is `botInviteUrl` (`https://discord.com/oauth2/authorize?client_id=<digits>&scope=bot&permissions=3146752`:
  View Channels, Connect, Speak), opened through `openExternalIfAllowed`. In test builds the fake Discord's
  `inviteOpened` stands in for the browser.
- **SEC-17**: planning a relink grants nothing; `import.previewFound(trackId)` puts the one found file of a match by
  name only on the list `MediaAccess` reads (`previewableFiles`), replacing any earlier one, until a new plan, a
  relink or `import.endRelinkPreview()`; each change sends a "folders" event so the main process asks again and drops
  addresses that left the list (`MediaGrants.revokeFile`).
- **UX-19**: a write SQLite could not save is a `"not-saved"` refusal; the hook that makes the next write fail is
  honoured only by a test build's sample library (`fail-next-write`, ignored when not seeded) and exposed only in test
  builds (`__lyreLibraryTest`).

### Manual checks (Windows, real Discord)

1. Settings › Add a bot: paste a real Application ID; Open the invite opens Discord's page in your browser asking for
   View Channels, Connect and Speak, nothing else.
2. Paste the bot's token and Connect: the bot shows "••••••••" and the token's last four characters only; restart Lyre:
   it still connects.
3. Remove the bot, then Undo: it comes back, connects and goes back to its voice channel.
## w6-found

### In plain language

**Remote control (SEC-4).** The remote control (for a Stream Deck or a phone) is off until you turn it on, and then listens on 127.0.0.1, which only programs on this computer can reach, unless you choose this computer's network address. Every request must now carry Lyre's secret code, made the first time Lyre starts and kept encrypted on this computer. Web pages cannot use it, even ones open on this computer, and a wrong code tried ten times in ten minutes locks that device out for a while. Its answers no longer show where your files are. The Kenku FM Stream Deck plugin does not send the code, so it cannot control Lyre until it does; Settings will show the code (round 7).

**Updates (SEC-14).** When Lyre cannot check for an update, or cannot install one, it now says so in plain words in the message box once (and again only after a check has worked), instead of only writing it to the log.

**Libraries (SEC-9).** The remote control's web server library (fastify) moved to version 5, which fixes its known security problems; no library Lyre ships has a known high or critical problem.

### Technical details

- **Settings and code.** `src/main/remote/remoteSettings.ts` keeps `{ enabled, address, port }` and the code in `remote-control.json` (mode 0600, written through a fresh temporary file like `discord-bots.json`). Defaults: off, `127.0.0.1`, 3333. The address must be `127.0.0.1` or a private address this computer has (since review 0.5.0 CR-2; see that section), the port 1024 to 65535; a damaged or edited file falls back to the defaults. The code (`remoteCode.ts`) is 20 Crockford base32 symbols from 13 random bytes (100 bits), shown as five groups of four; it is encrypted with `safeStorage` (`encryptedCode`), or kept in memory only where `canEncrypt` says no (then a new code each start; `codeRemembered: false`). One store is shared by every `PlayerManager`, so a reload keeps the code.
- **Server.** `remoteServer.ts` `createRemoteServer` (fastify 5, `bodyLimit` 16 KB) runs one `onRequest` hook before every route, in this order: at most 600 requests a minute per address (429 with `Retry-After`); any `Origin` header refused (403); `Host` must be `localhost`, an IPv4 address or a bracketed IPv6 address with the server's port (403; DNS rebinding needs a name); an address with 10 wrong codes in 10 minutes refused (429); `Authorization: Bearer <code>` compared with `codesMatch` (SHA-256 of both, `timingSafeEqual`), else 401 with `WWW-Authenticate: Bearer realm="Lyre"`. The `text/plain` body reader is removed, so only JSON bodies are read (415 otherwise). A `preSerialization` hook drops `url` keys and `file:` text from every answer. Unknown routes answer 401 before 404, so they reveal nothing without the code.
- **Lifecycle.** `remoteControl.ts` `RemoteControl` starts, moves or stops the server to match the settings, one change at a time, and turns listen errors into plain words (port taken, address not on this computer, port not allowed). `PlayerManager` makes one per main-window load, starts it if it was left on (after the previous window's server has closed), and closes it in `destroy()` without changing the setting. The old Settings' `PLAYER_START_REMOTE` / `PLAYER_STOP_REMOTE` set the settings until review 0.5.0, which removed them (CR-3).
- **Updates.** `src/main/updateStatus.ts` records each step of Electron's `autoUpdater` (`src/autoUpdate.ts`: checking, downloading, up to date, ready, error, or off with the reason) and turns errors into plain words without the user's folder names (`plainUpdateError`). The first error after a working check goes to the main window's `ERROR`; later ones only to the log and the state, as checks repeat every 15 minutes.

### Channels

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `REMOTE_GET` (invoke) | Lyre page | none; answers a `RemoteState` (`src/common/remoteControl.ts`: on, running, address, port, the secret code, `codeRemembered`, `problem`) | `PlayerManager` |
| `REMOTE_SET` (invoke) | Lyre page | one plain object with only `enabled` (boolean), `address` (text ≤ 64), `port` (integer 1 to 65535); the store then checks address and port; answers the new state or `{ error }` | `PlayerManager` |
| `REMOTE_NEW_CODE` (invoke) | Lyre page | none; answers the new state | `PlayerManager` |
| `REMOTE_STATE` (main to page) | main process | one `RemoteState`, after each change, to pages registered as `lyre-view` only | `src/lyre/remote/preloadRemote.ts` |
| `UPDATE_GET` (invoke) | Lyre page | none; answers an `UpdateState` (`src/common/appUpdates.ts`) | `LyreManager` |
| `UPDATE_STATE` (main to page) | main process | one `UpdateState`, after each change, to the Lyre page | `src/lyre/updates/preloadUpdates.ts` |

The Lyre page reaches them as `window.lyre.remote` (`get`, `set`, `newCode`, `onChange`) and `window.lyre.updates` (`get`, `onChange`). The main window, the old player, the capture window and website tabs cannot use them. (Until review 0.5.0, `PLAYER_START_REMOTE` and `PLAYER_STOP_REMOTE` from the main window could also turn it on; CR-3 removed them.)

### Tests

| Test | Covers |
|---|---|
| `src/main/remote/remoteCode.test.ts`, `rateLimit.test.ts` | Code format and randomness, forgiving comparison, wrong lengths; per-caller windows, retry time, memory cap |
| `src/main/remote/remoteServer.test.ts` | 401 without or with a wrong code (also GET and unknown routes), lock-out after 10 wrong codes and its end, `Origin` and web-name `Host` refused even with the code, the Host table, text/plain and form bodies refused, 600 a minute, no file addresses in answers |
| `src/main/remote/remoteSettings.test.ts` | Defaults, code made on first run and kept encrypted, session-only code without encryption, new code, unreadable code, saved settings, refused address and port, damaged file, file mode |
| `src/main/remote/remoteControl.test.ts` | Off until on, 127.0.0.1 only, start after a restart, port closed when off, new code at once, moving port, port taken in plain words, refused address |
| `src/main/managers/PlayerManager.test.ts` | The three channels from the Lyre page only, argument shapes, `REMOTE_STATE`, the old Start and Stop Remote, start when left on, close on destroy, reload |
| `src/lyre/remote/preloadRemote.test.ts`, `src/lyre/updates/preloadUpdates.test.ts` | The page's bridges pass only well-formed answers |
| `src/main/updateStatus.test.ts`, `src/autoUpdate.test.ts`, `src/main/managers/LyreManager.test.ts` | Plain update errors without folder names, told once per run of failures, every updater step, off reasons, listeners removed on close, `UPDATE_GET` / `UPDATE_STATE` for the Lyre page only |
| `e2e/remote.spec.ts` | The packaged app: code read through the Lyre page, 401 without it, 403 for `Origin` and a web-name `Host`, 415 for text/plain, no `file:` in answers, every route with the code, off closes the port |

### Manual checks (Windows)

1. Lyre › Settings › Remote control, turn it on (before review 0.5.0: the main window's Settings > Remote > Start Remote), then in PowerShell: `Invoke-WebRequest http://127.0.0.1:3333/v1/playlist`. The answer is 401 and says to copy the secret code from Lyre's Settings.
2. Once round 7's Settings shows the code: `Invoke-WebRequest http://127.0.0.1:3333/v1/playlist -Headers @{ Authorization = "Bearer <code>" }` lists your playlists, with no file paths.
3. Quit and start Lyre: the remote is on again with the same code (Windows encrypts it).
4. Turn the network off and wait up to 15 minutes in an installed copy: one message says Lyre could not check for updates because the computer seems to be offline.

## w7-contracts

**In plain words.** Lyre's library can now keep more of how you run a game (tag places, folders, dividers, what a
scene or pad does, your keys, the crossfade). Every new request from the Lyre page is checked before the library acts
on it, as the older ones are. Your display and sound-device choices are kept in a small file beside the library on
this computer only; they never go into a backup or a shared .lyre file. A shared .lyre file can now carry the new
things too, and Lyre checks each of them before anything changes.

### Technical details

- **No new IPC channel.** The round 7 calls go through `LYRE_API_CALL` (lyre-view only); `LYRE_API_METHODS` names
  them and `argChecks.ts` checks every argument's shape (steps: at most 50 plain objects with a `do` text, each then
  checked by the data layer's `checkSteps` and per-kind checks; drop places by `kind`; tag colours and folder kinds;
  keys at most 40 characters, then `normaliseKey`; device ids at most 512 characters). A malformed write answers
  `invalid` with `NOT_UNDERSTOOD`.
- **This computer's settings** (`libraryApiRound7.ts`): `this-computer.json` in the library's folder
  (`%LOCALAPPDATA%\Lyre Library`), written to a `.part` file and moved into place; read with each value checked
  (`checkDisplay`, `checkDevices`), so a damaged or edited file gives the defaults. It holds no secret (device ids are
  Chromium's per-origin ids). An in-memory library keeps them in memory.
- **.lyre files** (`transfer/lyreFile.ts`): steps are checked one by one (`checkStep`: kind, ids, choices, ranges, at
  most 50), tag colours from the palette, dividers' rows 0–7 and names at most 200 characters, at most one mix-out
  marker; Bring in maps every id a step names to what the file brought and drops a step naming anything else, so a
  file cannot make a step fire one of your pads or start one of your scenes.
- **Steps cannot loop for ever.** A scene start that starts scenes stops after four rounds with a plain message;
  waits are at most 10 minutes and fades at most a minute (CHECKs and `checkSteps`).

### Tests

| Test | Covers |
|---|---|
| `src/main/lyreApi/argChecks.test.ts` | Every method has a shape (the guard), the round 7 ones included |
| `src/common/lyre/contract.ts` "design round 7" (fake and library, in-process and across a port) | Every round 7 call and refusal |
| `src/main/lyreApi/transferApi.test.ts` (round 7) | A .lyre round trip of the new data, ids mapped |
| `src/lyre/audio/round7.test.ts` | A scene starting itself stops; Undo stops waiting steps |

### Manual checks (Windows)

1. Once the Settings screen has it: Settings › Headphones and speakers: choose a headset, turn on Split one headset, preview a track: it plays in the
   chosen ear only; turn the split off: both ears, at the same loudness as before.
2. Close Lyre, open `%LOCALAPPDATA%\Lyre Library\this-computer.json` in Notepad, type rubbish into it, save, start
   Lyre: Look and feel and Headphones and speakers are back at their defaults and nothing else changed.

## w6-shell

- **Display zoom (UX-11).** The Lyre page's preload gains `display.setZoom(factor)` (`src/lyre/shell/display.ts`):
  it calls `webFrame.setZoomFactor` for this page only, with a finite number clamped to 1 to 2, and anything else is
  ignored. No IPC channel is added; nothing else of `webFrame` reaches the page.
- **Find and play, Back, the Saved pop-up** use the existing LyreApi and audio calls through the existing guarded
  channels; no new channel or argument.

## w6-rooms

### In plain language

Settings is now inside Lyre. A bot's token goes from the box you paste it in straight to the part of Lyre that keeps it
encrypted; the screen only ever shows its last four characters. The remote control's secret code is now 8 characters
with nothing that looks alike (no 0 or O, no 1, I or L), so it is easy to type on a phone. "Your home network" makes
the remote control listen on this computer's private address on your Wi-Fi and nowhere else (never on the internet's
side). "Next scene and Fade everything out work in other programs too" takes only those two keys from other programs,
and only keys you do not type with: Space or Ctrl+Z, for example, are refused in plain words, because Discord and every
other program would lose them. The keys go back when you turn it off, change a key, close the window or quit.

### Technical details

- **Remote code** (`src/main/remote/remoteCode.ts`, lead decision 7 Nov): 8 symbols of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  (31) from `crypto.randomInt` (no modulo bias), shown `XXXX-XXXX`; 31^8 ≈ 8.5 × 10^11 with the 10-in-10-minutes lock
  (rateLimit.ts). Comparison as before (`codesMatch`: upper case, no spaces or dashes, SHA-256 + `timingSafeEqual`). A
  stored code in the older 20-symbol form is replaced on load (`remoteSettings.ts`).
- **Home network** (`homeNetwork.ts`): `RemoteState.homeAddress` is this computer's private IPv4 address (RFC 1918;
  192.168 first, then 10, then 172.16–31), or null. `RemoteControl` passes on only an address `isHomeNetworkAddress`
  accepts, so neither a public address nor 0.0.0.0 is ever offered; the page sets it through `REMOTE_SET` as before.
  Until review 0.5.0 this was true only of the address offered: the address listened on was any IP address, 0.0.0.0
  included. The main process now refuses those too (CR-2, below).
  Test builds may be given one with `CUE_DESK_FAKE_HOME_ADDRESS` (`PlayerManager`, gated on `__CUE_DESK_TEST_BUILD__`).
- **Global keys** (`src/main/globalKeys.ts`, `src/common/globalKeys.ts`): `LyreManager` registers at most two
  accelerators with `globalShortcut`, for nextScene and fadeAll, only while the page asks with `on: true`;
  `globalKeyProblem` refuses keys used for typing or other programs' commands before Electron is asked (allowed: F1–F12,
  Shift+Esc, two modifiers including Ctrl or Alt; since review 0.5.0 not Ctrl+Alt with a key that types, CR-6). A key another program holds (`register` answers false) is refused in
  plain words. Every key is unregistered on each change, in `LyreManager.destroy()` and on `will-quit`
  (`globalShortcut.unregisterAll()`, src/index.ts).
- **The main window's settings** (`src/common/windowSettings.ts`, `src/main/windowSettings/windowSettingsBridge.ts`,
  `src/renderer/features/settings/windowSettingsSync.ts`): Sound to Discord and Website tabs stay in the main window
  (its own storage, as Kenku FM). Only the four settings cross, each checked exactly (`isWindowSettings`,
  `isWindowSettingsChange`); nothing else of the main window's state reaches the Lyre page.
- **Local files and Clear website data**: Lyre-page twins of `LOCAL_FILES_*` and `CLEAR_CACHE`, handled by the same code.
- **Bots** (OUT-8): the screen uses the w6-contracts channels only; tokens go in through `password` fields and are never
  held in the page's state (the field is read on Save or Connect, then emptied).

### Channels

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `LYRE_GLOBAL_KEYS_SET` (invoke) | Lyre page | one object exactly `{ on: boolean, keys: { nextScene?, fadeAll? } }`, keys text ≤ 40 (`isGlobalKeysRequest`); answers `{ refused: [{ action, key, message }] }` | `LyreManager` (`globalKeys.ts`) |
| `LYRE_GLOBAL_KEY` (main to page) | main process | `"nextScene"` or `"fadeAll"`, on each press | `src/lyre/keys/preloadKeys.ts` |
| `WINDOW_SETTINGS_STATE` (send) | Main window | one `WindowSettings`, exactly the four keys | `WindowSettingsBridge` |
| `WINDOW_SETTINGS_SET` (main to main window) | main process | one checked `WindowSettingsChange` from the Lyre page | `windowSettingsSync.ts` |
| `LYRE_WINDOW_SETTINGS_GET` (invoke) | Lyre page | none; answers the latest `WindowSettings` or null | `WindowSettingsBridge` |
| `LYRE_WINDOW_SETTINGS_SET` (invoke) | Lyre page | one `WindowSettingsChange` (one to four known keys, each of its kind); answers whether a main window took it | `WindowSettingsBridge` |
| `LYRE_WINDOW_SETTINGS_STATE` (main to page) | main process | one `WindowSettings` | `preloadWindowSettings.ts` |
| `LYRE_LOCAL_FOLDERS_LIST`, `LYRE_LOCAL_FOLDERS_FORGET` (invoke) | Lyre page | none; a folder, text ≤ 32,767 | `BrowserViewManagerMain` |
| `LYRE_CLEAR_WEBSITE_DATA` (invoke) | Lyre page | none | `appInfoIpc.ts` (src/index.ts) |

### Tests

| Test | Covers |
|---|---|
| `src/main/remote/remoteCode.test.ts`, `homeNetwork.test.ts`, `remoteSettings.test.ts`, `remoteControl.test.ts` | 8-character code, alphabet, no bias, old codes replaced; private addresses only |
| `src/common/globalKeys.test.ts`, `src/main/globalKeys.test.ts`, `LyreManager.test.ts` | Accelerators, typing keys refused, a held key refused, release on change, destroy and dispose, Lyre page only |
| `src/common/windowSettings.test.ts`, `windowSettingsBridge.test.ts`, `windowSettingsSync.test.ts`, `preloadWindowSettings.test.ts`, `appInfoIpc.test.ts`, `BrowserViewManagerMain.test.ts` | Exact shapes, senders, the two-way path |

### Manual checks (Windows)

1. Settings › Remote control: turn it on; the code is two groups of four; `Invoke-WebRequest http://127.0.0.1:3333/v1/playlist -Headers @{ Authorization = "Bearer <code>" }` lists playlists. Choose Your home network: the address shown is 192.168.x.x (or 10.x.x.x); from a phone on the same Wi-Fi, the same request with that address works; Make a new code, and the old one is refused.
2. Settings › Keyboard shortcuts: turn on "in other programs too" with Next scene on Space: it says Space cannot work there. Give Next scene F9, turn it on, click into Discord and press F9: Live moves to the next scene; type a space in Discord's chat: it types. Turn it off: F9 does nothing outside Lyre. Quit Lyre: F9 works for other programs again.

## review-0.5.0 fixes

### In plain language

The remote control now listens only where Settings says it can, whatever asks it: on this computer only (127.0.0.1),
or on this computer's own address on your home network. "Every address" (0.0.0.0 or ::), an internet address, and an
address this computer does not have are refused in plain words, even if an old setting or a faulty page asks for one.
If your computer is not on the home network it was set up on, the remote control waits and says why, instead of
listening somewhere else. Only Lyre's own Settings turns the remote control on now; the main window's old Settings
says where to find it, and a choice made there before is moved over once. Keys that work in other programs refuse
Ctrl+Alt with a letter or digit (that is AltGr on a Belgian keyboard, which types @, € and #) and Alt+F4 or Ctrl+F4.

### Technical details

- **Listen address (CR-2).** `remoteAddressProblem` (`src/main/remote/remoteSettings.ts`) allows `127.0.0.1`, or an
  address `isPrivateListenAddress` (`homeNetwork.ts`) accepts (RFC 1918, 169.254/16, fe80::/10, fc00::/7) that is one
  of this computer's addresses (`ownNetworkAddresses(os.networkInterfaces())`, zone dropped, lower case; a test build
  adds `CUE_DESK_FAKE_HOME_ADDRESS`). 0.0.0.0, `::`, loopback other than 127.0.0.1 (`localhost`, `::1`), IPv4-mapped
  and internet addresses are refused. It runs in three places: `RemoteSettingsStore.update` (so `REMOTE_SET` and the
  one-time move of the old setting are checked), `load` (an address of a kind never allowed goes back to 127.0.0.1;
  on and the port are kept), and `RemoteControl.apply` just before `listen`, against the addresses the computer has at
  that moment, so a saved home-network address the computer no longer has is not listened on and Settings shows why.
- **One owner (CR-3).** Until 0.4.1 the main window's Settings kept Remote on/off, address and port in its own saved
  state and called `PLAYER_START_REMOTE` at every start and reload, overriding Lyre's Settings. That panel now only
  says where the remote control is; its Address and Port fields, Start/Stop Remote and the start-up call are gone, and
  so are `PLAYER_START_REMOTE`, `PLAYER_STOP_REMOTE` and `window.kenku.playerStartRemote` / `playerStopRemote`.
  redux-persist version 7 (`src/renderer/features/settings/remoteMigration.ts`) hands the old values to the main
  process once through `REMOTE_MOVE_OLD_SETTING` and drops them from the saved state. `RemoteSettingsStore.moveOldSetting`
  takes them only once (`oldSettingMoved: true` in `remote-control.json`): an old "on" is kept, with 127.0.0.1 for an
  address CR-2 does not allow and the current port for an odd one; an old "off" changes nothing. Later messages are
  ignored, so the old setting has no effect after that.
- **Global keys (CR-6, CR-7).** `globalKeyProblem` (`src/common/globalKeys.ts`) refuses Ctrl+Alt with a letter, digit,
  sign or Space, with or without Shift: Windows reports AltGr as Ctrl+Alt, so a registered Ctrl+Alt+2 would take every
  @ typed on a Belgian AZERTY keyboard (AltGr+é) from Discord and other programs. Ctrl+Alt with an F key, an arrow or
  Page Up/Down is still allowed, and the suggestion in every refusal is now "F9 or Ctrl+Shift+N". CR-7: an F4 with
  Ctrl or Alt (Alt+F4, Ctrl+F4) is refused too, because it closes windows and tabs in every program.
- **Drop tray (CR-8).** A drag cancelled with Esc is stopped on the document in the capture phase, so no drop place
  takes it (`src/lyre/screens/drop/DropTray.tsx`). That also kept it from the document's drop guard (SEC-7), so for
  the rest of that drag the browser's own handling applied. The cancelled branch now does what the guard does:
  `preventDefault()` and `dropEffect = "none"`. `DropTray.test.tsx` checks it with the real guard installed. The main
  process's `will-navigate` lock still stops any navigation behind it.
- **This computer's settings (CR-9).** `settings.setComputer` used `Object.assign` to merge the page's `display` and
  `devices` into `this-computer.json`, and its argument shape let extra keys through, so a faulty page could save any
  key there (a `__proto__` key would even replace the object's prototype). Its shape in
  `src/main/lyreApi/argChecks.ts` now uses `exactObject`, which refuses any key it does not list, and
  `libraryApiRound7.ts` copies only `density`, `textSize`, `highContrast`, `airDevice`, `previewDevice`, `split` and
  `previewEar` (`copyKnown`). `argChecks.test.ts` checks both.

### Channels

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `REMOTE_MOVE_OLD_SETTING` (send) | Main window | one object exactly `{ enabled: boolean, address: text ≤ 64, port: text ≤ 5 }` (`isOldRemoteSetting`); taken once | `PlayerManager` → `RemoteControl.moveOldSetting` |
| `PLAYER_START_REMOTE`, `PLAYER_STOP_REMOTE` | removed | | |

### Tests

| Test | Covers |
|---|---|
| `src/main/remote/remoteSettings.test.ts`, `homeNetwork.test.ts` | 0.0.0.0, ::, internet, loopback other than 127.0.0.1 and not-this-computer addresses refused; saved ones put back; the one-time move of the old setting |
| `src/main/remote/remoteControl.test.ts` | A saved home-network address the computer no longer has is not listened on, with the reason |
| `src/main/managers/PlayerManager.test.ts` | `REMOTE_SET` refuses 0.0.0.0, :: and an internet address; the old Start Remote message does nothing; the old setting moves once, from the main window only, address checked |
| `src/renderer/features/settings/remoteMigration.test.ts`, `Settings.test.tsx` | Version 7 hands the old values over once and drops them; the old panel has no Address, Port or Start Remote and calls nothing remote |
| `e2e/remote.spec.ts`, `e2e/settings.spec.ts`, `e2e/persistence.spec.ts` | The packaged app: the old panel points to Lyre's Settings; the remote is turned on and off through Lyre's bridge; a main-window setting other than the old port survives a restart |

### Manual checks (Windows)

1. Upgrade from 0.4.1 with Remote on in the main window's Settings (127.0.0.1, port 3333): after the first start of
   the new version, Lyre › Settings › Remote control shows it on, This computer only, port 3333. Turn it off there and
   restart Lyre twice: it stays off.
2. Lyre › Settings › Remote control › Your home network: the address shown is this computer's 192.168.x.x. Then
   `netstat -ano | findstr :3333` lists that address only, never 0.0.0.0.
3. Settings › Keyboard shortcuts: give Next scene Ctrl+Alt+2 and turn on "in other programs too": it is refused,
   naming AltGr. Give Fade everything out Alt+F4: refused. Give Next scene Ctrl+Shift+N: accepted; in Discord, AltGr+é
   still types @.

## w51-main

0.5.1 (FND-16): the old main window and the old Player are gone; the window's own page is the Lyre page.

### Roles and pages

- The window loads the Lyre page with Lyre's preload; `src/index.ts` registers it as `lyre-view` and pins it to its own
  document (`lockAppPage`). Links it opens go to the system browser, https only (`openExternalIfAllowed`); no other
  window is ever opened.
- `player-view` is gone (its clipboard permission and speaker-selection check with it; `lyre-view` keeps
  speaker-selection as a check only). `main-window` stays in `AppPageRole` but no page has it: the website-tab,
  local-file and device-capture code kept for OUT-12 listens only on channels from it, so nothing can reach that
  code. `src/main/security/keptForLater.test.ts` checks this (no such channel from `lyre-view`, nothing makes
  `BrowserViewManagerMain`, `src/index.ts` trusts its window as `lyre-view`).
- The app pages are the Lyre page and the capture window; `appPageCsp.test.ts` pins both policies.
- Remote control: no server listens (RemoteOff). `remote-control.json` from an older version is never read.
- The one-time moves read the old storage (`persist:root`, `persist:player`) in an isolated world of the Lyre page
  (`legacy/pageStorage.ts`, world 1999), so the page's scripts cannot change what is read. A plain token found there
  goes straight to `OutputManager.importLegacyToken` (kept encrypted, SEC-5); `old-window.json` never holds it. Once
  it is saved encrypted, its plain copy is taken out of `persist:root` in the same world (w51-rev, CR51-1).

### Channels

| Channel | Sent by | Arguments | Handled in |
|---|---|---|---|
| `LYRE_BOT_LEGACY_NOTE_SEEN` (send) | Lyre page | none | `LyreOutputsBridge` → `OutputManager.legacyTokenNoteSeen` (remembered in `old-window.json`) |
| `UPDATE_RESTART` (send) | Lyre page | none; acted on only while an update is ready | `LyreManager` → `autoUpdater.quitAndInstall` |
| `LYRE_TITLE_BAR` (send) | Lyre page | one object exactly `{ color, symbolColor }`, each `#rrggbb` (`isTitleBarColours`) | `WindowFrame` → `setTitleBarOverlay` (height fixed at 36) |
| `LYRE_WINDOW_MAXIMISE` (send) | Lyre page | none | `WindowFrame` (maximise or put back) |
| `LYRE_EMPTY_AUDIO_CACHE` (invoke) | Lyre page | none | `appInfoIpc.ts` → the library's audio cache only (website data is no longer cleared from the page) |
| `REMOTE_GET`, `REMOTE_NEW_CODE` (invoke) | Lyre page | none | `RemoteOff`: an "off" state, no code |
| `REMOTE_SET` (invoke) | Lyre page | as before (`isRemoteChange`) | `RemoteOff`: refused, "Remote control returns with Stream Deck support." |
| removed: `GET_VERSION`, `GET_PLATFORM`, `CLEAR_CACHE`, `WINDOW_*`, `LYRE_GET_URL`, `WINDOW_SETTINGS_STATE`, `LYRE_WINDOW_SETTINGS_*`, `LYRE_LOCAL_FOLDERS_*`, `LYRE_CLEAR_WEBSITE_DATA`, `REMOTE_MOVE_OLD_SETTING`, `AUDIO_CAPTURE_SET_STREAMING_MODE`, `OUTPUTS_*`, `BOT_*`, `OUTPUT_SET_MUTED`, `ROOM_SET_VOLUME`, `PLAYER_*` | | | |
| kept, unreachable (from `main-window` only): `BROWSER_VIEW_*`, `LOCAL_FILES_*`, `AUDIO_CAPTURE_*` | | | |

`MEDIA_PREPARE` is from `lyre-view` only. `BROWSER_VIEW_CREATE_BROWSER_VIEW` takes no kind: website tabs only.

### Tests

| Test | Covers |
|---|---|
| `src/index.test.ts` | The window is the Lyre page with Lyre's preload, trusted as `lyre-view`; https links to the system browser; no frame of its own (titleBarOverlay 36 px); bots log in once when it shows |
| `src/main/window/windowFrame.test.ts`, `src/lyre/window/*.test.tsx` | Colours exactly `#rrggbb`; maximise only from the Lyre page; double-click only on a strip's empty part |
| `src/main/remote/remoteOff.test.ts` | Off state, refusal in plain words, Lyre page only |
| `src/main/legacy/oldWindowMove.test.ts`, `src/main/data/import/legacyCatchUp.test.ts` | One-time move: token never written, bookmarks bounded and one line each, damaged storage tolerated; catch-up doubles nothing |
| `src/main/security/keptForLater.test.ts` | The kept code stays unreachable |
| `e2e/lyre.spec.ts`, `e2e/upgrade.spec.ts` | Protections of the Lyre page as the window; links leave for the browser; a Kenku FM user's token moves and logs in, its plain copy leaves the old storage (w51-rev) |

### Manual checks (Windows)

1. Settings: no Remote control box. `netstat -ano | findstr :3333` lists nothing.
2. Add a bot › Open the Discord Developer Portal opens the default browser, not a Lyre window.

## 0.5.1: audio stutter fixes (w51-audio)

### In plain language

Nothing new can reach Lyre from outside. The sound for each room, and the preview, now travels between two of Lyre's
own windows over a private line of its own instead of sharing the existing private line with other messages. Lyre's
page plays a level far below hearing (about -144 dB) into the speakers while it broadcasts or previews, so Windows
keeps it on the sound card's clock; nothing can be heard.

### Technical details

- Two new messages on the private player channel (OUT-5, PRV-1), player page to capture window only:
  `{ kind: "room-frames", room, port }` and `{ kind: "preview-frames", port }` (`src/common/playerAudio.ts`). `room`
  passes the same check as before (1 to 64 characters); `port` must be a MessagePort (anything else drops the
  message). The port is one end of a `MessageChannel` the Lyre page made; its other end is in the page's own
  AudioWorklet. Every message on it must be what `framesFrom` accepts (an array of 1 to 10 frames, each a whole
  frame index and a Float32Array of 1,920 samples); anything else is ignored. Frames from a room's port go only to
  that room, through the same `_playRoomFrame` checks as before (only while broadcasting, only a room the capture
  window has, never "This Computer"). A port is closed when a newer one comes for the same room, the broadcast
  stops or the player channel is replaced; the Lyre page closes its end when it lets a room go.
- `AUDIO_CAPTURE_TIMING`: main process to capture window (`webContents.send`, no arguments, not in `IPC_CHANNELS`);
  the capture window writes its frame counts to its console. Nothing is sent back over IPC.
- The Lyre page's preview context no longer has `sinkId: { type: "none" }`; it opens the default output device like
  the engine's context. No preview node is connected to it except through the tap; the Lyre page is never
  tab-captured (role `lyre-view`).
- No new permission, no Content-Security-Policy change.

## 0.5.1: review fixes (w51-rev)

Fixes for the independent code and security review of 0.5.1 (CR51-1 to CR51-11).

### In plain language

- If Lyre is closed while it brings in what the old Player gained since your first start, nothing is half done: the
  next start brings it all in, once. Files from folders your library does not use are left out and named, so you can
  add their folder.
- A bot token Kenku FM kept unprotected is deleted from Lyre's own storage as soon as Lyre has saved it encrypted, as
  0.5.0 did. If saving fails, the unprotected copy stays and Lyre tries again at the next start. On a computer that
  cannot encrypt (some Linux set-ups) it stays, and Settings says so.

### Technical details

- CR51-1, CR51-6: `moveOldWindowDataOnce` hands over only a value that passes `isBotToken`. `importLegacyToken`
  answers `saved` (encrypted and written; `BotTokenStore.setToken` now answers false when the file could not be
  written), `session-only` (no keyring), `not-saved` (the write failed) or `kept-own` (the first bot had a token). On
  `saved` and `kept-own` the move puts `withoutPlainToken(raw)` in place of `persist:root` (no `discordToken`, no
  `multipleOutputsEnabled`, the rest as stored) with `replacePageStorage`, which writes in world 1999 only while the
  stored text is still what was read. On `not-saved`, or when the write did not happen, nothing is recorded and the
  move runs again at the next start. `tokenMoved` (the Settings note) is true only for `saved` and `session-only`.
  Chromium's LevelDB may keep the old value in its log until it compacts it, so the note still recommends a new token.
- CR51-2: the catch-up (`catchUpLegacyLibrary`) reads every new file first, then saves the new tracks, the new
  playlists and boards, the additions and its `done` record in one transaction. A stop part-way commits nothing; the
  next start makes the same plan and does it all once.
- CR51-11: the catch-up takes a new file only when it lies under a library folder or the folder of a track already in
  the library (`foldersInUse`, the same folders the player may read, `mediaFolders`). Any other file named in
  `persist:player` is left out and named in the report (`leftOut`), so a path planted there cannot open another
  folder to `MEDIA_PREPARE` and `lyre-media:`. A playlist made only of files the library has is still named, not
  brought back (the library cannot tell it from one removed in Lyre).
- CR51-3: at start only `lyre-media:` is declared privileged (`registerAppSchemes()`) and only the default session
  gets handlers (`secureSessions()`). The kept website-tab and local-file code registers nothing: no
  `cue-local-file:` scheme, and the `persist:tabs` and `persist:local-files` sessions are not opened. OUT-12 turns
  them on with `registerAppSchemes({ websiteTabs: true })` and `secureKeptSessions()` (docs/ARCHITECTURE.md › Kept
  for later).
- Test builds only: `CUE_DESK_FAKE_KEYRING=1` saves tokens with a reversible, marked stand-in
  (`src/main/broadcast/testing/fakeKeyring.ts`), so end-to-end tests on a machine without a keyring can restart with
  a saved bot. Release builds compile it out (`__CUE_DESK_TEST_BUILD__`).

### Tests

| Test | Covers |
|---|---|
| `src/main/legacy/oldWindowMove.test.ts` | The plain token leaves `persist:root` only after it is saved encrypted; a failed save, a failed delete and a page that has gone leave it and record nothing; no keyring leaves it; a value not shaped like a token is not handed over |
| `src/main/data/import/legacyCatchUp.test.ts` | A catch-up stopped at any write finishes at the next start, nothing doubled, recorded once; a file outside the library's folders is left out and named; one under a library folder or a known folder comes in |
| `src/main/security/sessions.test.ts`, `keptForLater.test.ts`, `src/index.test.ts` | At start: one privileged scheme (`lyre-media`), no partition opened; the kept sessions' handlers only through `secureKeptSessions` |
| `src/main/broadcast/OutputManager.test.ts`, `botTokenStore.test.ts` | What `importLegacyToken` answers; a token whose file could not be written is not "remembered" |
| `src/main/managers/SessionManager.test.ts` | The compare-and-write script in the isolated world |
| `e2e/upgrade.spec.ts` | In the packaged app: the plain token leaves the old storage and the rest stays; a saved bot logs in at the next start without Connect |
