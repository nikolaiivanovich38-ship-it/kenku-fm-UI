# Round 8: Lyre is the whole window (0.5.1, 11 Nov 2026)

> "Let's also make sure, if we've implemented everything we need to replace it, that we have fully retired the old
> kenku interfaces and player tab"
>
> Nik, 11 Nov 2026, 09:52

Release 0.5.1 retires the old Kenku FM main window and the Lyre Player tab (FND-16, work package WPR; plan in
`R51-RETIRE.md` and the gap analysis `reviews/retire-old-ui.md`, sections 4 and 5). This round designs what changes on
screen; w51-main builds it. Nik's answers that shape it (R6-NIK-DECISIONS.md, 11 Nov):

- Websites and microphones: "Keep the code, remove them from the interface. Let's put playing from YouTube, Spotify,
  and other online sources into the backlog as a could have item for a later release."
- Remote control: "Hide until Stream Deck (Recommended)".
- Safety net: "Portable 0.4.1 copy (Recommended)".
- Timing: "0.5.1 straight after"; 19:02: "Start on 0.5.1".

The rules of rounds 6 and 7 hold: less to read, plain words, one Saved pop-up place, no resting statuses. The new code
is in its own files (`src/views/r8window.js`, `r8window.css`), loaded after round 7's; Settings, What came across and
Help changed in their own files. The prototype's strip has three new buttons for what cannot happen in a browser:
**Update downloaded**, **Update check fails** and **Came from Kenku FM**.

## 1. Lyre is the whole window

**What.** No Kenku FM tab bar, no Lyre Player tab, no website tabs: Lyre's page is the window. On Windows the window's
own buttons (minimise, maximise, close) sit at the top right, over the right end of Lyre's top strip, drawn by Windows
through Electron's `titleBarOverlay`. The prototype draws a stand-in of the same size, 138 × 36 px of the screen
(`data-window-buttons`, hidden from screen readers, never focusable; clicking its maximise shows the maximised state).
At 200 % text the buttons stay 138 × 36 px of the screen, so in the page they are 69 × 18 CSS px.
**Nothing under them.** The top strip (`.viewhead`), Live's strip (`.lv-top`) and Help's header keep the buttons'
width free at their right end; with Help open beside the screen, Help's header keeps it instead. A sheet as tall as the
window starts below them. Settings' version, at the strip's right end, moves left of the buttons.
**Dragging.** The empty parts of the top strip, Live's strip, Help's header and the logo drag the window;
double-clicking them maximises it, and again puts it back. Every control, field and text with hover text in them is
not a drag area (`app-region: no-drag`), so each stays clickable and keeps its hover text (Windows gives a drag area
the mouse, so a cut name in a drag area would lose its full text on hover, UX-6).
**Colour.** The buttons take the colour of what is under them: the strip's background and text colour in each theme
(Live's strip is a shade lighter), and Help's header when Help is open beside the screen.
**Checked** at 960 × 1000 and at half a 1920 screen (960 × 1040) with text at 200 %, on every sweep screen, Help open
and Add a bot: nothing is under the buttons, and the trail is cut in the middle as today ("… › The Sunken Crown ›").
Two things broke and were fixed: a playlist's head did not wrap at 200 % and ran out of the window (it already ran
74 px past its edge in 0.5.0); below 660 px of app it now wraps. In a 720 px window Live's strip, 138 px shorter,
squeezed the campaign's name in the trail to 6 px; below 780 px of app it now takes two lines (Back, Prep | Live and the
buttons; then the trail, the session and Find), and below 640 px three, as in 0.5.0.
**Why.** Nik runs Lyre in half a screen beside the VTT: he must be able to move, resize, maximise and close it, and
reach every control, at any text size.

**For the app (w51-main).**
- `--wco-w` and `--wco-h` (r8window.css) are the space to keep free. Set them from
  `navigator.windowControlsOverlay.getTitlebarAreaRect()` on start and on its `geometrychange` event: `--wco-w` is
  `innerWidth - (rect.x + rect.width)`, `--wco-h` is `rect.height` (CSS px, so page zoom is already counted). The CSS
  `env(titlebar-area-*)` values are a fallback; check them at 200 % before relying on them.
- `titleBarOverlay: { color, symbolColor, height: 36 }`; the page sends new colours on a theme change and when Help
  opens or closes beside the screen (a guarded channel, `LYRE_TITLE_BAR` in the plan). The prototype's colour rule is
  `paintButtons` in r8window.js.
- Double-click to maximise is Windows' own for a drag area, and real clicks there never reach the page. The spec
  double-clicks through Playwright, whose clicks do reach the page: a `dblclick` listener on the same drag areas that
  asks the main process to maximise or restore makes it pass without doubling a real double-click.
- macOS puts its buttons at the top left; Lyre ships for Windows, so this round does not design that.

## 2. Updates and the version

**What.** When an update has downloaded, a note in the Saved pop-up's place (bottom right of the work area, above the
Now playing bar) says **"Lyre has an update. Restart Lyre to use it."** with **Restart now** and Dismiss. It stays
until dismissed: it is a standing note (light card with the accent edge, like the Undo note), not the dark pop-up that
goes after a few seconds. It sits lowest in the corner, so a Saved pop-up shows just above it.
When a check or an install fails, the plain message shows **once**, in the same place, as a warning card (the failed
save's look): the reason in bold, then "It tries again every 15 minutes; this version keeps working." It stays until
dismissed and is not shown again until a check has worked in between. The words are those of
src/main/updateStatus.ts, which already say what to do: offline; the update service did not answer; the installer's
updater is missing (install again from the latest installer); Windows could not run the updater (restart the computer,
then install again if it keeps happening).
**Help** shows "Lyre 0.5.1" at its foot, under Take the tour and Save diagnostics…, as Settings already shows the
version at its top right.
**Why.** The old window showed both messages (src/autoUpdate.ts); without it Nik could not tell whether 0.5.x
installed or failed (SEC-14 asks for the failure "where Nik will see it").
**For the app.** The ready message changes in updateStatus.ts to the words above. Restart now calls
`autoUpdater.quitAndInstall()` over a new guarded channel. autoUpdate.ts stops sending ERROR and MESSAGE to the old
window; the page reads `window.lyre.updates`. Test builds need `__lyreUpdatesTest.report({ kind, error })`, fed to the
same handlers as autoUpdater's events (e2e/specs/support/target.ts `reportUpdate`).

## 3. Settings

**What.** The Website tabs and Local files boxes are gone. Remote control is hidden (its design stays in settings.js
behind `SHOW_REMOTE`, for Stream Deck support in WP6). Sound to Discord keeps its choice, now kept by Lyre itself
across starts, and gains **Empty the audio cache** under the crossfade choices. In the app it lived inside Website tabs'
**Clear website data**, which also emptied the audio cache (index.ts `clearCache`); with website tabs gone from the
interface, only the audio cache part stays on screen. Its hover text: "Deletes the copies Lyre made of your music so
tracks start at once. Lyre makes them again when it needs them. Your music files, library and settings are kept."
Pressing it says "Audio cache emptied". Nothing to confirm: nothing is lost.
**For the app.** Sound to Discord moves from the old window's storage to `this-computer.json` (plan step 3). Empty the
audio cache calls the library's `clearAudioCache()`; whether it still clears website data that nothing can show any
more is w51-main's call (the tab code is kept, unreachable).

## 4. A bot token from Kenku FM

**What.** Someone coming straight from Kenku FM, whose token Kenku FM kept in plain text, sees once, at the top of
Settings › Discord bots, a note (role note, the accent edge):
"**Lyre moved your Discord bot token from Kenku FM.** Kenku FM kept it unprotected on this computer; Lyre keeps it
encrypted now. To be safe, make a new token: in the Discord Developer Portal, open your bot's Bot page, press Reset
Token, then paste it here with Replace…." with **Got it**. Got it ends it for good; focus goes to the Discord bots
heading. Nobody else sees it.
**Why.** The old LegacyTokenNotice (src/renderer/features/settings) said the same in the old window: Kenku FM's own copy
stays in its storage after the move, so a new token is the only certain fix. Its words were "an older version, which
saved it unprotected"; these name Kenku FM and say what Lyre does now.
**For the app.** The move reads `persist:root` through the Lyre page (plan step 4) and hands the token to
`OutputManager.importLegacyToken`. If this computer cannot encrypt, the old window's other message applies, in the same
place: "Your Discord bot token from Kenku FM is kept only until Lyre closes, because this computer has no safe place to
keep it. Next time, paste it again in Settings › Discord bots." Test builds need
`__lyreLegacyTest.arrive({ plainToken, bookmarks })` (target.ts `arriveFromKenkuFM`).

## 5. What came across: the bookmarks

**What.** A **Bookmarks** box, under What came across, lists the old bookmarks once: each title, its address under it,
and **Copy** ("Copy the address of YouTube"; pressing it says "Copied: https://www.youtube.com/"). Its one line:
"Websites can't be opened in Lyre for now. Copy an address to open it in your browser." The table's row reads
Bookmarks · 6 · **Listed to copy** (it said Website tabs). With no bookmarks there is no box and no row.
**For the app.** The move report keeps the bookmarks' titles and addresses, not only their count (libraryApi.ts
"now in Website tabs" goes). The prototype seed's six (data.js) are what the specs expect in a test build.

## 6. Help

Articles 01 and 02 are rewritten for 0.5.1; no other article mentioned the Lyre Player tab, website tabs, bookmarks or
the old Settings. There are no help drafts in the prototype now: it shows the app's own articles
(src/lyre/help/articles), so the two always say the same.
- **01 Connect Discord and add a bot to a room** (278 words): a last paragraph for Kenku FM users: the bot comes
  across, its token encrypted; Settings › Discord bots says once if Kenku FM kept it unprotected.
- **02 What came across from Kenku FM** (186 words): bookmarks with Copy and "Websites can't be opened in Lyre for
  now"; the token; "Lyre is one window", with where the old player's things are now; microphones and Stream Deck buttons
  are not in Lyre for now. The Lyre Player tab paragraph is gone.

## Specs

New, each marked `expectFailureUntilBuilt("retire")` (a new stream in support/built.ts; BUILD-LIST.md lists them):
- `sweeps.spec.ts`: two per sweep screen (44): nothing under the window's buttons at 960 × 1000 and at 960 × 1040 with
  text at 200 %; the top strip drags, none of its controls does. "0.5.1: Lyre is the whole window" (7): one window with
  Lyre's page alone; the buttons' place and size and focus never under them; double-click maximises (top strip and
  Live's strip); the trail at 200 %; Help open; Add a bot at 200 %.
- `help.spec.ts` (7): the update note stays until dismissed; a failed check once, again only after a check worked; an
  install failure says what to do; the version at Help's foot; no article mentions the Player tab, website tabs or
  remote control; articles 02 and 01.
- `settings.spec.ts` (5): no Website tabs, Local files or Remote control; Sound to Discord keeps its choice; Empty the
  audio cache; the token note once; no note otherwise.
- `library-files.spec.ts` (3): the Bookmarks box; none, no box; the bookmarks brought are the ones listed.

Removed: "round 7: remote control needs a secret code" (3 checks) and the Website tabs, Local files and Remote control
parts of "the other settings Lyre still needs are here". The Bookmarks row moved out of "says what was copied" into
the Bookmarks check, so the rest of that check stays required in the app.

All new checks failed on the 0.5.0 prototype first (the specs commit came before the design).

## Numbers

`tools/r6-measure.js`, the 0.5.0 prototype against this round, at 1920 and 960 (see the table in the commit that adds
these notes; Live is at or below 0.5.0 on every count in every state).

## Try it

1. Any screen: the window's buttons at the top right of the strip. Double-click an empty part of the strip: the middle
   button shows the window maximised; double-click again.
2. Look and feel › Display › Text size 200 %, Screen: Half of a 1920 screen: open Session 14 and Live; nothing is under
   the buttons. Open Help (F1): Close help is left of them.
3. Strip: **Update downloaded**: the note at the bottom right; save something (rename a playlist): the Saved pop-up
   shows above it and goes; the note stays. Dismiss it.
4. Strip: **Update check fails**: the warning card, once.
5. Help: "Lyre 0.5.1" at its foot.
6. Settings: no Website tabs, Local files or Remote control. Sound to Discord › Lighter on the computer; reload: still
   chosen. Empty the audio cache.
7. Strip: **Came from Kenku FM**: Settings › Discord bots has the note; Got it.
8. Library › ⋯ › What came across from Kenku FM: the Bookmarks box; Copy on YouTube.
9. Help › What came across from Kenku FM.

## Questions for Nik

1. **The update failure card stays until you dismiss it.** Recommendation: keep it so; it shows once per failure,
   and a card that went away by itself could be missed mid-game. The alternative is to let it go after a minute.
2. **The window's buttons are 36 px tall, the strip 44 px.** Recommendation: keep 36 (Windows' usual size); 44 would
   line them up with the strip's bottom edge at 100 % text only.
