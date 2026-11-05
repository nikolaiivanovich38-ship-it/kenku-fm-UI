# Round 5: Nik's notes after testing Lyre 0.3.0 (5 Nov 2026), and the design answers

Each note is quoted as Nik wrote it, with the design under it: what the prototype shows, where to try it, and the rule
behind it. Rules shared by the data, the engine and the screens are tested TypeScript in
`src/common/domain/round5.ts` (tests in `round5.test.ts`); the prototype's `core.js` uses the same rules.
Acceptance specs: a `round 5` block in each of the session planner, campaigns, playlists, library, pad boards, audio
profile and Live spec files, the new `e2e/specs/library-files.spec.ts`, and three screens in the sweeps; in the app
they wait for wave 4 (`expectFailureUntilBuilt("round 5")`, docs/testing.md).

## Play order (PLY-13)

> "Let me set playlists to random, repeat all, repeat one in all views of the playlist, including the prep menus, and
> when I set those settings for a given context have it only apply to that specific context"

- **One button, everywhere a playlist is shown**: Playlists (each row, and by Play on air on a playlist's page), the
  campaign page, the session planner (session playlists and each playlist in a scene's music), Live (each playlist in
  the scene's list, and a session or campaign playlist) and the On air bar. It shows two small icons: shuffle (or in
  order) and repeat (all, one, or faded for none). It opens a menu: **Shuffle** (tick), then **No repeat**,
  **Repeat all**, **Repeat one**, each with a line saying what happens.
- **Only where you set it.** On the Playlists page it is the playlist's own order. In a scene, a session list or a
  campaign list it is that place's order: the menu says "Play order in the scene The abbey ruins", "Only in the
  scene The abbey ruins. Elsewhere: In order, repeat all.", and **Use the playlist's own order here** takes the
  choice away. A place with its own order has an accent edge and dot on its button. A session's choice does not reach
  its scenes: each place is its own.
- **What the words do** (rule `whenTrackEnds`): Repeat one plays the same track again until Next. Repeat all starts
  the playlist again after its last track (in a scene, the scene stays on that playlist until you press Next past
  it). No repeat: in a scene the scene moves on to its next item; on its own the playlist stops after its last track.
  Shuffle plays the tracks in a random order; Live's lists, Up next and the scene's order show that order.
- **Without a choice** (rule `resolvePlayOrder`): a playlist on its own plays in order and repeats all (as Kenku FM
  did); in a scene it plays in order and the scene moves on (as the scene list has done since round 3).
- Samples: "Abbey: eerie, low energy" is shuffled in The abbey ruins only; "Wistful with some warmth" is shuffled and
  repeats in Session 14's list; "Combat: big and loopable" is shuffled everywhere (its own order); ambience playlists
  repeat all.

## The Now playing bar and destination tags (UX-16)

> "No volume controls in the now playing tab on the prep menus"
>
> "The general rule when there is music playing is that there should be the now playing bar with music details,
> origin and controls at the bottom of the screen, and it shouldn't be there when music isn't playing, unless the
> music is paused rather than stopped"

After reviewing the first round 5 prototype (5 Nov, 21:17 and 21:18):

> "In your design prototype the now playing bar only works in the live view, not in the prep view, and the now playing
> bar should have clear indications what is playing and whether it is through the live output or to me - and I should
> be able to have /both/ playing. It's a universal bar that appears when any music is playing. When I have two outputs
> going it should show both, clearly indicating which output each is going to."
>
> "It's actually a lot less necessary in live than it is in prep, because in live I have the outputs view - the only
> thing it's necessary for in live is stuff played only to me in my headphones, the preview sounds. But we should come
> up with a universal design language for it."

The first version showed only what the players heard, so a preview, most of what happens in prep, never brought it up.

- **Destination tags, the same everywhere sound is shown** (rule `L.destTag` in the prototype): every sound says where
  it goes, in words, with an icon and a colour, never by colour alone.
  - **On air**: filled in the on-air colour, broadcast icon: the players hear it. With two or more rooms it names the
    room ("On air · Side room"); with no bot in a voice channel, "On air · no room" and "only this computer plays it".
  - **Only you**: outlined in the preview colour, headphones icon: a preview, only you hear it.
  - Paused, a tag turns grey and a **Paused** badge stands beside it.
  - The tags replace the old red "On air" badges in the Library, Playlists, pad boards, the Audio profile and Live's
    lists, and a row being previewed shows **Only you** too. Look and feel lists both.
- **The Now playing bar** sits at the bottom of every screen while anything plays or is paused and goes when
  everything stops. It has one row per room that is playing (music or ambience) and one row for the preview, so a
  preview and music on air show together, as do two rooms. The rows share one grid, so their parts line up.
  - A room row: the On air tag, the track (the scene's name for it, its own name on hover), **where it comes from**
    ("Scene: The abbey ruins (Session 14) · Abbey: eerie, low energy", "Playlist: The Company themes · The Sunken
    Crown", "Single track"), the ambience under it and how many effects sound in that room, the time, **Pause/Play**,
    **Stop** (that room only), **Next**, the playlist's **play order** for where it plays from, that room's
    **Volume** (the same as Live's room slider), and **Go to Live** on the first row.
  - The preview row: the Only you tag, the track, where it was previewed from ("Previewed from the session planner"),
    the time, **Pause/Play**, **Stop** and the **headphone volume**.
  - **In Live** the On air boxes show what each room hears, so the bar there has the preview row only.
- Effects alone do not bring up a row (they are short); Play on air on an effect says "Effect on air: …".
- At narrow widths the time folds away first, then the volumes and the Paused badge (the tag still turns grey).

## Single tracks from a playlist in the picker (ORG-10)

> "When I expand a playlist on the add tracks or playlists menu I should have a checkbox against each track, allowing
> me to select just that track, not the whole playlist"

- In **Add tracks or playlists…** (a scene's music), opening a playlist with its arrow lists its tracks, each with
  its own box, tags, length and Preview. A ticked track is added on its own; the playlist's own box still adds the
  whole playlist. The same track in the Tracks list below ticks with it.

## Tags where music is chosen (ORG-11)

> "No tags visible on the prep and music choice screens"

- Scene music rows in the session planner, session and campaign lists (single tracks, and a playlist's tracks when
  opened), the music picker and Live's opened rows show each track's tags: small chips with their tag group's dot
  (Mood gold, Leitmotif pink, Scene type blue), the first three then **+n** (the rest on hover), with the shape glyph
  first. In the planner they sit on a second, smaller line under the name so the name keeps its width. Below 820 px
  only the first tag and +n show.

## Track shape (DAT-13)

> "There needs to be another type of descriptor for the journey of the track - whether it stays flat, whether it
> builds, whether it peaks and then troughs, whether it's up and down"

- Five shapes, each a word and a small line drawing: **Steady**, **Builds**, **Falls away**, **Peaks then falls**,
  **Rises and falls**.
- Lyre suggests one from the track's loudness (rule `shapeFromPeaks(levels)` on 0-1 dB-scale peak levels: steady
  within 0.15; two or more turns of at least 0.12 rise and fall; a high point well above both ends peaks then falls;
  ending well above or below the start builds or falls away). The GM's choice wins; choosing the suggestion again goes
  back to following it.
- Shown in a track's details (Library › a track › How it plays › Shape, with "Suggested by Lyre…" or "Your choice"),
  in the Library list beside the tag, in the tag strips, and in the Audio profile header. Usable as a Library
  **filter** (Filters › Shape) and in **dynamic playlist rules** (Rules › Shape; none pressed means any shape; rule
  text "shape builds or peaks then falls").
- The Audio profile's waveform now follows the same loudness curve, so the drawing and the suggestion agree.

## A track's name in a scene (DAT-14)

> "I want to have two names for a track - a name specific to a scene it's in, and a name overall (as well as the file
> name and path)"

- In the session planner, a track's ⋯ › **Name in this scene…** gives it a name for that scene only ("Strahd's
  entrance"); empty uses its own name. It also sits in the Audio profile header when opened from the scene.
- In that scene (planner rows, folded scene chip, Live's lists and On air box, the On air bar) the scene's name shows,
  with its own name on hover and on a small second line in the planner. Everywhere else its own name shows (rule
  `trackNameIn`: scene name, else your title, else the title in the file, else the file name).
- Library details list **Names in scenes** with Your title, Title in the file, File name and Folder.
- Samples: Aftermath calls t07 "Dawn over the abbey"; Crypt ambush calls t39 "The wight rises".

## Dynamic playlist: Details with the rules (EDT-8)

> "When create a dynamic track, Details pane should be at the top of the page in the collapsed view, rather than
> pushed to the bottom, and should be with the rules pane."

- A dynamic playlist's page is Details (folded, its summary "Dynamic · Music"), Rules, Matching tracks in the main
  column; Used in on the side. Narrow windows stack the main column first, so Details stays at the top. A new
  playlist opens with Details unfolded to name it. Manual playlists are unchanged.

## Use in… on tracks (ORG-12)

> "Similar to the detailed view of playlists, I want a 'Use in' button on tracks"

- **Use in…** in a track's details (by Play on air, and in Used in) and in track menus (Library rows, a playlist's
  track rows, scene tracks in the planner). The same picker as playlists: a campaign (on hand all campaign), a
  session (that evening), or scenes (its music; an ambience track becomes the scene's ambience). It is ticked where
  the track is used already.
- Tracks kept on hand show under the playlists in the campaign's and session's lists ("Single track"), and in Live's
  Session and Campaign menus under "Single tracks". Library details say "On hand in …". Rule: `usesOfTrack` now lists
  campaign and session uses.

## The track's waveform, end and fades from a scene (PLY-14)

> "I want an easy way to access the track's waveform, at the end, and fades details tab in scenes view, so when I'm
> adding a track I can quickly configure what happens with it in that scene. When opening the view from the scene or
> session, it should open by default to the track's settings for /that scene or session/ and maintain its context."

- Each track in a scene's music has a wave button: **Waveform, end and fades in this scene**. A playlist's tracks have
  the same button when the playlist is opened in the scene. A session's single tracks have it in their ⋯ menu, and a
  session playlist's tracks when opened: those open the **session's** own settings (new place "Session list").
- The Audio profile opens on that place's settings (read-only "uses the track's" until **Give this place its own
  settings**), stays there until the GM picks another place under Settings for, and **Back to <scene>** returns to
  the session planner with that scene open and the track's button focused. Rule `profileKeysFor`: scene, else
  session, then the playlist, then the track's own.

## Resizing a board (SFX-11)

> "When I change the size of the pad, it should autofill the buttons left to right top to bottom, rather than spilling
> tracks whose buttons/pads have been lost into the spare pads view. Only spill into that view when there are no
> slots free to populate"

- After any resize the pads fill the grid left to right, top to bottom, in their order, followed by the spare pads;
  only pads that do not fit go to Spare pads. The message says what happened ("Grid is now 4 × 1 and full. 4 pads
  moved to Spare pads: …. Nothing was deleted." or "2 spare pads came back onto it: …"), with **Undo**. Rule
  `reflowBoard`. Gaps close. A pad you put in Spare pads by hand stays there however large the grid gets, and the
  message says so ("Mugs clink stays in Spare pads, where you put it."); only pads a resize moved come back (question 2).

## Trying a pad (SFX-12)

> "When configuring a pad I want a play button on the pad to preview the sound to myself"
>
> "There's no way to test the function of the pad"

- Every tile has a violet **▶** Preview button (only you hear it), clearer than before.
- **Try pads** in the Pads header: while on, pressing a pad, or its key, plays it as it will play in Live, in your
  headphones only: one-shot plays once (quick presses overlap), restart on press starts again, toggle loop starts and
  stops, hold to play sounds while the mouse, Space, Enter or its key is held. Tiles show "Playing" or "Sounding" in
  violet; the box status reads Trying. Leaving the board stops it.

## Three screens that had none (DAT-7, the move report, DAT-8)

Reached from the ⋯ beside Add tracks in the Library, and from links on the screens.

- **Back up, move or share** (`#/backup`): Save to a file: the whole library, one campaign, session, scene, playlist
  or pad board, or the tags only; **Include the audio files** (with a size, or the reason to leave them out).
  Open a file: drop or choose a .lyre file; it shows what is in it, new or already yours, and for each duplicate
  **Skip**, **Merge** or **Keep both** (or the same for all) before **Bring in**. A file that is not a Lyre file, or is
  damaged, is refused in plain words and nothing changes.
- **What came across from Kenku FM** (`#/moved`): what Lyre copied on its first start and where it is now
  (playlists, tracks, soundboards as pad boards, sounds as pads, bookmarks as website tabs), the files it cannot find
  with **Find them…**, and what it did not bring across.
- **Find missing files** (`#/relink`): the missing files; **Look in a folder** (type, choose, or drop a folder);
  a confirm table with each file's new place and **How sure** (same name and size: ticked; same name, different size:
  not ticked, with Preview; not found); **Relink n files**, with Undo. Library rows show **Missing** and Filters has a
  **Missing** filter. Samples: three files moved (t19, t26, t37).

## Words added
Play order, Shuffle, No repeat, Repeat all, Repeat one, Use the playlist's own order here; Now playing, On air · <room>,
Only you, Previewed from …, Headphone volume; Paused; Volume; Single
track; Shape, Steady, Builds, Falls away, Peaks then falls, Rises and falls, Suggested by Lyre; Name in this scene,
Names in scenes; Waveform, end and fades in this scene, Back to <scene>, Session list; Try pads, Trying, Sounding;
Back up, move or share, Save to a file, Include the audio files, Open a file, Bring in, Skip, Merge, Keep both;
What came across from Kenku FM, Not brought across; Find missing files, Look in a folder, How sure, Relink; Missing.

## Decisions (Nik approved round 5 on 5 Nov 2026, 21:33)

1. **Previews in the bar**: the Now playing bar shows previews and music on air together, each tagged with where it
   goes (UX-16, above).
2. **Resizing a board**: pads pack left to right, top to bottom; a pad put in Spare pads by hand stays there; only pads
   a resize moved come back (SFX-11, rule `reflowBoard` with `isAside`).
3. **Repeat all in a scene** keeps the scene on that playlist until Next; No repeat, the default in a scene, moves on.
4. **Shape suggestions** stay on, marked "Suggested by Lyre"; your choice replaces the suggestion.

## What to look at (about 15 minutes)

Open `design/prototype/lyre-prototype.html`. Campaigns › The Sunken Crown › Session 14:
- Scene 3, The abbey ruins: the tags and shape lines under each track; the play order button on "Abbey: eerie, low
  energy" (it has its own order here only); Add tracks or playlists…, open a playlist with its arrow and tick one track.
- Scene 6, Aftermath: "Dawn over the abbey" is the scene's name for a track (hover for its own); ⋯ › Name in this
  scene…; the wave button opens the Audio profile on this scene's settings, and Back to Aftermath returns.
- Campaign page: Play on air on one playlist and Preview on another: the Now playing bar shows an On air row and an
  Only you row, each with its own Stop and volume; move between screens and both stay; Pause turns a row grey. In
  Live, add a room and play into it: back on a prep screen the bar has a row per room, each named. In Live itself the
  bar shows only your preview.
- Library: a track's details (Shape, Names in scenes, Use in…); Filters › Shape and Missing; ⋯ beside Add tracks ›
  Back up, move or share, What came across from Kenku FM, Find missing files.
- Playlists › a dynamic playlist: Details at the top, with the rules.
- Pad boards › Combat: ▶ on each pad; Try pads, then click pads and press their keys; make the grid smaller, then
  larger again.
