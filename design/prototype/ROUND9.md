# Round 9: design round 8 of 0.6.0, from Nik's play test (14 Nov 2026, list sent 18 Nov)

> "Where I have the bots do a usability, UI and UX review, have them do an actual visual review and click through of
> the app." (57)

This round answers items 5, 8, 16, 18, 19, 22, 26, 27, 31, 32, 33, 34, 38, 42, 44, 47 and 56 of Nik's list
(`/root/kenku-wt/NIK-PLAY-2026-11-14.txt`). Before anything was drawn, the packaged 0.5.1 test build was clicked
through by mouse and keyboard with the sample library and two fake bots, at a whole window and at half a 1920 screen.
The findings, with screenshots, are one report per area (the lead has them: `scratchpad/r8/reports/`, 00 to 12). This
file says what the prototype now shows and why. The whole-app review of item 58 comes next, with other agents.

The rules of rounds 6 to 8 hold: little to read in Live, plain words, one Saved pop-up place, no resting statuses,
Lyre's existing kit and look. New code is in its own files (`src/views/r9nav.js`, `r9track.js`, `r9lists.js`,
`r9live.js`, `r9guide.js`, `r9.css`), loaded last; the existing screens changed only where they had to (each change is
marked "Round 9" in the code). New help articles are in `design/prototype/help-drafts/` (10, 16 to 21).

## 1. One rule for names, the Track panel, a trail that follows the route (items 16, 22)

> "Let's make the navigation from playlists to tracks to scenes easier and more intuitive" (16)
> "I want to be able to see and edit track details in the playlist view" (22)

**Seen.** A track's details exist only in the Library: a track title on a playlist page leaves the playlist for the
Library (and the Library's list does not scroll to it). The Audio profile's trail always says Library, even from a
playlist. The same playlist name unfolds a row in one box and leaves the session in another.
**What.** A track title anywhere outside the Library (a playlist page, the Playlists list, the session planner, Add
music, Live's **All details**) opens the **Track panel** at the right of the work area, beside the screen, with the
Library's own details: the same controls, so editing is the same. **Open in Library** and **×** (Esc) are in its head;
focus returns to the title that opened it. The row of the track it shows is marked. Below 1000 px of app it lies over
the screen's right side, as Help does. In Live the panel docks as a column, so Live's controls stay in view.
The Audio profile's **trail follows the route**: *Playlists › Crypt ambush ›* from a playlist, *The Sunken Crown ›
Session 14 › Crypt ambush ›* from a scene, and its last part, **Track details**, goes back to the track's details
there (item 3: `#/playlist/<pid>/<tid>` and `#/session/<cid>/<sid>/<tid>` open the place with the panel open; from the
Library it is the Library's details). A scene in a track's
**Used in** opens the session with that scene unfolded and focused.
**For the app.** One `TrackPanel` reusing `TrackDetails`; routes take an optional track. Item 36 (the Library scrolls to
the open row) is 0.5.2 and Open in Library depends on it.

## 2. Rooms in Live, bots in Settings (item 56)

> "Need to simplify and streamline bot and room management, and have all of the live joining of rooms and such done
> just from the live view, and all of the configuration stuff done from bot settings." (56)

**Seen.** Joining, moving, muting and volume were in two places (Rooms and Live); Live's button that moves a room was
named after the bot ("Lyre Table ▾") while Rooms named its card after the room; Live's menus held Add a bot… and a link
to Rooms; Kick and Leave named one action.
**What.** In **On air** each room's **name is the button** that moves it ("Table ▾"): *Move Table to* every voice
channel, *Copy what … is playing*, **Leave Table**, then a quiet "via Lyre Table" and *Use Lyre Side instead* when a bot
is free. **Kick** is **Leave** everywhere. **+ Room** (word and icon) lists voice channels; Lyre takes a free bot itself
(the one set to join that channel, else the first free); with none free, one line says where bots are added. The
**Rooms** menu item is gone (`#/outputs` opens Live). **Settings › Discord bots** keeps everything about bots and gains,
per bot, **Joins when Lyre starts** (a voice channel, or No) and **Starting volume**.
**For the app.** The bridge needs a per-bot start channel and starting volume (saved with the bot), applied when a bot
logs in. The Rooms screen and its specs retire; Live's room menu loses Add a bot… and Rooms.

## 3. Use it for, and At its end (item 18)

> "Need to be have more intuitive roles than we currently do." (18)

**Seen.** Role (Loop bed, Underscore, Sting, Transition), Looping (advice), Ending, Then and the Audio profile's At the
end all describe what happens at a track's end, in different words, and can disagree.
**What.** Two rows in a track's details: **Use it for**: *Background* (sits under the scene and keeps going), *Scene
music* (plays through, then the next track), *Short cue* (a few seconds for a moment, then stops), *Lead-in* (leads into
the next scene or track); FX tracks show *Sound effect*. **At its end**: *Loop · Loop with a crossfade · Next track ·
Fade out · Stop · Play…*. Choosing a use picks the usual end until Nik picks one himself. Under them, **Next time, start
where it stopped**, and one summary line ("Background · loops with a 3 s crossfade."). Elsewhere the words follow:
*FX · Short cue*, *Leave out short cues*.
**For the app.** The stored roles stay; only the words change (`roleWord`). The end becomes one field that writes the
existing loop, fade and follow settings.

## 4. Set up Lyre, and a tour for every screen (item 19)

> "Need a much better tutorial, covering much more of the functionality, and giving a guided setup for all elements of
> the app" (19)

**Seen.** Five one-line popovers pointing at the menu; the last at an empty bar. Help always opens at its list.
**What.** Help (F1) now starts with **On this screen**: *Tour of this screen* and the screen's own article. Then **Set
up Lyre**, nine tasks in the order a new table needs them (connect a bot, put it in a room, add music, tag a few tracks,
make a playlist, plan a session and its scenes, build a pad board, run a scene in Live, choose a look), each ticked by
itself when the library has what it needs, each with **Show me**: Lyre goes to the screen and a short walk points at the
real controls (Back, Next, Skip, Esc), placed beside the control where there is room. Steps whose control is not on
screen are left out. Help's menu item shows the progress ("8/9") until all is done or the checklist is hidden. Tours
exist for Settings › Discord bots, rooms in Live, the Library, a track's details, Playlists, the session planner, a pad
board, Live and Look and feel.
**For the app.** The tour component gains steps per screen and placement on any side; the checklist reads the library.

## 5. Arrange Live's boxes (item 44)

> "I need to be able to dynamically move panes around by dragging and dropping and resize them on the live view" (44)

**Seen.** Fixed layouts by width; On air grows by a line when a pad fires and everything under it jumps; at half a
screen an unfolded Up next takes 39 % of the height.
**What.** **Arrange** in Live's strip. In Arrange mode each box has a bar: a **grip** to drag it (a line shows exactly
where it lands, above or below a box, or into an empty column), **Move up / Move down / column left / column right**
buttons, and **Height − / +** (a fixed height scrolls inside, with a fade at its foot) with **Fit** to go back. Between
columns a **splitter** to drag, with narrower/wider buttons. A spare empty column takes a box to make a new column (up
to four). The boxes' contents cannot be clicked while arranging. **Done** keeps the layout for this window size (whole
window, half a screen and narrow are kept apart); **Put back the usual layout** returns 0.5.1's. **On air** stays at the
top, the whole width (Nik, 6 Nov), and can be given a fixed height here. Alt+1…7 and F6 follow the boxes in their new
order.
**WCAG 2.5.7.** Every drag has buttons that do the same.
**For the app.** Layout per width in `this-computer.json`; boxes render from it.

## 6. The queue, with Back and Forward (item 31)

> "When previewing a playlist, or any queue of music, I need to be able to see the now playing queue, select any track
> in it to play, and have back and forward buttons on the now playing bar" (31)

**What.** The Now playing bar has, for a room and for a preview alike: **Back** (the previous track; after 3 seconds the
start of this one), Pause, Stop, **Forward**, and **Queue n**. Queue opens a panel just above the bar (never over it;
the Saved pop-up moves above it): *Played*, *Now playing*, *Up next*, each row with **Play** (the queue carries on from
there) and the playlist's dividers as headings. Previewing a playlist now plays it through in its play order, Only
you. In Live, each room's Up next rows have **Play now**.
**For the app.** The preview player keeps a queue (`queue`, `qi`) and moves on at a track's end.

## 7. Columns, filter order, hiding (items 26, 27, 34)

> "I need a way to configure the columns visible in the library tracks pane" (26); "filters sorted either
> alphabetically (ascending/descending) or by number of things in that filter" (27); "the ability to choose filters
> /not/ to show" (34)

**What.** **Columns** beside the Sort menu: Artist, Album, Type, Use it for, Tags, Shape, Energy, Length, **Plays for**
(the length after the Audio profile, item 7), Added, Folder; Put back the usual columns. **Headers sort** (A to Z, then Z
to A, with aria-sort; item 25). The Filters box's **order** button: Tag list order, A to Z, Z to A, Most tracks first.
Every filter chip has three states: off → **Show** (✓) → **Hide** (✕, struck out, dashed warning edge, "hidden" read
out) → off; one short line at the top says so. A folder's ✕ hides its tracks. The box's summary reads "Tense · not
Combat". Clear all clears both.
**For the app.** The filter model gains `hide` per group, shapes and folders; columns and order are kept on this
computer.

## 8. Playlists: order, sort, dividers everywhere, dragging between lists (items 32, 38, 42)

> "drag tracks from one playlist to another, or from one playlist into a scene music list" (32); "drag and drop and
> reorder playlists in the playlist list, I also need the ability to sort it" (38); "The dividers in playlists need to
> appear wherever playlists are visible" (42)

**What.** The Playlists list has **Sort** (Your order, Name A to Z, Name Z to A, Most tracks, Longest, Most used,
Newest); in Your order each row has a **grip** (an exact line shows where it lands), ⋯ has **Move up / Move down / Move
to the top**, and Alt+↑/↓ on a row does the same; dragging while sorted switches to Your order and says so.
**Dividers** show wherever a playlist's tracks are listed: the Playlists list, the session planner, Add music, Live (each
with **Play from here**) and the queue. In the planner, any track in an unfolded playlist can be **dragged** to another
manual playlist's row or a scene's Music list (they light up), or to the **Drop on** tray; Shift moves it out of the
manual playlist it came from.
**For the app.** The prototype adds a dropped track at the end of a scene's music; the app puts it at the line, as the
reorder drags do (item 37's exact placement).

## 9. A floating Add music panel; the Follow with picker (items 33, 5)

> "I need to be able to drag the add music to scene dialoge around and resize it so I can see what's behind it." (33)
> "Better interface (inc. search and splits by playlist, fx, ambience, ordinary track) for follow with picker" (5)

**What.** **Add tracks or playlists…** opens a panel that does not block the page, docked at the right of the work area
under the top strip. Drag its title to move it; its corner to size it; **Dock left / Float / Dock right** in its title;
its **Move** button takes the arrow keys (Shift: size; Home: dock right). It remembers where it was.
**Follow with** (At its end › Play…) is a picker: **When it ends, play**, the track named under it, a search, **All ·
Playlists · Music · Ambience · FX** with counts, results grouped under those headings with Preview, **Nothing** at the
top; double-click chooses.
**For the app.** `Dialog` gains a non-modal floating variant (no focus trap, Esc closes, focus returns).

## 10. Split into parts (item 8)

> "Split tracks into multiple at split points in audio profile using markers" (8)

**What.** The Audio profile's Markers box has **Split into parts…** (with no marker it says to add one). The dialog
lists the split points (each can be unticked) and the parts with an editable name, from–to, length and Preview, and two
choices: copy tags, Type and use to each part (on), add the parts beside the track in its manual playlists (off).
**Make n tracks** creates tracks that play their part of the same file; **the file is never changed** and the whole track
stays. A part's details say "Part of … (2:30–6:01)"; the whole track's list its parts. Undo removes them.
**For the app.** A part is a track with `partOf { trackId, start, end }` sharing the file; playback uses start and end.

## 11. Dip the music under effects (item 47)

> "Let's definitely build dip music for sound effects (pad effects)" (47)

**What.** **Settings › Sound to Discord › Dip the music under effects**: how far (*Off · A little · A lot*), *Comes back*
(*Quickly · Gently · Slowly*), *Ambience dips too*. Each pad: **While it plays**: *The usual* (one-shot and restart
pads dip, loops and hold-to-play don't) · *Dip the music* · *Don't dip*; pads that dip have a small mark and say so in
their name. While a dipping effect sounds, the room's music line says **Dipped**.
**For the app.** PLY-7 (now decided): −6 dB / −12 dB, 0.1 s down, 0.5 / 1.5 / 3 s back; the dip lasts until the last
dipping effect ends and does not stack. A Short cue played over the music dips it the same way, with the same
switch in its details (not drawn in the prototype).

## Specs
The prototype project's acceptance specs were run after these changes (`playwright.spec.config.ts --project=prototype`);
the checks that fail are the ones this design changes on purpose (the Rooms screen and its menu item, Kick, the bot
button in On air, the role and looping chips, the modal Add music sheet, the two-state filter chips). Round 9's own
checks are for the build stream to write (marked `appOnly()` where the prototype lacks something), after Nik approves.

## Try it (about 15 steps, whole window)
1. Playlists › Crypt ambush (open its page) › click a track's name: the Track panel opens at the right. Change its
   **Use it for** to Background; At its end becomes Loop with a crossfade. Esc closes it.
2. On that track: **At its end › Play…**: type "bells", pick the ambience, Done.
3. Its **Audio profile** (from the panel): the trail says Playlists › Crypt ambush; add two markers on the waveform,
   then **Split into parts…**.
4. Library: **Columns** › tick Plays for and Artist; click the Plays for header twice.
5. Filters: click *Tense* once and *Combat* twice; the summary says "Tense · not Combat". Try the order button.
6. Playlists: **Sort** › Name A to Z, then drag a grip: the list goes back to Your order.
7. Campaigns › The Sunken Crown › Session 14 › open Crypt ambush › **Add tracks or playlists…**: drag the panel by its
   title, Dock left, Float.
8. In the same session, unfold a playlist and drag a track's name onto another scene's music or a playlist row.
9. Preview a playlist from Playlists: **Back**, **Forward** and **Queue** on the bar; Play a row in the queue.
10. Live: press Space; click the room's name (**Table ▾**): Move to, Leave, via Lyre Table. **+ Room**.
11. Fire *Thunder crack*: the music line says **Dipped**.
12. **Arrange**: move Current scene with its arrows, make On air shorter, drag a splitter; Done.
13. Settings: a bot's **Joins when Lyre starts**; Sound to Discord's **Dip the music under effects**.
14. A pad board › a pad: **While it plays**.
15. F1: **Tour of this screen**, and **Set up Lyre** › Show me.

## Questions for Nik
1. **Track panel in Live**: a track's All details opens the panel beside Live (recommended), or goes to the Library?
2. **Rooms screen**: remove it (recommended), or keep a read-only "who is where" page under Settings?
3. **Bots on start**: join their starting rooms by themselves when Lyre starts (recommended), or wait until Live opens?
4. **Words for uses**: Background / Scene music / Short cue / Lead-in (recommended), or keep the old four with a line
   of help each?
5. **First start**: show Set up Lyre (recommended), or the short tour first and the checklist after?
6. **Arrange**: one layout per window size (recommended) or one for all; and may On air move like the other boxes, or
   stay at the top (recommended)?
7. **Back on the bar**: previous track within 3 seconds, else the start of this one (recommended), or always the
   previous track?
8. **Hiding filters**: three states by clicking a chip (recommended), or a separate Hide switch?
9. **Dragging between playlists**: copy, with Shift to move (recommended, as from the Library), or move by default?
10. **Add music ticks**: apply at once with Undo (recommended) or keep Cancel and Done?
11. **Parts**: tracks that play part of the same file (recommended), or real new audio files?
12. **Dip amount**: A little (recommended) or A lot by default; may Toggle loop pads dip (allowed, off by default)?
