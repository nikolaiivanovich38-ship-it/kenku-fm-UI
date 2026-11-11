# Testing

## Playback characterisation tests

These tests record how playlist and soundboard playback behave today. The playback engine is due to be rewritten in WP4, and these tests are the specification for that rewrite: a rewrite that keeps them green behaves the same for the user. Where a test pins a known bug, its name says so and it is marked `it.fails`. When that bug is fixed, change the test to a normal `it`.

Design round 7 (`design/prototype/ROUND7.md`) added a `round 7` block to the settings, playlists, pad boards, session planner, library, audio profile and campaigns spec files, two new files, and two sweeps. `tags.spec.ts` covers the Tags screen (`#/tags`, the `tags` screen: groups in order, rename, merge and delete with Undo, tags inside tags, other words, colours, a new group on every track) and is marked by its screen; `look.spec.ts` covers Look and feel's Display (density, text size to 200 % without sideways scroll, high contrast at 7:1) and A11Y-6 (reduced motion, targets of 24 px or with 24 px of space). The sweeps add the Tags screen and, per screen at 960 and 1920, UX-6: every name cut short has its full text on hover, and focus shows it. Every other round 7 check calls `expectFailureUntilBuilt("round 7")`: Settings' remote control code, headphones and speakers, crossfade and keys; folders, dividers, the drop tray and Add to…; a scene's and a pad's steps and a scene that moves on by itself; a track's behaviour and follow-with; mix out and playing from a marker; What played and Find and play (Ctrl+K). Settings' Sound to Discord is now folded, so the check that reads it unfolds it first; two exact-menu checks of built screens ignore the round 7 menu items (Tags and groups…, Move to folder…). The prototype keeps its data in the page, so a check that needs a change to survive goes to the next screen by the menu, not `openRoute`.

### Running them

From the project folder:

```
yarn test                                        # every test
yarn test src/player/features/playlists          # playlist tests only
yarn test src/player/features/soundboards        # soundboard tests only
yarn test:coverage                               # with a coverage report in coverage/index.html
```

No audio is played. `howler` is replaced by a fake (`src/player/test/fakeHowler.ts`) that records every call and lets a test fire Howler's events ("load", "play", "end", "fade", "loaderror") by hand. Timers are faked, so a 10-second sound with a 100 ms fade-out is tested in milliseconds.

### What each file pins

| Test file | What it covers |
| --- | --- |
| `playlists/playlistsSlice.test.ts` | Playlist library: add/remove/edit playlists and tracks, new tracks added at the top, drag-to-reorder, edits without an id throw. |
| `playlists/playlistPlaybackSlice.test.ts` | Queue logic: starting a queue (shuffled and not), turning shuffle on/off keeps the current track, reordering, removing a track before/at/after the current one, adding tracks keeps the current track, and the transport state (play, stop, volume, mute, repeat). Shuffle is replaced by "reverse the list", so orders are exact. |
| `playlists/usePlaylistPlayback.test.tsx` | Next, previous and "track ended" for every combination of repeat (off/track/playlist) and shuffle, including wrap-around at both ends; "previous" restarts the track when more than 5 s in; the fixed 1000 ms cross-fade on a track change and unloading of the old track; errors show "Unable to play track: &lt;title&gt;". |
| `soundboards/soundboardsSlice.test.ts`, `soundboardPlaybackSlice.test.ts` | Soundboard library and the list of sounds currently playing. |
| `soundboards/Sound.test.ts` | One sound's fades and loops for every fade-in/fade-out/loop combination, the cross-faded loop releasing its audio (500 loops), stop with and without fade, and seek moving the fade-out point. PERF-7: a sound without fades streams until it is known to be 30 s or shorter, and only then is decoded whole. |
| `soundboards/soundLengths.test.ts` | PERF-7: the remembered sound lengths (30 s limit, kept across restarts in localStorage, oldest forgotten beyond 2,000, storage that refuses or holds rubbish). |
| `soundboards/useSoundboardPlayback.test.tsx` | Playing, stopping, seeking; a non-looping sound is removed when it ends; errors show "Unable to play sound: &lt;title&gt;". |

The navigation logic in `usePlaylistPlayback.ts` exists three times (in `next`, `previous` and the track-end handler). The navigation table in its test file runs the same cases through all three, so WP4 can merge them into one function and check nothing changed. They differ in one place: with repeat "track", the end handler restarts the track by calling `play()`, while next/previous only seek to 0.

### Known bugs these tests document

- **QUEUE-1** (`playlistPlaybackSlice.test.ts`): with shuffle off, removing a track from the playing playlist could make a different track "current", because `removeTrackFromQueue` always walked the shuffled order. Fixed in 0.5.0 (BUG-11); the test is a normal test now, with three more for removing the current and a later track and for the shuffled order that remains.
- Characterisation only, not marked as bugs: `startQueue` with a track id that is not in the list gives `current: -1`; removing the current track when it is last in the shuffled order also gives `current: -1`.

### Helpers for new tests

- `src/player/test/fakeHowler.ts`: use it with `vi.mock("howler", () => import("../../test/fakeHowler"))`. `FakeHowl.instances` lists every Howl created; `FakeHowl.reset()` belongs in `beforeEach`.
- `src/player/test/createPlayerStore.ts`: a Redux store with the real reducers and no saving to disk, for hook and component tests.

## End-to-end checks of Kenku FM's features

These Playwright tests start the packaged app and use it the way a person would, to show it still does everything Kenku FM did. How to build and run them: `docs/DEVELOPING.md` > End-to-end tests.

| Spec file | What it covers |
| --- | --- |
| `e2e/smoke.spec.ts` | The app starts with its main window and player; nothing fails at start-up; the problem check itself notices a Content-Security-Policy refusal. |
| `e2e/playlists.spec.ts` | Create, rename and delete a playlist; add two tracks from disk; play one and see the time move; pause and resume; next and previous with wrap-around (repeat starts as "playlist"); repeat track keeps a short track going and repeat off lets it end; shuffle on/off; volume slider, mute and unmute; edit and delete a track (deleting the playing track stops playback); play a playlist from its card on the home page; a picture from disk as a custom background. |
| `e2e/soundboards.spec.ts` | Create a soundboard; add a sound without fades (Web Audio) and one with fades (audio element); play once and see it end by itself; stop early; loop with cross-fades and with Howler's own loop; stop from the player bar; sound volume; edit name and fade; delete a sound and the soundboard. |
| `e2e/persistence.spec.ts` | Playlists, tracks, soundboards, sound loop setting, bookmarks, player volume and repeat, and the remote port survive quitting and restarting with the same data folder; the restored track still plays. |
| `e2e/tabs.spec.ts` | Open a local web page from the address bar, follow a link, Back, Forward, Reload, close the tab; bookmark a page, open the bookmark, edit it (a refused address keeps the dialog open), delete it; `file:///etc/passwd` in the address bar shows a message and opens nothing. |
| `e2e/settings.spec.ts` | Token field and "Where do I get my token?" link (opens in the system browser); a bad token ends in "Error connecting to bot: …" and the form is usable again; Clear Cache removes website cookies; the version number is shown. One test is marked as an expected failure (see below). |
| `e2e/remote.spec.ts` | Remote switched on in Settings on a free port; `GET /v1/playlist`, `PUT /v1/playlist/play` (track and playlist), `GET /v1/playlist/playback`, `PUT /v1/playlist/playback/pause` and `/play`, `GET /v1/soundboard`, `PUT /v1/soundboard/play`, `GET /v1/soundboard/playback`, `PUT /v1/soundboard/stop`, each checked against the player, all with the secret code read through the Lyre page (SEC-4); without it 401, from a web page or a web name 403, text/plain 415, and no `file:` address in answers; switching it off closes the port. |
| `e2e/carryOver.spec.ts` | FND-1: a library made in `<appData>/Kenku FM` appears in Lyre on its first normal start, the carry-over record says "copied", and later changes in Lyre leave the Kenku FM library alone; with libraries in both `<appData>/cue-desk` and `<appData>/Kenku FM`, Lyre takes Cue Desk's (Linux only, where `XDG_CONFIG_HOME` moves appData). |
| `e2e/capture.spec.ts` | Tab audio capture for Discord (SEC-3). |
| `e2e/backgrounds.spec.ts` | Built-in background pictures: the Add Playlist dialog offers the 23 pictures under Kenku FM's names plus "blank", and they load from the app itself (1600 px wide JPEGs, not files in the data folder, which gets no `backgrounds` folder); a library saved with a playlist on "tavern" and a soundboard on "butterflys" shows the bundled pictures on both cards after a restart, and the open playlist shows the same picture behind its page. |
| `e2e/engine.spec.ts` | WP4 playback engine in real Chromium, through the test-build hook `window.__cueDeskEngineTest`: a streamed WAV on the music bus is heard on the music bus and the table mix and nowhere else; a short sound is read from `file://` and decoded to a buffer; a preview is heard on the preview output only (PRV-1); a whisper on the whisper output only (OUT-5); stop all silences every output; a missing file fails with a message. Levels are measured with AnalyserNodes. |

| `e2e/capture.spec.ts` | Tab audio capture for Discord (SEC-3): the player cannot be captured outside a broadcast and is captured when it plays during one; a website tab is captured when it plays during a broadcast, and the captured site still cannot record the screen or desktop audio. |
| `e2e/onScreen.spec.ts` | Wave 1 UX findings 1, 4, 7, 8, 10: the "Add a second bot" guide, the Settings panel, the Mode list and the bookmark folder menu are on screen at 800 × 600 and 1920 × 1080, checked against where the main process draws the website and player views (`fixtures/screen.ts`), not only in the page; Settings is 320 px at 800 px and 440 px at 1920 px, with the player beside it and no text cut off; a missing file is explained in the sidebar (and beside the collapsed sidebar), opens no tab, and the message closes once a page opens. |
| `e2e/keyboard.spec.ts` | Wave 1 UX findings 2, 3, 12: a gold focus outline is drawn around focused controls (counted in a screenshot) and not after a click; Enter and Space press a tab's Bookmark and Close buttons; a tab (Left/Right) and a bookmark (Up/Down) move with the keyboard from their handle, and screen readers hear their names and new positions; Move to folder… and Delete folder from the keyboard, with focus moving to the next bookmark. |
| `e2e/outputs.spec.ts` | WP2 SEC-5/OUT-1 (fake Discord): a typed bot token never appears in `persist:root` or anywhere in the data folder (UTF-8 or UTF-16), and survives a restart only where it can be encrypted (otherwise Settings says it is kept for the session); a token saved by an older version is moved out of browser storage and the bot connects with no action; the "Add a second bot" guide and its Developer Portal link; two bots in two channels of one server both receive audio, and muting one stops only its audio; OUT-2: the status chip reads Ready, Connected, Reconnecting… (fake network drop, then back by itself) and Error with a plain reason that stays after the message box is closed, with a Reconnect button; BUG-6/BUG-7: a refused channel is explained, and leaving a Stage channel closes its connection. Wave 1 UX: a refused token is explained in plain words, not kept, Enter connects, and the message closes once a good token connects; the reconnect wait counts down and "Try now" reconnects at once; the collapsed sidebar shows each output's status and mutes it; why This Computer switched off. |
| `e2e/broadcast.spec.ts` | WP2 (fake Discord, `e2e/fixtures/discord.ts`): nothing is recorded before an output joins a voice channel, joining starts recording and leaving stops it; the start of a sound (Web Audio and an audio element, a tone whose volume rises evenly) is missed by about 100 ms at most (median of three; typical 15-40 ms); the delay from a tab's sound to Discord is under 250 ms in both streaming modes (PERF-8; measured ~120-140 ms, "performance" mode used to add half a second). |

Every test also fails if any page logged a console error, threw an uncaught error, broke a Content-Security-Policy rule or was refused by the IPC guard, or if the main process crashed (`e2e/fixtures/problems.ts`).

### Known issues these tests document

- Fixed during WP1: error messages used to sit at the bottom left, over the Settings panel's Done button, and were hidden from screen readers while Settings was open. Wave 1 UX fixes moved them into the sidebar's layout (or the Settings panel while it is open), where website views cannot cover them and they cover nothing; `settings.spec.ts` and `onScreen.spec.ts` check this.
- The shuffle button does not say whether shuffle is on (no `aria-pressed`); the test reads the icon colour. The custom-background address field's label is on its wrapper, not on the input.
- Closing a website tab while its capture is still starting no longer logs "Unable to start stream for web view" (fixed in WP1); `tabs.spec.ts` still waits briefly before closing tabs.

## Current player fixes (WPL)

Fixes to the current player (`src/player`), which the new interface replaces later.

| Test file | What it covers |
| --- | --- |
| `features/idleWakeUps.test.tsx` | PERF-1: counts every timer and animation-frame callback (`test/countWakeUps.ts`) over a minute of fake time with both playback hooks mounted. Before: 3,750 a minute with nothing played, 7,500 with a track paused or playing. Now: none when idle (at most one last tick after a pause or stop), one a second while a track plays. These are wake-up counts, not CPU: PERF-1's "idle CPU measured before/after" has not been done yet (a manual check on Windows: Task Manager's CPU column for Cue Desk with nothing playing, before and after this change). |
| `features/remoteListeners.test.tsx` | PERF-1: the remote API listeners are registered once (before: 311 re-registrations in one minute of playback) and still answer with the current state and call the current callbacks. |
| `app/throttledStorage.test.ts`, `app/store.test.ts`, `app/saveErrors.test.tsx` | PERF-6: while the mouse button or a key is held (a slider drag), the library and player settings are saved at most once every 500 ms, and the final value as soon as the user lets go (or the page loses focus, is hidden or reloads, or the main process asks before closing the window). Other changes are saved at once, as before. Before: 100 saves for a 3-second, 100-step drag; now at most 7. A save that fails shows "Your changes could not be saved: &lt;reason&gt;. They will be retried." once per run of failures, and is tried again with the next change. |
| `src/main/saveBeforeClose.test.ts`, `src/main/managers/PlayerManager.test.ts` ("saving the player's changes") | PERF-6: the first quit (held at `before-quit`, before any window closes) or the main window's first close is held until the player answers `PLAYER_SAVE_NOW` with `PLAYER_SAVED` (only the registered player view's answer counts), or 1 second has passed; then the quit or close is repeated. |
| `playlists/usePlaylistPlayback.test.tsx` ("deleting the playing track"), `playlists/TrackItem.test.tsx` | BUG-8: deleting the playing track, or its playlist, stops and unloads it and clears the player bar; the play key cannot resume it. The queue keeps the deleted track's place (`queue.removedCurrent`): Next and Previous (player bar, media keys, remote) play the entry after or before it, in shuffled order when shuffle is on, wrapping round with repeat "playlist" and doing nothing at the ends with repeat "off". A track still loading after a skip carries on; a track deleted while it is still loading never plays, and the track it was about to replace keeps playing. |

End-to-end: `playlists.spec.ts` also checks that the player bar shows no title, time or media-key metadata after the playing track is deleted and that Next then plays the remaining track; `persistence.spec.ts` checks that a volume change and a rename made just before quitting are kept, and that a volume change made while the key is still held down when the app quits is kept.

Saving is not delayed outside a held button or key because Electron destroys the player view without running its `pagehide` or `beforeunload` handlers when the app quits (`BrowserViewManagerMain.removeAllBrowserViews` closes and destroys at once), so a held-back save would be lost. For a change held back at the moment of closing, `src/index.ts` holds the first quit, or the main window's first close (`src/main/saveBeforeClose.ts`), and `PlayerManager.saveBeforeClose` asks the player to save first. The quit is held at `before-quit` because holding a window's `close` during a quit cancels the quit, and Electron then does not close that window again when the quit is repeated (the app never exited). A crash of the main process can still lose up to 500 ms of slider movement.

BUG-11 (QUEUE-1) was fixed in 0.5.0: `removeTrackFromQueue` reads "current" in the playlist's order when shuffle is off. The BUG-8 fix never relied on it: after the playing track is deleted, `usePlaylistPlayback` works out the queue position itself from the queue as it was before the deletion.

## Library database tests

`src/main/data` (WP3) has its own unit tests, listed in `docs/data-model.md` > Tests. They run in Node with `node:sqlite` and temporary folders. `src/main/data/performance.test.ts` builds a 20,000-track library (about 15 seconds) and checks the open, search and edit targets; set `CUE_DESK_SKIP_PERF=1` to skip it on a slow machine, and `CUE_DESK_PERF_REPORT=<file>` to save the measured numbers.

## Playback engine tests (WP4)

The new engine in `src/player/engine` is tested without a browser: `testing/fakeAudio.ts` is a fake Web Audio context with media elements and one clock for audio time and timers. It records every node and connection, follows gain automation, and `signalAt(node)` multiplies gains along every path from the sources that are sounding, so a test can "listen" to a bus or an output. `advance(seconds)` plays a session forward in milliseconds; `testing/seededRandom.ts` makes shuffles repeatable.

| Test file | What it covers |
| --- | --- |
| `queue/queue.test.ts` | One rule table for next, previous and track end (the same cases as the old navigation table, repeat "track"/"playlist" now "one"/"all"); previous restarts after 5 s; shuffle without immediate repeats, reshuffled each round; BUG-11: removing an entry before, at or after the current one with shuffle off keeps the right current entry; reorder and insert keep the current entry and leave a shuffled order stable. |
| `graph/mixer.test.ts` | Buses, master and outputs: table = music + ambience + effects through the master; whisper and preview reach only their own outputs; levels, mute, save and restore. |
| `voice/voice.test.ts` | For both decoded and streamed sources: fade in, fade out before the end, cross-faded and native loops, seek moving the fade-out (BUG-5), pause, stop with and without a fade, errors; BUG-4: 1,000 play/stop cycles and 500 loop passes leave no node, media element, listener or timer behind. |
| `engine.test.ts` | Routing by bus, fade all and stop all, events, the progress ticker running only while something plays (PERF-1), playing addresses through the loader. |
| `sources/*.test.ts` | Stream or decode (PERF-7), the LRU buffer cache with its memory cap, the resolver hook for PLY-11 and BUG-10, reading small files with early give-up. |

The old player's characterisation tests stay as they are until WP5 moves the player onto the engine. The QUEUE-1 test in `playlistPlaybackSlice.test.ts` passes since 0.5.0 (BUG-11 fixed in the old player too); the engine's queue has its own fix (`queue.test.ts`, "remove (BUG-11)").

## WP2 Tabs

| Spec file | What it covers |
| --- | --- |
| `e2e/localFiles.spec.ts` | SEC-15: a file typed in the address bar is asked about once, with its full path, and opens in the `persist:local-files` partition in place of the empty tab; Cancel opens nothing and shows no error; a remembered folder opens without asking (also from a bookmark), is listed in Settings > Local files and can be forgotten; a web page cannot open, link to, pop up or jump to a file. The native question is replaced in the main process by a stand-in, because Playwright cannot click native dialogs. |
| `e2e/screenCapture.spec.ts` | SEC-16: the main window and the capture window get `NotAllowedError` for screen capture. |
| `e2e/hiddenTabs.spec.ts` | A hidden website tab that plays keeps playing (audible, its audio clock keeps real time). Replaces `tabSleep.spec.ts`: the PERF-5 throttling was removed after the WP1 security review. |
| `e2e/bookmarkFolders.spec.ts` | UX-10: create a folder, move a bookmark with "Move to folder…" and another by dragging it (held by its site icon) onto the folder, close the folder with the keyboard, rename it; collapse the sidebar, open a bookmark from a folder icon and see the website view move to the collapsed edge; folders and the collapsed sidebar survive a restart; deleting a folder keeps its bookmarks; Settings opened from the collapsed sidebar expands it. |

`e2e/tabs.spec.ts` now checks that a file on a network share is refused (a file on this computer is asked about instead), and the bookmark editor test uses `javascript:` as its refused address.

Found during WP2: holding a bookmark or tab by its site icon started the browser's own image drag, so the bookmark or tab could not be dragged. The icons are no longer draggable on their own.

## WP1 security fixes

The tests for the wave 1 security review (findings 1 to 12) are listed in `docs/security.md` > WP1 security fixes > Tests. Each was seen to fail before its fix (the end-to-end ones against a package built from the code before the fix). `e2e/localFiles.spec.ts` gained three tests (a file reads only its own folder and cannot reach the web; a captured file tab cannot record the screen; a web page's links, popups and redirects to files and to an open file's own address), `e2e/outputs.spec.ts`'s migration test now checks the reset notice and records where the old token is left on disk.

`e2e/fixtures/problems.ts` has a new list, `errors.expectedRefusals` (`{ page, text }` patterns): a security refusal a test provokes on purpose in a page that is not the app's own (a local file probing its limits) is let through only when both its page address and its text match. Refusals in the app's own pages are always reported. `e2e/fixtures/localSite.ts` pages can be `{ redirect: address }` (a 302).

## Demo kit

| Test file | What it covers |
| --- | --- |
| `scripts/demo-kit.test.mjs` | The kit built twice into temporary folders: every file present, names safe on Windows; WAV headers valid; music 44.1 kHz stereo and 30-45 s long, ambience 30 s, effects under 8 s; every peak below -1 dBFS and above -20 dBFS; loudness within 1.5 LU of its target (music -16, ambience -22, effects -18 LUFS); "(loops well)" files have no jump at the loop point; the soundboard's sounds exist and it loads nothing from elsewhere; README names the version, has Windows line endings and the three instructions; the zip opens (CRC checked), matches the folder byte for byte and is under 25,000,000 bytes; two builds byte-identical. Helpers: the loudness meter reads a -20 dBFS 997 Hz tone as -20 LUFS (stereo) and -23 LUFS (mono), the limiter, WAV round trip, ZIP round trip and unsafe names. |
| `e2e/demoKit.spec.ts` | Builds the kit, adds its four music files through the Add Track dialog (names come from the file names) and plays Tavern Warmth until the time passes 2 s; types the path of `Local soundboard/soundboard.html` (with a space in it) into the address bar, accepts "Open this file from your computer?", plays the sword clash from the page's folder, and sees `notes.txt` allowed, `../README.txt` blocked and `https://example.com` blocked. |

## Heavy runs and stalls

Packaging and Playwright runs go through `scripts/heavy-run.mjs` (`yarn heavy [options] <command>`) on shared or small machines: one heavy run at a time per machine, and none left stalled.

```
yarn heavy --log e2e.log xvfb-run -a yarn e2e
yarn heavy --idle 10 --limit 75 --log app.log xvfb-run -a npx playwright test -c playwright.spec.config.ts --project=app
yarn heavy --status            # who holds the lock, since when, when it last printed
```

- **One at a time.** Runs queue on a lock file that names its owner (`lyre-heavy-run.lock` in the temp folder, or `HEAVY_RUN_LOCK`). The owner checks in every 30 s. A lock whose owner has died, or has not checked in for 2 minutes, is taken over by the next run, which first stops everything left in the old owner's process group.
- **Nothing left behind.** Each run is a process group of its own (Electron, browsers, Xvfb), stopped together when the run ends, stalls or is interrupted. Before this, an Xvfb left over from `xvfb-run` under `flock` kept the old lock for hours.
- **Stalls stopped and explained.** A run that prints nothing for `--idle` minutes (default 10), or runs longer than `--limit` (default 120), is stopped. Beside the log goes `<log>.stall-<n>.txt`: why, the Playwright tests that started and never finished, the run's processes with their CPU use, and the last 60 lines. An idle stall is run once more (`--retries`, default 1), since a stall under load is often a one-off; a second stall, or the overall limit, exits with 124 for a person to look at the report.
- **In CI** (`ci.yml`, and `specs.yml` for the specs: see Specs > On GitHub) each GitHub job has its own `timeout-minutes`; Playwright's per-test timeouts (60 s) catch a single hung test in both places.
- **Timing budgets in CI.** GitHub's runners run the unit tests with coverage on shared processors, two to three times slower than the build machine. CI sets `CUE_DESK_PERF_SLACK=3`, which multiplies the data layer's performance budgets (`src/main/data/testing/perfBudget.ts`); UI tests have 15 s instead of 5 s (an axe check of a whole screen). The budgets as stated are checked by the local run before each release (docs/RELEASE_CHECKLIST.md). Checks that the main process is never held past 200 ms measure the processor time of its longest turn (`src/main/data/testing/longestHold.ts`), not the clock, so other test files running alongside in `yarn test` cannot fail them.

## Specs

FND-15. `e2e/specs` holds the acceptance tests for the new interface. Each test states one behaviour Nik approved in the design prototype (`design/prototype`), in his words, and checks it on the screen. They run against the prototype now and against the real app as wave 3 builds each screen, so they find everything by role, accessible name and visible text (`getByRole`, `getByLabel`, `getByText`), never by CSS class or `data-k`. Where the prototype's wording is the specification, the test asserts the wording.

| Spec file | Tests | What it covers |
| --- | --- | --- |
| `campaigns.spec.ts` | 25 | All campaigns with Run next session and New campaign; one campaign (Prep or Live switch, theme, new session, Obsidian placeholder); Run on every session with the next one looking different from the others; playlists and pad boards on hand in every session (closed expanders, Preview, Play on air, Add playlists…). |
| `session-planner.spec.ts` | 39 | Scenes in order; music mixing tracks and playlists in play order (move, start with, remove, Preview, closed expanders); the music picker (All, Playlists, Tracks, FX, search, Preview, expanders, Cancel); files dropped on a scene; ambience; several pad boards per scene; add, move, drag, duplicate and delete scenes; Run this session and the Prep or Live switch. |
| `library.spec.ts` | 26 | Music, Ambience and FX filter, tag filters, search and sort; keyboard use of the rows; details with your title, the title in the file, file name and folder; tags by typing; Add tracks; files dropped on the page; Tag… on many tracks at once. |
| `playlists.spec.ts` | 30 | The list (Manual and Dynamic, Music, Ambience and FX, Used, search, inline expanders, Preview and Play on air, no Duplicate, New playlist, files dropped on a row); a manual playlist (rename, add, reorder, remove, files dropped, Use in…); a dynamic playlist (rule builder, plain-words summary, matching tracks, Make a manual copy). |
| `pad-boards.spec.ts` | 28 | The list (search by board name or pad label, Used, campaign filter, New board, Delete board…); resizing to spare pads and back with the message, Undo and Put all back; moving, swapping and previewing pads; play mode, hotkey conflict, sound variants. |
| `audio-profile.spec.ts` | 25 | Handles as sliders (drag and keys); what happens at the end (loop, next track, stop); typed times; fades with length and intensity; listening while you set it; markers; settings per place (track, playlist, scene) with Give this place its own settings and Back to the track's settings. |
| `live.spec.ts` | 107+ | Round 6 part 3's Live in seven boxes (w6-live): On air at the top with a part per room (status, Mute, volume, the bot's menu, Kick with Undo, Nobody there, Up next, Repeat for what plays now, What played), Scenes that unfold in place (SHW-7), Current scene with Repeat one saved and the scene's pads, the trays (Session and Campaign playlists and pads), Find a track or playlist in the top strip; Play next and Add to queue (PLY-16); Undo of the last change only (Must 1); keys from Settings › Keyboard shortcuts, Alt+1 to 7 and F6, the Next scene guard; reflow at 320 px, a 400 px high window and 200 % text; round 7 part 2 (steps, dividers, markers). The pad key checks press pads whose sound is a library track in the app's seed too (R, F, 1). |
| `outputs.spec.ts` | 16 | Rooms and the bot in each, Not in a room, moving a bot to another room (menu, keyboard, Bring…, Swap rooms), Leave, Mute, Volume, Test chime, and the same rooms appearing in Live. |
| `tags.spec.ts` | 11 | Round 7 (DAT-10): the Tags screen from the Library's ⋯; groups in order; Rename, Merge into… and Delete… on every track with Undo; tags inside tags (and the Library filter finds them); other words for a tag; colours by name; a new group on every track. |
| `look.spec.ts` | 6 | Round 7 (UX-11, A11Y-6): Display in Look and feel (density, text size 100 to 200 %, high contrast, tag colours); reduced motion; target size. |
| `library-files.spec.ts` | 7 | Round 5 (DAT-7, DAT-8): Back up, move or share (save the whole library or one campaign, session, scene, playlist, board or the tags, with or without audio; open a file with a preview and Skip, Merge or Keep both per duplicate; a file that is not a Lyre file or is damaged is refused); what came across from Kenku FM; Find missing files (match by name and size, confirm, Relink, Undo). Built in w4-transfer: in the `app` project the sample library's test build stands in for the prototype's computer and dialogs (`src/main/lyreApi/sampleComputer.ts`); the whole-library check stays marked, as the prototype's "2 MB" is a made-up size (the real file is about 10 KB). |
| `help.spec.ts` | 18 | FND-8, FND-9 (design/prototype/HELP.md): one Help entry under Look and feel and F1; no panel or help text on screens until asked; the side panel (search, groups, an article with Back, focus in and back, keys kept from Live, axe in two themes); every article under 300 words; Save diagnostics' result line; the first-run tour (5 steps, Skip on each, Back, Esc, once only, replayed from Help). `openFirstStart` and `reopen` in `target.ts`; `openRoute` and the e2e fixture mark the tour as seen. |
| `sweeps.spec.ts` | 191 | For every screen (the Library also with a filter on), at 960×1000 and 720×900 (default and Parchment themes) and at 1280×800, 1920×1080 and 2560×1440 (default theme): no sideways scroll, no overlapping controls (controls scrolled out of sight inside a scrolling box do not count), no cut-off button text, no control cut off at the side once scrolled into view (nor reached only by sliding a box that clips, BUG-14), and no axe-core 4.14.0 failure with the WCAG 2.2 A and AA tags. Once per screen: Tab reaches every control and does not get stuck; the page is resized from 600 to 2560 px wide at 1000 px high (every 80 px and 1 px either side of each breakpoint: 760, 820, 900, 1100, 1180, 1200) with the layout checks only, and the columns change where the design says (Live 1/2/3 at 820 and 1200, Campaigns 1/2/3 at 900 and 1200, Outputs 1/2 at 1180, a pad board 1/2 at 900); and at 1280×600 every control can be scrolled into view and reached. | Round 5 added the three new screens (Back up, move or share; What came across from Kenku FM; Find missing files).

Design round 5 (`design/prototype/ROUND5.md`) added a `round 5` block to the session planner, campaigns, playlists, library, pad boards, audio profile and Live spec files, `library-files.spec.ts`, and three screens to the sweeps. Each of these checks calls `expectFailureUntilBuilt("round 5")`: `round 5` is a pseudo-name like `on-air bar`, added to `BUILT_SCREENS` when wave 4 builds round 5. The bar is called Now playing from round 5 (it shows previews as well as music on air); the three 0.3 checks of the bar accept either name, so they keep passing in the app. Two pad board checks changed with the design and carry the same mark: growing a board brings spare pads back onto the grid, and a quick size larger than the board takes its spare pad (SFX-11).

Design round 6 (`design/prototype/ROUND6.md`) took text off the screen and into accessible descriptions and hover text. Checks that read the removed text now check the accessible description, or count rows where an open box no longer repeats its count (markers, spare pads), so most pass in the app as it is. The checks the app does not meet yet (the key legend shown only while the keyboard is in the list, the picker's and the session lists' descriptions, a resting status shown only on a folded box, the loop crossfade's and spare pads' descriptions) call `expectFailureUntilBuilt("round 6")`.

Round 6, part 2 (`ROUND6.md`, "Your notes on 0.4.0") added a `round 6` block to the Live, Outputs and campaigns spec files, `settings.spec.ts` for Settings in Lyre (`#/settings`, the `settings` screen in `screenOfRoute`), and two sweep screens (a scene unfolded in Live, and Settings). Checks of controls the app already has under their round 5 names read either name (`Scene music` or `Current scene music`, `Play next` or `Add to queue`, `Bring a bot to` or `Add bot to`, `Leave` or `Kick`), so they keep passing in the app; the row play order button in the Now playing bar became Shuffle and Repeat and is checked in the round 6 block.

Round 6, part 4 (`ROUND6.md`, "Part 4: review fixes") added a `round 6, part 4` block to the Live, Outputs, pad boards, session planner and Settings spec files (Ctrl+Z after a pause, a room with nobody in it, reflow at 320 px and in a 400 px high window, the This session and Whole campaign trays, boxes that keep their place, row buttons shown at rest, Kick's word, "On air · no room", pad names not cut, Help in Keys, the queue cleared by a new scene, Reorder with Move up and Move down, Rooms, Add pad, Add a bot's order). Each calls `expectFailureUntilBuilt("round 6")`. Checks of names that changed read either name (`Outputs` or `Rooms`, `Empty slot…` or `Add pad: …`, `Campaign pad boards` or `Campaign pads`, a Side room that is `Silent` or `Nobody there`), so they keep passing in the app. `openRoute` marks the first-run tour as seen in the prototype, which has Help (FND-8) from this round.

Round 6, part 5 (`ROUND6.md`, "Part 5: the Saved pop-up") added a `round 6, part 5` block to the campaigns, Live, session planner and playlists spec files: the one Saved pop-up (its words after a pause in typing and on leaving a field, focus kept, one pop-up read out once for the same save within 2 s, the same place on a Prep screen and in Live, clear of On air, a failed save that stays until Try again), and no Ready, Saved or scene count in any box, open or folded. Each calls `expectFailureUntilBuilt("round 6")`. `target.failNextSave(page)` makes the next save fail (the prototype's `L.failNextSave`; the app needs a test-build hook, so it throws there until built). Live's checks that read "Scene 1 of 6" now find the running scene by its Restart button, and the Audio profile's read-only note is found by its words, since every page now has the pop-up's status region.

The 0.5.0 build list (w6-specs, after round 6 parts 6 and 7 and round 7 with its Live part): `e2e/specs/BUILD-LIST.md` lists every check marked `round 6` or `round 7`, from an `app` project run, grouped by the stream that turns it green (Shell, Live, Rooms and Settings, Prep screens), with the checks two streams both need and an order. Settings (`round 6`) and Tags (`round 7`) are marked by round as well as by screen, and so are their sweeps (a sweep screen's `round` in `sweeps.spec.ts`). The 0.4.x checks of Help and of Live's BUG-19, BUG-20 and BUG-21 read round 6's screens, and Live's pad key checks press R, F and 1, whose sounds are library tracks in the app's seed. Live's checks that read round 6 part 3's boxes (one On air box with a part per room, Find a track, Current scene) are marked `round 6` with what they read. Inside a marked block, `metByTheAppAlready(why)` (`support/test.ts`) makes one check required in the app because the app meets it already; the UX-6 hover-text sweep is required on the screens the app already meets it on (`UX6_NOT_MET_YET` lists the rest). `knownLongHelpArticle(title)` in `target.ts` records the prototype's Live help draft (about 310 words) instead of failing the 300-word check; the app's articles must each stay under 300. The loop-count check of the Audio profile plays Crowd whispers (f14), a 20-second loop: since BUG-22 a preview keeps to the file's real length, and the seed's stand-in tone is 20 s.

One mark per stream (w6-shell, step 0): the `round 6` and `round 7` marks are replaced by the 0.5.0 streams that build each check, `expectFailureUntilBuilt("shell" | "live" | "rooms-settings" | "prep", ...)`, with every stream a check needs (BUILD-LIST.md's stream and its "Also"). A check is expected to fail in the app until all the streams it names are in `BUILT_STREAMS` (`support/built.ts`); a stream adds its name when its checks pass. Streams have their own list because `live` is also a screen: screens are still marked by `expectFailureUntilScreenBuilt(screen)` against `BUILT_SCREENS` (each spec file by its name automatically, a sweep by its screen's `owner`, a stream-built screen such as `settings` or `tags` by its stream as well, through the sweep screen's `streams`). The UX-6 hover-text sweeps the app does not meet yet name the shell and the screen's stream (`UX6_NOT_MET_YET`). A check that passes before all its streams are built shows as "expected to fail, but passed": it needs fewer streams than it names, and the stream that sees it takes the others off.

0.5.1 (w51-feat): the features from Nik's test of 0.5.0 were built straight in the app, with no prototype round (Nik, 11 Nov 20:41: "They don't need to be designed or reviewed"). Their checks sit in a `0.5.1: Nik's changes from his test of 0.5.0` block at the end of the screen's spec file and call `appOnly()` (`support/test.ts`) first: the prototype project skips them, the app project runs them like any other check.

### Running them

```
npx playwright test -c playwright.spec.config.ts --project=prototype
npx playwright test -c playwright.spec.config.ts --project=prototype live.spec     # one screen
CUE_DESK_E2E_BUILD=1 yarn package                                                   # once, for the app project
npx playwright test -c playwright.spec.config.ts --project=app                    # the app (see below; xvfb-run -a on Linux)
```

No build is needed for the `prototype` project; it opens `design/prototype/lyre-prototype.html` as a file. All specs must pass there: that proves the specs describe the approved design before the app exists. If your machine's Playwright browser differs from the one Playwright expects, point `LYRE_SPEC_CHROMIUM` at a Chromium executable. On the build machine Playwright 1.64.1 expects Chromium build 1248 and `/opt/pw-browsers` holds build 1243; matching them would need a download (`playwright install`) or another Playwright version, so the runs use `LYRE_SPEC_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-1243/chrome-linux*/chrome)` (FND-17). These specs are not part of `yarn e2e` (`e2e/playwright.config.ts` ignores `e2e/specs`).

### On GitHub

Push a branch whose name starts with `ci/` (`git push <remote> HEAD:ci/<name>`), or choose "Run workflow" on the Specs workflow in the Actions tab. `.github/workflows/specs.yml` runs every spec and every end-to-end test of the packaged app on Linux in about 15 to 20 minutes from push to summary, where one 2-core machine takes about 95 minutes for the app project alone:

- **Package** builds the test package once (`CUE_DESK_E2E_BUILD=1 yarn package`) and passes it to the other jobs as a tar, so the programs stay executable.
- **App specs, part 1 to 8 of 8** each run `--project=app --shard=N/8` under `xvfb-run`, one copy of the app at a time (the app project's `workers: 1`), against that one package. **Prototype specs** runs `--project=prototype` with Playwright's Chromium (`npx playwright install chromium`: the runner image already has the libraries it and Electron need, and Xvfb) (two at a time on CI) and **End-to-end tests** runs `yarn e2e`; all of them start together once the package is ready (the prototype at once).
- **Summary** merges the jobs' blob reports into one artifact, `test-report`: `specs/index.html` (app and prototype together, one config) and `e2e/index.html` (the end-to-end suite has its own config and files with the same names, so it has its own page). It writes on the run's summary page how many tests passed, failed, were flaky (failed once, passed on the second try) or were expected to fail (not built yet), which ones failed, and a row per job (`scripts/test-summary.mjs`, tested in `scripts/test-summary.test.mjs`). Each failed test is also an error on the run.
- A failing job keeps its `test-results/` (screenshots, traces, and for `yarn e2e` the app's log) as `failures-<job>`, and ends with a step that says what failed in plain words, as in `ci.yml`.

Differences from a local run: CI sets `CI=true`, so a failed test is run once more (`retries: 1`) and one that then passes is reported as flaky; the runners are not root, so Chromium's sandbox stays on. Ubuntu 24.04 and later (`ubuntu-latest`) restrict the user namespaces the sandbox needs (AppArmor), so the jobs that start the app allow them first with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; nothing in the workflow or the app switches the sandbox off (`launchArgs` in `e2e/fixtures/packagedApp.ts` does so only as root). Every job stops after at most 30 minutes. The repository is public, so GitHub's standard runners cost nothing.

### What differs between the prototype and the app

Only `e2e/specs/support/target.ts`. It has one function per thing a person cannot do from the page itself: `openRoute(page, route, { theme })`, `joinRoom(page, bot, channel)` (a Discord bot joining a voice channel), `leaveAllRooms(page)`, `notLyre()` (parts of the page that are the prototype's own controls, left out of the sweeps) and `knownAxeIssues()`. Each is implemented for the prototype and, for the app, throws "not built yet". `failNextSave(page)` (round 6 part 5) is built for the app: it calls the test build's `__lyreLibraryTest.failNextWrite()`, and the library's next write is refused with "not-saved". `support/drop.ts` drops files the way a browser does and works on both.

### The app branch of `openRoute`

`openRoute` in the `app` project chooses the "Lyre" tab in the main window, saves the theme the way Look and feel does (`lyre-shell` in the Lyre page's storage: `"campaign"` for `default`, `"parchment"`), sets the page address to `#/<route>` and reloads the Lyre page, then waits for its h1 (`e2e/fixtures/lyre.ts`, also used by `e2e/lyre.spec.ts`). The spec then works in the Lyre page: in the `app` project, `page` is the Lyre page of a fresh copy of the packaged test build (`withAppPage` in `target.ts`), with its own data folder, a library seeded from the prototype's data (`CUE_DESK_LYRE_SEED=prototype`, honoured by test builds only) and Discord faked. Tests run one at a time, with 5-second action and expect timeouts. `openRoute` opens the route, then throws "not built yet" when the route's screen (`screenOfRoute`) is not in `built.ts`, so no check can pass by chance on a placeholder page (about 7 s a test; the whole project takes about 40 minutes on a 2-core machine). axe is injected with `page.evaluate(source)`, because the Lyre page's policy refuses added script tags. The project still opens a headless browser it does not use (the `page` fixture is Playwright's), so `LYRE_SPEC_CHROMIUM` applies to it too. Discord is the prototype's (`CUE_DESK_FAKE_DISCORD=prototype`, test builds only, w4-outputs): its two servers and six voice channels with their people, Lyre Table in Table and Lyre Side in no room, both at 85 %. `joinRoom` and `leaveAllRooms` move bots through the main process's `globalThis.__lyreOutputsTest` (`src/main/broadcast/testing/prototypeWorld.ts`).

### Flipping a screen from expected-fail to required

The `app` project runs the same files. A spec of a screen that `e2e/specs/support/built.ts` does not list is marked "expected to fail", so the project is green while wave 3 is under way, and a spec that starts passing before its screen is listed shows up as "expected to fail, but passed". When wave 3 builds a screen:

1. Implement that screen's remaining functions in `target.ts` for the app (`page` is the Lyre page; the app is started by `withAppPage`).
2. Add the screen's file name (`"live"`, `"campaigns"`, `"session-planner"`, `"library"`, `"playlists"`, `"pad-boards"`, `"audio-profile"`, `"outputs"`, and `"look"` for the Look and feel page) to `BUILT_SCREENS` in `built.ts`.
3. Run `--project=app` for that file. Every spec must pass; a spec that cannot is either a real gap in the screen or a reason to change the prototype first (the prototype is the specification) and then both.

The sweeps belong to the screen they open, so each sweep becomes required with its screen. `knownAxeIssues()` is empty for the app: the two Label in Name findings recorded for the prototype (the pad tiles and the `To: <room>` choice name more than they show) have to be fixed in the app. `knownLayoutIssue()` records the one prototype layout finding (the hidden " (Track)" text makes the Session planner scroll sideways below 640 px with a scene open); it is false for the app.

## 0.3.1 fixes (w31-fix)

Each fault Nik found in 0.3.0 has a test that failed before its fix.

| Backlog | Tests |
| --- | --- |
| BUG-12, BUG-13 | `src/lyre/onAirAcrossScreens.test.tsx`: the whole page (every screen) over the in-memory LyreApi and the real audio host on the fake audio graph. Adding, moving and removing in a scene leave the music on air and the preview playing; music started from the Library, the Audio profile, a playlist or the session planner plays on, with the On air bar, across the other screens, Live and Outputs included, until Stop. `e2e/onAir.spec.ts`: the same in the packaged app, sound checked with Chromium's own audibility of the Lyre page. |
| BUG-14 | `sweeps.spec.ts`: the "Library with a filter on" screen and the cut-off check (see Specs). In the prototype the same two headers are recorded as known issues (`knownLayoutIssue(…, "cut")`) until the design stream fixes them. |
| BUG-15 | `LibraryScreen.test.tsx`: Tab adds a new tag, a chosen suggestion, the first match; an empty box adds nothing. |
| BUG-16 | `BoardScreen.test.tsx`: every icon by mouse and keyboard; a choice shows at once while the library is slow, and a second click is kept. `e2e/padIcons.spec.ts`: every icon, each clicked twice, and the arrows, in the packaged app. |
| BUG-17 | `previewClock.test.ts`, `ProfileScreen.test.tsx`: Play goes round Start to End (or the loop) until stopped, the playhead, time and loop count following every pass; the last 10 s of a loop go round too. |
| BUG-18 | `CampaignScreen.test.tsx`, `SessionScreen.test.tsx`: F2, double-click and Rename start editing; Enter saves; Esc cancels; focus goes back. |

## 0.4.1 fixes (w5-fixes)

Each fault Nik found in 0.4.0 has a test that failed before its fix.

| Backlog | Tests |
| --- | --- |
| BUG-19 | `lyreAudio.test.ts`, `browserLyreAudio.test.ts`: no room, effect or pad reaches the Lyre page's speakers, in a broadcast or outside one. `AudioCaptureManagerPreload.test.ts`: the page's room frames reach the room's encoder and never This Computer; tabs still do. `NowPlayingBar.test.tsx`, `LiveScreen.test.tsx`, `live.spec.ts`: with no room, "nobody hears it". `e2e/onAir.spec.ts` now checks sound on air as packets at the fake Discord's Table and that neither the Lyre page nor the capture window is audible, with a bot in a room and without one (while no preview plays: the capture window plays the preview in the headphones, so the BUG-12 check stops it and then asks for silence). With no bot, the elapsed time must move on (the rooms' silent keep-alive node; `lyreAudio.test.ts` checks every room is joined to it). |
| BUG-20 | `director.test.ts`: a press stops a sounding pad in every play mode and takes no turn of its variants; `stopPads` leaves music, ambience and other effects; `isCueAction` checks it. `lyreAudio.test.ts` (also Try pads), `LiveScreen.test.tsx`, `BoardScreen.test.tsx`, `boardModel.test.ts`; `live.spec.ts` (press again, Stop pads), `pad-boards.spec.ts` (the one-shot help's new words). |
| BUG-21 | `SessionScreen.test.tsx`, `LiveScreen.test.tsx`, `session-planner.spec.ts`, `live.spec.ts`: click or F2 on the session page's title, F2 or Rename session in Live's top strip; Enter saves, Esc cancels, only the name. |

## w6-found (0.5.0 foundations and security)

The tests for SEC-4 (remote control), SEC-14 (update problems) and SEC-9 are listed in `docs/security.md` > w6-found > Tests. BUG-11 and PERF-7 are in the tables above (`playlistPlaybackSlice.test.ts`, `Sound.test.ts`, `soundLengths.test.ts`). Script tests: `scripts/ci-gate.test.mjs` (FND-5: what the workflows check, when every end-to-end test runs, plain-words failure steps, the release waiting for the gate and CodeQL) and `scripts/electron-support.test.mjs` (SEC-1). `e2e/settings.spec.ts` checks the old Settings no longer says the Kenku FM Stream Deck plugin works as it is. Each test was seen to fail before its change.

## w6-ux (0.5.0 usability review fixes)

Each finding of the review (scratchpad/reviews/usability-0.5.0.md) has its check named `UX-R<n>` in the unit test of
the screen it changes, and, where it shows on screen, in the spec of that screen: session-planner (UX-R1 steps
dialog from the keyboard), outputs (UX-R2 Rooms at 200 % text; UX-R9 Nobody there), live (UX-R4 Esc in Find,
UX-R6 Undo strips as groups), library and playlists (UX-R5 the Saved pop-up, UX-R3 round 6 cuts, UX-R18 24 px check
boxes), campaigns, pad-boards and audio-profile (UX-R3 round 6 cuts, with the key how-tos that show only while the
keyboard is in their box), settings (UX-R11 Add a bot's errors under their fields, UX-R16 the version) and help
(UX-R15 the article's title). The pop-up's words are read from the live region a moment after it shows, so a spec
that counts what is read out polls (`expect.poll`, campaigns.spec).
