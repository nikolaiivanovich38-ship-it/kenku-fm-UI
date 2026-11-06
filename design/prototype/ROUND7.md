# Round 7: the unfinished earlier items, and the remote code (6 Nov 2026)

> "Let's do WPR6+WPB6+WPX all in one release, this one, start it."
>
> Nik, 6 Nov 2026, 17:49

Release 0.5.0. This round designs every unfinished earlier item (WPX) and the remote control's secret code (SEC-4) in
the prototype, with its specs. The rules of round 6 hold: less to read, plain words, row buttons greyed at rest,
dragging without clutter, one Saved pop-up, no resting statuses. Everything new is out of sight until it is wanted:
behind a ⋯ menu, a folded box in Settings, a key, or a drag.

Live is not touched (the round 6 part 6 branch changes it); what Live needs is listed at the end. The new code is in
its own files (`src/views/r7shell.js`, `r7tags.js`, `r7org.js`, `r7play.js` and their CSS), loaded after the screens;
each screen has one call where an item hooks in, so the two branches merge without shared lines.

## DAT-10 tag groups

**What.** A **Tags** screen (Library › ⋯ › Tags and groups…, or Look and feel › Tag colours…, with Back). One box per
group (Mood, Leitmotif, Scene type and any new one), in the order chosen. Each tag: its colour dot, name and how many
tracks have it; its ⋯: Rename…, Merge into…, Put inside…, Other words…, Colour…, Move up, Move down, Delete…. Each
group's ⋯: Rename group…, Colour…, Move up, Move down, Delete group…. **New group** at the top, **Add tag** in each box.
**Where it shows.** Tags show on tracks as before, with their group's (or their own) colour dot and always their name.
In the Library filters, a tag that holds others (the sample has Mood › Melancholy › Grief) finds their tracks too, and so do
dynamic playlist rules. Typing another word for a tag while tagging ("sad") offers the tag (Melancholy (sad)), never
a new one. A new group appears at once on every track's details and in the filters.
**Why.** Nik's vocabulary grows; renaming or merging by hand on each track is the chore this removes. Rename, merge and
delete change every track and every dynamic rule in one step, with Undo above the Now playing bar.
**Data.** `tagGroups [{ id, name, cls, color }]` in order; `tagValues { group: [tag] }` in order;
`tagMeta { group: { tag: { parent, also[], color } } }`. Rename and merge also rewrite `rule.conds[].values` of dynamic
playlists; merge adds the old name to the target's `also`. A domain function `trackHasTag(track, group, tag)` (the tag
or any tag inside it) replaces the plain "includes" in filters and rules. Colours are names from the pad palette.

## ORG-4 folders and dividers

**What.** A playlist's or board's ⋯ › **Move to folder…** lists the folders (nested ones as "Sunken Crown ›
Villains") and has **New folder…**, which makes a folder holding that playlist or board; a folder's ⋯ has New folder
inside…, Rename…, Colour… and Delete folder (what was in it moves up a level; Undo). A folder row folds and unfolds and
shows how many it holds. Dragging a playlist or board onto a folder puts it in. No New folder button: an empty folder
is rarely wanted, and the screens keep round 6's reading load. **Dividers**: in a manual playlist, a track's ⋯ › **Add a divider above** names a section ("After the
font"); it is a line, not a track, so counts, the play order and playback skip it, and it drags like a track. On a pad
board, the board's ⋯ › **Add a divider…** names a row of pads ("Spells" above row 2).
**Why.** Long lists by campaign or place, and sections inside long playlists and boards. A new folder is open, so
nothing is hidden until the game master folds it.
**Data.** `orgFolders[kind] = [{ id, name, parent, color, closed }]`, `orgIn[kind][itemId] = folderId` for kind
`playlists`, `boards` (and `sessions`, `sceneBlocks` with the same shape later). A playlist's `items` may hold
`div:<id>` entries; `dividers[id] = name`. A board has `dividers { row: name }`.

## ORG-5 drag between lists

**What.** Nothing shows until a drag starts. Then **Drop on** appears at the right with where it can go: manual
playlists of the same kind (the campaign's first), pad boards (as a new pad, for effects and stings), **Up next in**
each room, and the scenes of the next session. It says what is dragged ("Alien, unknowable voices…", "2 tracks") and
"Copies it · Shift moves · Esc cancels". Dropping copies; with Shift held a track moves out of the playlist it came
from. The place under the pointer lights up; Esc puts everything back. Ticked Library rows go together. The keyboard's
way is **Add to…** in a row's ⋯ (Library and playlists): the same places as a list, with "Move it out of …".
**Why.** Nik builds scenes and playlists from the Library and from each other; the drop places are only there while
they are useful.
**Data.** One function `put(place, kind, ids, from, move)`; places are `pl:<id>`, `pb:<board>`, `q:<room>` (Live's
Add to queue), `sc:<cid>:<sid>:<scene>`. The Saved pop-up names the place and what came in.

## PLY-8 one model for every trigger

**What.** A scene's start and a pad are a list of **steps**, run in order. The usual ones are not stored or shown: a
scene plays its music, its ambience and shows its first pad board; a pad plays its sound. The scene's ⋯ › **What it
does when it starts…** and the pad's ⋯ › **What it does…** open the steps: each is one sentence ("Play the music: …",
"Fade the music to 30% over 2 s", "Fire a pad: Drowned Abbey › Abbey bell") with Move up, Move down and Remove. **Add
a step**: Play…, Stop…, Fade the music…, Wait…, Fire a pad…, Start a scene…. A play step has **How it comes in**
(Crossfade, with the length from Settings › Sound to Discord › Between tracks; Cut; When the current track ends; At the
mix-out marker; After the current loop), **Up next** (Replace what plays, Play next, Add to queue) and **From** (the
start or a marker). **Try in headphones** previews the first play step; **Put back the usual** resets. Only a scene
that differs is marked ("Own start", "Moves on by itself").
**Why.** One way to say "fade the music, fire the sting, then start the combat playlist", for scenes and pads now and
for cue lists, shortcuts and remote buttons later (SHW-1, UX-12, SFX-5), kept out of sight (Nik: less to read).
**Data.** `steps: [{ do, what, how, queue, from, level, secs }]` on a scene or a pad (absent = the usual);
`then: 'stay' | 'end' | 'after'` and `afterMin` on a scene; `settings.crossfade { secs, curve: 'even' | 'power' }`.

## PLY-4, DAT-3, SHW-3 tracks behave as tagged, markers, hand-overs

**What.** Library › a track › How it plays: a **Sting** never loops (its loop choices are off; "A sting plays once"
is read out); a **Loop bed** loops between its Loop and End handles (the loop in and loop out) unless its Audio profile
says otherwise. Only the choices that fit the role show: an Underscore has **Ending: Fades out** (pressed, 4 s unless
the Audio profile says otherwise; not pressed, it plays to its end), **Pick up where it stopped** and **Then: Follow with…**; a Loop bed has Pick up; a
Sting has Follow with; a Transition has Ending and Follow with; a track with no role yet has none. Follow with plays
a playlist or track when it ends unless something is already waiting (inside a scene its next item; in Live, Play
next and the queue). The Audio profile's markers each have **Mix out** (one per track: where the next
track crossfades in) and **Play on air from** that marker, shown on hover and focus in the marker's row (the chosen
Mix out stays). Markers show as ticks on the Now playing bar's progress
line (the mix-out one in the accent colour). A scene can **move on by itself** (Then, in its steps).
**Data.** `track.ending: 'hard' | 'fades'` (fades sets the profile's fade out), `track.resume` with the last position
kept per track, `track.follow` (playlist or track id), `marker.mix: true`. Play steps and Play on air take `from`.

## PLY-1 what played

**What.** Each room keeps what played tonight, newest first. The Now playing bar's room row has a **What played**
button (beside Repeat, shown on hover and focus in the row): the list, each with **Play again** and **Play next**. Nothing is added to Live's boxes; Live's
On air gets the same button in its room header (below).
**Data.** `played[room] = [{ trackId, at, playlistId, place, scene }]`, kept for the evening (not saved).

## PRV-2 device choice

**What.** Settings › **Headphones and speakers** (folded): **On air, on this computer** and **Preview (only you)**,
each a device with Test; **Split one headset**: the preview in one ear and On air in the other (Preview in the left
ear or the right ear). Remembered; an unplugged device falls back to the computer's default until it is back.
**Data.** `settings.audio { airDevice, previewDevice, split, previewEar }` (device ids; the app uses `setSinkId` and a
channel splitter for the split).

## UX-11 display options, A11Y-6 motion, zoom and target size

**What.** Look and feel › **Display**: Density (**Compact**, Lyre's default, or Comfortable: 32 px controls, 36 px
rows), **Text size** 100 to 200 % (the whole page grows, as the app's zoom), **High contrast** (quiet text as strong as
the rest, stronger lines, in every theme), **Tag colours…** (to Tags). Kept per computer. Look and feel's intro
sentence moved to the heading's hover text and description.
Checked: reduced motion stops every slide and pulse (the Saved pop-up included); at 200 % no screen scrolls sideways;
every control on the Library and a pad board is at least 24 × 24 px.
**Data.** `display { density, textSize, highContrast }` per computer (the app: `webFrame.setZoomFactor`).

## UX-12 keyboard shortcuts and Find and play

**What.** **Ctrl+K** anywhere opens **Find and play**: type part of a name; tracks, playlists, pads and scenes are
found. Enter plays it on air (a pad fires, a scene starts), Alt+Enter previews, Shift+Enter adds it to the queue,
Ctrl+Enter opens it; the same four as buttons for the mouse. Esc closes it and focus goes back. Settings › **Keyboard
shortcuts** (folded) lists every key with where it works; **Change…** then press the new key (Esc keeps the old one; a
key in use is refused, naming its action); Put back Lyre's keys; **Printable sheet**. Two switches: ignore a second
Next scene within a second (on), and Next scene and Fade everything out in other programs too (off).
**Data.** `shortcuts { actionId: key }` (only the changed ones), `keyGuard`, `globalKeys`.

## UX-6 no hidden text

**What.** Wherever a name is cut short, its full text is on hover (added after every render when the row has no hover
text with it) and keyboard focus on it, or on the row or button holding it, shows the same text under it. Board and
campaign card names wrap to two lines first. A sweep (`sweeps.spec.ts`, UX-6) checks every screen at 960 and 1920.

## A11Y-4 readable text over artwork

Checked: Lyre puts no text over pictures on any screen (Kenku FM's playlist backgrounds are not used behind text). The
rule for later: text over a picture sits on a 62 % black scrim (`.over-art`, 5.7:1 or more for white text over any
picture), and the picture has `alt=""`.

## SEC-4 remote control secret code

**What.** Settings › Remote control (folded): **Let other devices control Lyre** is off. On, it shows the **Code**
(8 characters, "K7QD-92XF") with Copy code and **Make a new code** (the old one stops at once), and **Listens on**:
**This computer only** (the default) or **Your home network** (for a phone or tablet), with the address to type. The
box shows "On" only while it is on.
**Data.** `remote { enabled, code (kept encrypted, SEC-5), listen: 'local' | 'home', port }`. The server needs the code
on every request, checks the Host header, accepts changes only as JSON, rate-limits, and answers without file paths.

## What Live needs after the merge

1. On air, each room's header: the **What played** button, on hover and focus (same list, as a popover that covers
   nothing else).
2. A scene with own steps runs them on Start and Next; "Moves on by itself" shows on its row in Scenes.
3. Pads with steps run them; a board's dividers show above their row of pads; a pad's ⋯ in Live needs no What it
   does… (steps are set on the board).
4. Keys read the shortcuts map (Next scene, Fade everything out, Find a track, Undo); Next scene ignores a second press
   within a second when the guard is on; Ctrl+K opens Find and play in Live too (it already does in the prototype).
5. The progress line of each room shows marker ticks; Play next and Add to queue accept `from`.
6. Comfortable density and 200 % text: Live's grid must still fit (its own check after the merge).

## Round 7, part 2: Live (after the merge with round 6)

The six points above, built in `views/live.js` and `live.css` on round 6 as Nik approved it (On air at the top,
trays that grow, row buttons greyed at rest, one Saved pop-up, no resting statuses).

1. **What played.** Each room's header in On air has a What played button, shown on hover and keyboard focus (open,
   it stays lit). It opens the list in the room itself, under its lanes, so nothing is covered: the room's last six
   tracks, newest first, each with Play again (now) and Play next (greyed at rest, as every Live row button). Play
   again closes the list.
2. **A scene's steps.** Start and Next scene run a scene's own steps (core's start does the music, ambience and pads;
   the other steps follow in order). A play step set to Play next or Add to queue goes to the room's list, from its
   marker if it has one; the scene's Undo takes it back with the rest. In Scenes, a scene marks only what differs:
   "Moves on by itself", "Own start".
3. **Pads.** A pad's own steps run when it is pressed (Fade the music… says "Music down to 30% over 2 s"). A board's
   dividers are headings over their row of pads, in Current scene and the pad boxes. Live's pad menu has no What it
   does… (steps are set on the board).
4. **Keys.** Next scene, Fade everything out, Undo and Find a track use the keys in Settings › Keyboard shortcuts, and
   the Keys list shows them. A single-key choice (Space, N, /) follows the Single-key shortcuts switch; a key with Ctrl
   or Alt always works. With the guard on (the default), a second Next scene key within a second is ignored; the
   Next scene button is not guarded (a click is deliberate). Ctrl+K opens Find and play in Live as everywhere.
5. **Markers.** Each room's progress line has a tick per marker (its name and time on hover; the mix-out one in the
   accent colour). An added single track can start from a marker (`item.from`, seconds).
6. **Comfortable and 200 %.** Checked: Live with a scene playing, Comfortable density and 200 % text at 960 × 1000
   does not scroll sideways, and On air is in view.

Also: core's `paint` gives focus back to the screen's heading after a redraw (the heading has no data-k, so a redraw,
such as the first playback tick or a resize, used to drop focus to the page). The shell's patch for it is gone.

Specs: a `round 7, part 2` block in `live.spec.ts` (10 checks) and one in `campaigns.spec.ts` (focus through a
redraw). On the merged build before this part, 7 of the 10 Live checks failed; the 3 that passed already worked
through round 7's shared code (a pad's steps, Ctrl+K in Live) or Live's layout (Comfortable at 200 %).

Numbers (`tools/r6-measure.js`, the merge 1d27d7b against this part, every state at both sizes): no change on any
screen. Live stays at 81 words at rest, 210 with a scene playing, 166 for Aftermath and 253 with a scene unfolded
(1920; 59, 188, 144 and 221 at 960): What played shows only on hover and focus, the scene marks only for a scene that
differs, ticks are not text. Checks: the prototype project passes 671 of 671; `tools/r5-check.js`,
`tools/check-contrast.js`, `tools/lv-keys.js` (66 checks), `tools/r6-saved.js` and `tools/r7-smoke.js` pass.

## Numbers

`tools/r6-measure.js`, round 6 (5fca9bc) against round 7, all 31 states at 1920×1080 and 960×1000, the new Tags screen
left out: words 13,450 → 13,351, controls 5,570 → 5,538, hint lines 182 → 178, facts shown twice 306 → 296, badge
kinds 230 → 228. No screen or state is above round 6 on any count. Lower: Look and feel (words 342 → 298 at 1920,
controls 35 → 20: the intro sentence went to hover text and the theme samples' buttons became pictures), Settings
(67 → 64: Sound to Discord folded). Equal: every other state (the round 7 additions are behind menus, folded boxes,
hover and focus, or shown only for the role they fit). **New screen: Tags** (89 words, 48 controls at 1920; 72 at 960).

Getting there took three passes: the first build added words or controls on 14 states (a New folder button, the
pad's What it does… button, a filter chip for a new parent tag, ending rows on untagged tracks, the What played and
Mix out buttons at rest). Each was moved behind a menu, to hover and focus, or to the role it fits.

Specs: 53 new checks, all failing on round 6's prototype first (24 matched by name passed there: older checks, and the
Tags sweeps on the placeholder page). Now the prototype project passes 632 of 636; the 4 that fail
(`library-files.spec.ts`: the export's and relink's result as a status inside its box) fail the same way on round 6's
base (5fca9bc made that line plain text), outside this round. `tools/r5-check.js`, `tools/check-contrast.js` and
`tools/r7-smoke.js` (every screen at 960 and 1920: no page or console error, no sideways scroll) pass.

## Questions for Nik

1. **Bigger buttons in Live?** The backlog asks 44 px for Live; you chose compact (28 px) everywhere. Recommendation:
   keep compact, and use Look and feel › Comfortable (32 px) if Live feels small; no separate Live size.
2. **Follow with inside a scene.** When a sting with Follow with is in a scene's music, the scene's own next item plays
   (the follow-with is for the sting played on its own, from a pad or a playlist). Recommendation: keep it so; a scene
   is the plan.
3. **Enter in Find and play.** Enter plays on air at once; Alt+Enter previews. Recommendation: keep it (it is what you
   reach for mid-game); a mistake is one Stop away.

## Try it (about 20 steps)

1. Library › ⋯ › Tags and groups…: one box per group. Mood › ⋯ on Wistful › Rename… "Longing" › Rename: the Undo above
   the bar says how many tracks changed; press Undo.
2. Mood: Grief sits inside Melancholy. Back to Library › Filters › Mood › Melancholy: the grieving tracks are found too.
3. Open "Ancient sorrow, choir" and type "sad" in + Add mood: Melancholy (sad) is offered.
4. Tags › New group "Faction" › Add tag "Harbour guild": the track's details now have a Faction row.
5. Playlists › ⋯ on The Abbess › Move to folder… › New folder… "The abbey"; drag Abbey ambience onto the folder; fold it.
6. Open The Abbess: ⋯ on "Lullaby" › Add a divider above "After the font".
7. Drag "Alien, unknowable voices" a little: Drop on appears; drop it on Ashen King (copied). Do it again holding
   Shift (moved). Start a drag and press Esc.
8. ⋯ on a track › Add to… › Session 14 › The abbey ruins › Add.
9. Session 14 › ⋯ on The abbey ruins › What it does when it starts…: three steps. Add a step › Fire a pad… › Abbey bell;
   set Then to "Start the next scene when its music ends"; Done: the scene says "Moves on by itself".
10. Pad boards › Weather and places › Thunder crack › ⋯ › What it does… › Add a step › Fade the music….
11. Library › "Dread rising" (a sting): its loop choices are off. Then › Follow with… Crypt ambush.
12. Audio profile of t13 › Markers: point at "Low swell": Mix out, then Play on air from it; the ticks on the bar.
13. Campaign page › Play on air The Company themes › Next › point at the bar: What played › Play again.
14. Press Ctrl+K anywhere, type "abbess", Enter. Ctrl+K, "lullaby", Alt+Enter.
15. Settings: Remote control on (the code, Make a new code, Your home network); Headphones and speakers (Split one
    headset); Keyboard shortcuts (Change… on Find and play, press Ctrl+J; Printable sheet).
16. Look and feel › Display: Comfortable, Text size 150 %, High contrast.
17. Live (after 9 and 10): Start The abbey ruins: Scenes says "Moves on by itself", the Abbey bell sounds, and the
    Table's progress line has a tick at Choir enters. Point at Table's header: What played › Play again.
18. Live: Start Recap and the coast road, press Thunder crack: "Music down to 30% over 2 s". Press Space twice
    quickly: one scene moves on, not two.
19. Settings › Keyboard shortcuts › Change… on Next scene, press N; in Live, N starts the next scene and the Keys list
    says N.
