# Testing

## Playback characterisation tests

These tests record how playlist and soundboard playback behave today. The playback engine is due to be rewritten in WP4, and these tests are the specification for that rewrite: a rewrite that keeps them green behaves the same for the user. Where a test pins a known bug, its name says so and it is marked `it.fails`. When that bug is fixed, change the test to a normal `it`.

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
| `soundboards/Sound.test.ts` | One sound's fades and loops for every fade-in/fade-out/loop combination, the cross-faded loop releasing its audio (500 loops), stop with and without fade, and seek moving the fade-out point. |
| `soundboards/useSoundboardPlayback.test.tsx` | Playing, stopping, seeking; a non-looping sound is removed when it ends; errors show "Unable to play sound: &lt;title&gt;". |

The navigation logic in `usePlaylistPlayback.ts` exists three times (in `next`, `previous` and the track-end handler). The navigation table in its test file runs the same cases through all three, so WP4 can merge them into one function and check nothing changed. They differ in one place: with repeat "track", the end handler restarts the track by calling `play()`, while next/previous only seek to 0.

### Known bugs these tests document

- **QUEUE-1** (`playlistPlaybackSlice.test.ts`, `it.fails`): with shuffle off, removing a track from the playing playlist can make a different track "current". `removeTrackFromQueue` always walks the shuffled order, which only matches the playlist order by chance.
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
| `e2e/remote.spec.ts` | Remote switched on in Settings on a free port; `GET /v1/playlist`, `PUT /v1/playlist/play` (track and playlist), `GET /v1/playlist/playback`, `PUT /v1/playlist/playback/pause` and `/play`, `GET /v1/soundboard`, `PUT /v1/soundboard/play`, `GET /v1/soundboard/playback`, `PUT /v1/soundboard/stop`, each checked against the player; switching it off closes the port. |
| `e2e/carryOver.spec.ts` | FND-1: a library made in `<appData>/Kenku FM` appears in Cue Desk on its first normal start, the carry-over record says "copied", and later changes in Cue Desk leave the Kenku FM library alone (Linux only, where `XDG_CONFIG_HOME` moves appData). |
| `e2e/capture.spec.ts` | Tab audio capture for Discord (SEC-3). |
| `e2e/backgrounds.spec.ts` | Kenku FM background pictures: a fake Kenku FM install (a generated PNG and a minimal `player_window/index.js`) in a temporary folder named by `CUE_DESK_LOCAL_APP_DATA_DIR` is copied into `<userData>/backgrounds`; a new playlist with the "tavern" background shows the copied picture on its card and as the open playlist's page background; the same from an install packed in `app.asar`; without Kenku FM only "blank" is offered. |
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
| `features/idleWakeUps.test.tsx` | PERF-1: counts every timer and animation-frame callback (`test/countWakeUps.ts`) over a minute of fake time with both playback hooks mounted. Before: 3,750 a minute with nothing played, 7,500 with a track paused or playing. Now: none when idle (at most one last tick after a pause or stop), one a second while a track plays. |
| `features/remoteListeners.test.tsx` | PERF-1: the remote API listeners are registered once (before: 311 re-registrations in one minute of playback) and still answer with the current state and call the current callbacks. |
| `app/throttledStorage.test.ts`, `app/store.test.ts` | PERF-6: while the mouse button or a key is held (a slider drag), the library and player settings are saved at most once a second, and the final value as soon as the user lets go (or the page loses focus, is hidden or reloads). Other changes are saved at once, as before. Before: 100 saves for a 3-second, 100-step drag; now 4. |
| `playlists/usePlaylistPlayback.test.tsx` ("deleting the playing track"), `playlists/TrackItem.test.tsx` | BUG-8: deleting the playing track, or its playlist, stops and unloads it and clears the player bar; nothing (play key, remote, next) can resume it; a track still loading after a skip carries on. |

End-to-end: `playlists.spec.ts` also checks that the player bar shows no title, time or media-key metadata after the playing track is deleted and that another track then plays; `persistence.spec.ts` checks that a volume change and a rename made just before quitting are kept.

Saving is not delayed outside a held button or key because Electron destroys the player view without running its `pagehide` or `beforeunload` handlers when the app quits (`BrowserViewManagerMain.removeAllBrowserViews` closes and destroys at once), so a held-back save would be lost.

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

The old player's characterisation tests stay as they are until WP5 moves the player onto the engine. The QUEUE-1 test in `playlistPlaybackSlice.test.ts` stays `it.fails` until then; its fix lives in the engine's queue (`queue.test.ts`, "remove (BUG-11)").

## WP2 Tabs

| Spec file | What it covers |
| --- | --- |
| `e2e/localFiles.spec.ts` | SEC-15: a file typed in the address bar is asked about once, with its full path, and opens in the `persist:local-files` partition in place of the empty tab; Cancel opens nothing and shows no error; a remembered folder opens without asking (also from a bookmark), is listed in Settings > Local files and can be forgotten; a web page cannot open, link to, pop up or jump to a file. The native question is replaced in the main process by a stand-in, because Playwright cannot click native dialogs. |
| `e2e/screenCapture.spec.ts` | SEC-16: the main window and the capture window get `NotAllowedError` for screen capture. |
| `e2e/tabSleep.spec.ts` | PERF-5: a hidden tab playing a Web Audio tone stays audible (`isCurrentlyAudible`) well past the sleep delay and is never slowed; a hidden silent tab is slowed down (it gets much less work done) and runs at full speed again when shown. Uses `CUE_DESK_TAB_SLEEP_MS=1000` (test builds only). |
| `e2e/bookmarkFolders.spec.ts` | UX-10: create a folder, move a bookmark with "Move to folder…" and another by dragging it (held by its site icon) onto the folder, close the folder with the keyboard, rename it; collapse the sidebar, open a bookmark from a folder icon and see the website view move to the collapsed edge; folders and the collapsed sidebar survive a restart; deleting a folder keeps its bookmarks; Settings opened from the collapsed sidebar expands it. |

`e2e/tabs.spec.ts` now checks that a file on a network share is refused (a file on this computer is asked about instead), and the bookmark editor test uses `javascript:` as its refused address.

Found during WP2: holding a bookmark or tab by its site icon started the browser's own image drag, so the bookmark or tab could not be dragged. The icons are no longer draggable on their own.
