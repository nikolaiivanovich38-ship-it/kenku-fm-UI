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

# Part 2: Nik's findings from testing 0.5.0 (11 Nov, 19:42)

> "They don't need to be designed or reviewed, just reuse existing functions and button styles, and standard patterns
> for seek bars." (Nik, 20:41, on parts 2 and 3)

Parts 2 and 3 were already in the prototype when this came; a separate build stream builds them straight in the app.
What is here is a reference made of existing functions and button styles, not a design to review; the checks are
there to tell the build stream when each piece works.

Nik tested 0.5.0 and sent 17 findings (R6-NIK-DECISIONS.md, "11 Nov 19:42"), then "Continue with the 0.5.1 release".
Most are faults in the app that the w51-fix stream mends against the existing design (Copy path, the track preview's
profile and Stop, the Now playing time stuck at 0:00, the window running past the taskbar). The ones below change
what is on screen, so they are designed here. The new code is in core.js (the position slider, the theme rule),
the screens' own files, and `src/views/r8findings.css`.

## 7. Play on air for each track of a scene's playlists

> "In the prep view, there are no 'play on air' buttons against individual tracks in playlists within a scene - I need
> that at track level, as well as at whole of playlist level."

**What.** In the session planner, a playlist in a scene's Music unfolds to its tracks; each track row now ends with
**Play on air** (the broadcast icon Live uses), and the playlist's own Play on air stays on its row above. The rows'
buttons come in Live's order: (the playlist's play order,) Preview, (Repeat one,) Play on air, so the last button of a
row is always the one the players hear. Play on air on a track plays it from that playlist, in the scene's order and
with the scene's audio settings for it: Next in the Now playing bar goes on to the playlist's next track, and the bar
says "Scene: The abbey ruins · Abbey: eerie, low energy". A scene's own track rows and the playlist's Play on air now
play with the scene's settings and order too (before, they used the playlist's). Session and campaign playlists, when
unfolded, have the same per-track button.
**Why.** Nik improvises inside a scene: he wants the one track that fits, without starting the scene or leaving the
planner.
**For the app.** `playOnAir(track, { playlistId, place })`, where place is the scene's key (`sc:<cid>:<sid>:<scene>`),
and the profile lookup takes a scene place as it already takes a session one.

## 8. Jump to a point in the playing track

> "I can't click and interact with the tracking bar in the now playing bar, and choose to skip to a certain point in
> the track - definitely need that." "In live I also need to be able to click in the tracking bar for the currently
> playing tracking and skip to a certain point in the track"

**What.** The position bar of what plays, in each row of the Now playing bar (rooms and the preview) and in each lane
of Live's On air (music and ambience), is a slider. Click it to jump there, or drag along it; it grows a little under
the mouse and on focus, so Nik can see it is live. Its hit area is 24 px tall around the 4 px bar (WCAG 2.5.8). With
the keyboard (Tab reaches it after the track's name): Left and Right move 5 seconds, Page Up and Page Down 30, Home goes
to where the track starts (its profile's start), End to its last second, so its end (fade, loop or next) still plays
out. A screen reader hears "Position in Eerie dread…, slider, 0:42 of 3:10". The value follows the music; while the
slider has focus it changes only when Nik moves it, so it is not read out four times a second. The markers stay on
Live's bar as ticks. Nothing new to read: the slider is the bar that was there.
**Why.** Both quotes; and the first finding ("just displays 0:00 and no position indicator, until I press pause") is a
fault in the app's bar, which the specs now catch: the value must move while the track plays.
**For the app.** One `PositionSlider` in the kit over the existing progress line; `seek(room, lane, seconds)` in the
engine (the preview's too). Below 760 px of Now playing bar (a 960 window at 200 % text) the bar's time and slider are
hidden, as in 0.5.0; Live's On air keeps its slider at every width.

## 9. Stop and Shuffle in On air

> "I need a stop button in the on air view in live on the currently playing track, not just a pause button - I need
> both." "I also need a shuffle button in the on air live view"

**What.** Each lane of On air has **Stop** right after Pause (Pause stays): it fades that room's music, or its
ambience, out in a second; the other lane goes on. The music lane has **Shuffle** right before Repeat, in each room's
part. It is the Now playing bar's Shuffle, which Live hid with the bar's room rows: the play order of the playlist the
music comes from, where it plays from (PLY-13), saved as it is everywhere, and Up next follows it. Music that is not
from a playlist (a scene's own track, a single track) has nothing to shuffle, so the button is there but greyed, with
"Only music from a playlist can be shuffled" on hover. Order in the music lane: Previous, Pause, Stop, Next, Shuffle,
Repeat, Fade out. Icons only, as the lane's other buttons.
**Why.** Pause keeps the place to come back to; Stop ends it, which Nik needs between scenes without Stop all ending
the other room and the effects.

## 10. Prep | Live in the Library

> "In library view I still need the Prep and Live toggle we have elsewhere."

**What.** The Library's top bar has the Prep | Live switch, before Add tracks, as the campaign page, the planner, Live
and Rooms have it. Prep is on; Live opens the session loaded in Live (Session 14 in the sample).
**Question.** Playlists and Pad boards have no switch yet either; see Questions.

## 11. Where Add scene puts the new scene

> "When I click add scene it should add at the end of the list, if no other scene is selected. If another scene is
> selected, it should add after that scene."

**What "selected" means.** The selected scene is the one Nik last opened, added, duplicated, moved or worked in (typed
in a field, added music, chose an ambience). Only one is selected. Its card has the accent edge (an open scene that is
not selected has a quiet edge now), and its name is read as "Scene 3: The abbey ruins, selected". Folding the selected
scene, deleting it, folding all scenes, or opening another session leaves no scene selected; opening a session selects
none.
**What.** Add scene puts the new scene right after the selected scene, or at the end of the list when none is
selected. Its hover text says which ("Adds a scene after Scene 3: The abbey ruins" or "Adds a scene at the end"). The new
scene opens with its name ready to type, and is then the selected one. ⋯ › Add a scene after this one is unchanged.
**Why.** In 0.5.0 Add scene went after the scene "last worked on", which nothing on screen showed.

## 12. Reorder the campaigns

> "I need to be able to drag and drop to rearrange the order campaigns are displayed in in the campaigns view."

**What.** Each campaign card has a drag handle at its top left (greyed until hovered). Drag a card by it onto another
card: dropping on the left half puts it before, on the right half after, so a card can go into the last place. The
accent line shows where it will land. The keyboard's way and a single click's (WCAG 2.5.7), as in the playlists'
Reorder: a **Reorder** switch in the top bar, beside New campaign, shows **Move earlier** and **Move later** (left
and right arrows) on each card while it is on; focus stays on the same button as the card moves. Alt+Left or Alt+Up
and Alt+Right or Alt+Down move the card that has focus. The order is saved, with the Saved pop-up, and the same
order is used wherever campaigns are listed.
**Why.** Nik keeps the campaign he runs this week first. Reorder is off at rest, so the cards keep round 6's reading
load.

## 13. A campaign's theme always shows

> "The campaign's visual theme should override the base / preference theme in settings. It currently does not."

**What.** A campaign's own theme shows on its card, its page, its sessions (the planner) and in Live while one of its
sessions is loaded, whatever Look and feel says. Look and feel's theme is the **base theme**: the Campaigns page, the
Library, Playlists, Pad boards, Tags, Rooms, Settings, Look and feel, and any campaign without a theme of its own.
Look and feel has a **Base theme** choice (the five themes) above the theme cards, with one line: "A campaign with a
theme of its own keeps it." Each card's button is **Use as the base theme**, or **The base theme** on the one in use.
The "Each campaign's own" choice is gone, and so is the campaign page's note "Look and feel is showing every page in
…". The Library and the other shared screens no longer take the last campaign's theme: they are in the base theme.
Someone whose choice was "Each campaign's own" gets the default, Candlelit Library, as the base, which looks the same
as before on every campaign's pages.
**Why.** Nik's words; and the old choice made one setting do two jobs.
**For the app.** `themeFor` becomes: a campaign route (campaign, session, live) with a campaign theme gives that theme;
everything else gives the base. `ThemeChoice` loses `"campaign"`; a stored `"campaign"` reads as the default.
**Sweeps.** Parchment as the base no longer reaches a campaign's pages, so the Parchment sweeps of The Sunken Crown's
page, planner and Live give the campaign Parchment as its own theme first.

## 14. Dragging into the last place, and the window's size

> "Dragging and dropping a scene into last position in the scene list doesn't work." "Dragging and dropping a session
> into last position in the session list doesn't work." "When fully maximised the bottom of the app pushes past the top
> of my bottom aligned taskbar." "The right hand side of the window goes beyond the edge of the screen, rather than
> stopping at it."

The prototype does both drags already (dropping on the lower half of the last row puts the dragged one last); the app
does not, and w51-fix mends it. New checks hold both. Lyre's page fits the window's content area exactly: nothing of it
is wider or taller than the window, the page never scrolls, and the menu, the screen and the Now playing bar end
inside it. A new check opens every sweep screen, with the Now playing bar showing, at 1920 × 1040 (a maximised 1920
window above a taskbar) and 1280 × 680. In 0.5.0 Nik's window ran past the taskbar with the Kenku FM tab bar on top
(the Lyre page was the window's height under a tab bar); with Lyre as the whole window (section 1), the main process
must also keep a maximised window inside the screen's work area.
The new check found a second cause, in the prototype and in the app's own `ui.css`: text for screen readers only
(`.sr-only`) is placed absolutely, and inside a scrolled list with no positioned parent it was placed against the
whole page at its spot far down the list, making the page up to 357 px taller than a 680 px window (a scene open in
the planner, the Audio profile, Live with a scene unfolded). `#app { overflow: clip }` keeps the page the window's
size; the app needs the same line on its root.

# Part 3: more from Nik's test of 0.5.0 (11 Nov, 20:33)

Nik added 14 findings at 20:33 (R6-NIK-DECISIONS.md, "11 Nov 20:33"). F9, the stutter, remote control, the Audio
profile crash in Live, dropping files on the Library, the updater message and Ctrl+Z are faults for w51-fix and
w51-main. These six change what is on screen.

## 15. Fades of 5 seconds

> "Let's make the standard for our fade buttons 5 rather than 3 seconds."

**What.** Fade all (`Shift+Esc`) and the Fade out button of each lane in On air fade over 5 seconds (`L.FADE`); their
hover text, Keys ("Fade all (5 s)") and help article 10 say 5. The crossfade between tracks is Settings › Sound to
Discord's own (3 s by default) and does not change; nor do a step's "Fade the music … over" choice or Stop (a second).

## 16. Rooms from Live

> "I can't choose what channel my bots join from the live view - I need to be able to do that, and to add a second bot
> to the live view, and a channel on the table from that view, or more, I don't want to have to tab to the rooms tab."
> "I don't see an undo button for kicking a bot in the live view, and when I kick a bot and re-add it the music doesn't
> come back - the on air view clears of all playing music"

**What.** Rooms' actions are in On air already, in place: each room's bot button opens "Lyre Table plays in" (every
channel, the room's own ticked, where the players are marked, a channel that is a room already greyed), another free
bot for this channel, and Copy what another room plays; its menu now also has **Kick Lyre Table from Table**. Kick
stays beside it. Choosing a channel moves the bot at once. **Add a room** (+ in On air's header) is always there now:
it lists each free bot with the channels it can join, and **Add a bot…** opens Settings' three steps over Live
(before, + was missing once every bot was in a room, and its last item left Live for Settings).
**Undo after Kick.** Kick shows the Undo strip at the top of On air after every Kick (before, only when the players were
hearing something, which is why Nik saw none), for 8 seconds, with focus on Undo and an accent edge so it is plain to
see; Undo, or `Ctrl+Z`, puts the bot back in its channel with what it played, where it was. Kicking and adding the
bot back by hand starts the room silent, as a new room does; Undo is the way to get the music back, and the strip says
so by being there.
**Why.** Nik's words. On air's reading load stays as it was: nothing new shows until a menu opens.

## 17. A split headset only while On air plays too

> "Splitting headset should only apply if there is a live track playing simultaneously, it shouldn't apply if it would
> be the only track playing"

**What.** With Split one headset on, the preview is in one ear and On air in the other only while something plays on
air. A preview on its own plays in both ears; when On air starts, it moves to its ear. Settings says so under the switch
("Only while something plays on air; a preview on its own plays in both ears."), the switch's hover text starts "While
On air plays too", and help article 11 says the same.
**For the app.** The headphone mix pans the preview only while a room is playing (not paused) on this computer's
monitor; a short pan (about 0.3 s) when that changes, so it does not jump.

## 18. Start at a marker

> "We need a "Start at [select marker]" Option in the detailed audio profile view, to set the default option to have a
> track start at a given marker, rather than having to click the play live button every time."

**What.** The Audio profile's Markers box starts with **Start at**: Beginning (the profile's Start), or any marker
between Start and End. The track then starts there wherever it plays: Play on air from the Library, Live, a scene, a
playlist, the Now playing bar, Up next, and the Audio profile's own preview and Play on air. Like every other profile
choice it belongs to the settings shown: the track's own, or a place's (a scene, a session list, a playlist) when that
place has its own settings, which then win there. On the waveform the chosen marker's flag is in the accent colour and
reads "Starts here: Low swell". Removing that marker, or moving Start or End past it, puts Start at back to Beginning.
Play on air from a marker still plays from that marker. In the Now playing bar and On air, Home goes to where the track
starts (the marker); the slider can still go back to the profile's Start.
**For the app.** `profile.startAt` (a marker's time, or none); the engine starts a lane at `startAt ?? start`.

## 19. Live first in the menu

> "Let's move the live tab to the top of the left side bar"

**What.** Live ("Live: S14") is the first entry of the menu, above Campaigns. Rooms stays last of the upper group.

## 20. Pick up where it stopped, for every music track

> "I don't see pickup where it stops in details or audio profile views for a track"

**What.** Pick up where it stopped showed in a track's details only for an underscore or a loop bed. It now shows for
every music or ambience track that is not a sting, whatever its role, and for a track with no role yet, with the same
words ("Pick up where it stopped"; hover: "Starts again where it was last stopped, the next time it plays"). Ending and
Then still follow the role. It stays in the track's details (the Library), not the Audio profile: it is about the
track, not about where it starts or ends in a place.

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

Part 2, also marked "retire":
- `live.spec.ts` (5): Stop beside Pause, ending the room's music only; Shuffle beside Repeat, greyed for music from no
  playlist; both in each room's part with two rooms; the music's position slider (24 px, its name and value, click,
  drag, Left, Right, Home, End); the ambience's slider.
- `campaigns.spec.ts` (5): the Now playing bar's position moves while playing and is a slider; a session dragged into
  the last place; campaign cards dragged before, after and into the last place; Reorder and Alt+arrows; a campaign's
  theme on its page, planner and Live with Parchment as the base, the base on the Library.
- `session-planner.spec.ts` (4): Play on air on each track of a scene's playlist, after Preview, playing it from that
  playlist; Add scene at the end with none selected; after the selected scene, and none selected once folded; a scene
  dragged into the last place.
- `library.spec.ts` (1): Prep | Live in the Library. `look.spec.ts` (1): the Base theme choice, no Each campaign's own.
- `sweeps.spec.ts` (2): every sweep screen fits 1920 × 1040 and 1280 × 680, with the Now playing bar showing.
- Changed: the Parchment sweeps of The Sunken Crown's page, planner and Live (section 13).

Part 3, also marked "retire":
- `live.spec.ts` (5): Fade all and Fade out say 5 seconds, Keys "Fade all (5 s)"; the bot button chooses a channel and the
  room moves; Kick beside it and in its menu, Undo after every Kick with focus on it; Undo brings the music back;
  Add a room always there, with Add a bot… in place.
- `settings.spec.ts` (1): the split headset's line. `help.spec.ts` (1): articles 10 (5 seconds) and 11 (the split).
- `audio-profile.spec.ts` (2): Start at's choices and the "Starts here" flag; Play on air from the Library starts there.
- `library.spec.ts` (1): Pick up where it stopped for any role but a sting. `sweeps.spec.ts` (1): Live first in the menu.

All part 1 checks failed on the 0.5.0 prototype first (the specs commit came before the design). Parts 2 and 3 were
written with the prototype's changes and pass on it; they were not run against the 0.5.0 prototype.

## Numbers

Not measured with `tools/r6-measure.js` this round. On screen, Live gains no words: part 2 adds icon buttons (Stop,
Shuffle) and turns the existing position bars into sliders; part 3 adds Kick to the bot button's menu. The Library's top bar gains Prep | Live (two words).

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

Part 2:

10. Session 14 › open The abbey ruins (its card has the accent edge: it is selected) › unfold Abbey: eerie: each track
    ends with Play on air. Press it on the second track: the Now playing bar says "Scene: The abbey ruins · Abbey: eerie,
    low energy". Click in the bar's position line to jump; Tab to it and press Right.
11. Add scene: the new scene comes right after The abbey ruins. Fold it, press Add scene again: the next goes at the
    end.
12. Live › Start scene 3: in On air, Stop sits after Pause, Shuffle (greyed: the scene's own track) before Repeat.
    Session playlists › Play on air on Wistful with some warmth: Shuffle works. Click or drag the position line.
13. Library: Prep | Live in the top bar; Live opens Session 14.
14. Campaigns: drag The Sunken Crown by its handle onto the right half of Ash and Masks; then Reorder › Move earlier.
15. Look and feel › Base theme › Parchment: the Library is light; The Sunken Crown, Session 14 and Live stay in Hearth
    and Iron.

Part 3:

16. Live (first in the menu): hover Fade all: 5 seconds. Lyre Table ▾ › Choose a channel › Side room: the room moves.
    Kick: Undo at the top of On air; Undo. + › Lyre Side joins…; + again › Add a bot….
17. Settings › Headphones and speakers › Split one headset: the line under it.
18. Library › t13 › Audio profile › Markers › Start at › Low swell: "Starts here" on the waveform; Library › Play on air
    on t13: the bar starts at 3:10.
19. Library › Ashes (no role): Pick up where it stopped in its details.

## Questions for Nik

1. **The update failure card stays until you dismiss it.** Recommendation: keep it so; it shows once per failure,
   and a card that went away by itself could be missed mid-game. The alternative is to let it go after a minute.
2. **The window's buttons are 36 px tall, the strip 44 px.** Recommendation: keep 36 (Windows' usual size); 44 would
   line them up with the strip's bottom edge at 100 % text only.
3. **Shuffle in On air when the music is a scene's own track.** It is greyed: only a playlist has a play order to
   shuffle. Recommendation: keep it so for 0.5.1. The alternative, shuffling the scene's own music list, changes
   what a scene is (an order Nik planned) and needs its own small design.
4. **Shuffle is the playlist's play order, saved.** The same button as in the Now playing bar, so turning it on in
   Live also shuffles that playlist the next time it plays from the same place. Recommendation: keep one meaning.
   The alternative is a Shuffle for tonight only, like Repeat, which would mean two different Shuffles.
5. **The Library, Playlists and Pad boards are in the base theme now**, not the last campaign's. Recommendation: keep
   it so (one rule: a campaign's pages in its theme, the rest in yours). The alternative keeps the last campaign's
   theme on those shared screens.
6. **Prep | Live on Playlists and Pad boards too?** You asked for the Library. Recommendation: yes, on every Prep
   screen's top bar, in 0.5.2, so the switch is always in the same place.
