# Security in Kenku FM

## In plain language

Kenku FM opens websites (YouTube, Tabletop Audio, Spotify and so on) in tabs inside the app. Those websites are run by other people, so Kenku FM keeps them apart from its own pages and gives them as little access as possible.

**What a tab can open.** Only ordinary web pages, meaning addresses that start with `https://` or `http://`. If you type `youtube.com`, Kenku FM adds `https://` for you. Kenku FM will not open files on your computer (`file:`), browser settings pages, scripts typed into the address bar (`javascript:`) or links that launch other programs (`steam:`, `spotify:`, `mailto:` and similar). An address with a user name or password in it (`https://name:password@site`) is also refused; log in on the page instead. When an address is refused, Kenku FM shows a short message under the address bar or the bookmark's address field explaining why, and nothing is opened.

`http://` pages still open, but they are not encrypted. Prefer `https://` when a site offers it.

**Pop-ups.** When a website opens a new window, Kenku FM opens it as a new tab instead, but only if the address is allowed, and at most 3 new tabs from the same tab every 10 seconds. Anything beyond that is ignored.

**Microphone, camera and other permissions.** Websites in tabs cannot use your microphone or camera, show notifications, see your location, or open other programs. They can still go full screen and play protected music. Kenku FM's own pages may use audio devices only, which they need to send sound to Discord and to list your input devices.

**Logins.** Websites in tabs keep their own cookies and logins, separate from Kenku FM's settings. After updating to this version you will need to log in to websites again once. "Clear cache" in Settings now clears website data as well.

**Links to help pages.** Links in Kenku FM (for example "Where do I get my token?") open in your normal web browser, but only if they are `https://` links. Other kinds of link are ignored.

**Your audio stays on your computer.** The connection that carries sound from tabs to Discord accepts connections from your own computer only, so other devices on your network cannot send audio into your Discord channel.

**Dragging files.** Dropping a file onto Kenku FM outside a drop zone does nothing. Drop zones (adding tracks, sounds or images) work as before.

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

`checkTabUrl(raw)` parses with the WHATWG `URL` parser (so case, surrounding whitespace, embedded tabs/newlines and IDN hosts are normalised exactly as Chromium does) and returns `{ ok: true, url, insecure }` or `{ ok: false, code, reason }`. Allowed: `https:` and `http:` (`insecure: true`) with a non-empty host and no username or password. Everything else is refused, including `about:blank`, which the app does not rely on: a new empty tab is simply not loaded. `checkExternalUrl(raw)` allows `https:` only. `checkTypedTabUrl(raw)` applies `prependHttp` first and is what the URL bar and bookmark editor use. Use `isRefused(result)` to branch, because the project's `tsconfig` does not narrow on `ok`.

Enforced in the main process (`BrowserViewManagerMain`) on every path into a tab: view creation, `BROWSER_VIEW_LOAD_URL`, `setWindowOpenHandler` (popups become tabs only if allowed and within `POPUP_LIMIT`), and `will-navigate` / `will-redirect` on the tab's main frame. The renderer checks are for user feedback only; the main process is the boundary. Refusals from the main process are reported on the main window's `ERROR` channel.

### Permissions

`setPermissionRequestHandler` and `setPermissionCheckHandler` are installed on the default session and on the tab partition, and both call `isPermissionAllowed`. Deny by default.

| Caller | Allowed |
|---|---|
| Main window (`main-window`) | `media`, audio only (input device names for external inputs) |
| Audio capture window (`audio-capture`) | `media`, audio only (tab capture and external inputs) |
| Player view (`player-view`) | `clipboard-sanitized-write` (copy ids for Kenku Remote) |
| Any website tab, or any frame inside an app page | `fullscreen`, `mediaKeySystem` |

App pages are identified by web-contents id in `trustedContents`, registered by `lockAppPage` (main window in `src/index.ts`, capture window in `AudioCaptureManagerMain`) and by `BrowserViewManagerMain` for the player view. The player view is recognised only when both the URL and the preload match `PLAYER_WINDOW_WEBPACK_ENTRY` and `PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY`; any other preload is refused (`REFUSED_VIEW_ID`, -1).

Website tabs use the `persist:tabs` partition (`TAB_PARTITION`) with no preload. App pages use the default session. The Google sign-in user-agent workaround is applied to both sessions.

### Navigation guards

`lockAppPage` cancels `will-navigate` on the main window, capture window and player view unless only the `#fragment` changes, and denies every `window.open`. The main window passes `https` links to `shell.openExternal` through `openExternalIfAllowed`; the player view turns allowed links into new tabs. The renderer and player also install `installDocumentDropGuard(document)` so drops outside drop zones are cancelled.

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
7. From another computer on the same network, the audio socket port (shown with `netstat` or `lsof` on the Kenku FM process) refuses connections.
