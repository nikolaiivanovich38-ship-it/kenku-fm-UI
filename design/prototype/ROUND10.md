# Round 10: the final design for 0.6.0 (item 58), merging the whole-app review with round 9

> "…and then have them build a final design merging the two sets of insights and improving the UX design, flow,
> layout, look and feel and anything else they can improve. Have them present the new prototype design to me for
> testing, review, comment, and approval" (Nik, 18 Nov, item 58)

Three reviewers clicked through the built app (0.5.1) and round 9's prototype, each through one lens: **prep**
(getting a game ready), **table** (running it) and **look** (look and feel). Their reports are in the lead's scratchpad
(`r9/prep`, `r9/table`, `r9/look`: step1-built, step2-design, step3-proposals, sketches). This file says, for every
proposal, whether round 10 keeps it, changes it or drops it, and why; then what each screen now shows.

**The rule.** Nik's words win. His answers of 18 Nov 03:14 (round 9's 12 questions) and 08:36 (the reviewers' 7
questions), and his earlier rules (6 Nov: no Ready-type marks, little to read in Live, one Saved pop-up place; 11 Nov:
Prep | Live in the Library), are in `/root/kenku-wt/R6-NIK-DECISIONS.md`. Where a proposal goes against one, it is
dropped and the decision is named. What 0.5.2 built in the app (the Track library, Connection lost, the double-click
guard, pads keeping the scene's Undo, the loop setting on air, empty boxes hidden in Live, Delete for campaigns and
sessions, Type, watched folders) is followed where the prototype's screens touch it.

Code: round 10 changes live in the round 9 files and a new `src/views/r10.js` and `r10.css`, loaded last; each change
in an older file is marked "Round 10".

## 1. Each proposal

Prefixes: **P** prep (step3 P1–P14), **T** table (step3 §1–§9), **K** look (step3, "the cue desk").
Built = drawn in the prototype this round. Later = kept for a later round, not drawn now.

### Prep

| # | Proposal | Verdict | Why |
|---|---|---|---|
| P1 | Back returns to the same scene, open playlist, scroll and control | Keep (built in round 9) | The prototype already does it; the app must match (acceptance check stays). |
| P2 | Make a playlist from the Add music panel | Keep, built | Nik 18 Nov, 1a. **New board…** in the pad board picker: built after Nik's answer 4 to this round's questions (below). |
| P3 | "No ambience" chip on a folded scene | Drop | Nik 6 Nov: no Ready-type marks; 18 Nov: left out. |
| P4 | "Starts when" becomes **Story cue**; a "When it starts" line in the open scene with Change… | Keep, built | The start steps decide what the table hears and were hidden in ⋯. |
| P5 | The Library's tag chips in the pickers | Later | 0.5.2 put the Shape filter in the scene pickers; the full chip row shares the Library's filter code in the app, so it is built there. |
| P6 | Every track title opens the Track panel; one row-button order | Keep, built | Round 9 promised "a track title anywhere"; nested rows were plain text (WCAG 3.2.4). |
| P7 | Watched folders shown and managed | Keep as 0.5.2 built it | 0.5.2 put kind and Remove folder in Filters › Folders ⋯; the prototype follows its words. |
| P8 | No "Coming later" anywhere | Change, built | The campaign's Obsidian box stays (approved placeholder, spec'd); the line in **every scene** and the session's box go, which is where the reading load was. |
| P9 | Pad editor: Sound first; Fill empty pads… | Later | The board editor is not touched by this round's items; queued with Nik's next board changes. |
| P10 | Track panel under the top strip; File folded; trail collapses only when it must; one At its end | Keep: panel, At its end and the box's name built; File folded and the trail rule Later | All three reviewers: the panel's × sat beside the window's buttons (WCAG 2.5.8). |
| P11 | One scene open at a time, Open all | Drop | Nik 18 Nov, 2b: each scene stays open until closed, no Open all. **Open all scenes is removed.** |
| P12 | New session ▾ copy last session | Drop | Nik 18 Nov, 3b: a new session starts empty. |
| P13 | One add-tracks panel for scenes and playlist pages | Later | Same panel in the app (one component); not redrawn now. |
| P14 | → Open on every playlist row; Used column | Change, built | The → Open button is built; the Used column is Later (the list is already wide). |
| small | Esc asks before throwing typed text away | Keep, built | New campaign lost its name on Esc. |
| small | Date in Lyre's own form | Keep, for the app | The prototype's date field shows the machine's own order; the app writes it as the cards do. |
| small | Role words finished ("FX · Short cue") | Keep, built | Round 9 changed the words in the Track panel only. |
| small | Dock buttons with words | Change | Replaced by one **Dock** menu with words (K, Add music). |

### Table

| # | Proposal | Verdict | Why |
|---|---|---|---|
| T1 | On air keeps its height: Music, Ambience and Effects lines always there | Keep, built | Live jumped 41–150 px under the pointer when a pad fired or a scene started (table M1). Empty lines are blank (no resting words, 6 Nov). |
| T1 | One Undo place, fixed in the top strip | Keep, built | The Undo strip pushed the scene rows down and back. |
| T1 | Stop pads always in the board's row, greyed when nothing sounds | Keep, built | Its appearing moved the pads 7 px. |
| T1 | Up next as one line with a popover | Change | Up next stays folded to its first line; it unfolds only when Nik clicks "n more", which his rule allows (it moves because he moved it). |
| T1 | Current scene's pads never scroll away | Later | Arrange now sizes Current scene; a pad strip pinned at its foot needs the app's box layout and is drawn in the build. |
| T2 | Preview first, Play on air last after a gap, "Players hear this now" / "Only you" | Keep, built | What players hear rested on two small icons. |
| T2 | The preview queue at the right like Help | Keep, built | It covered the middle of Live. |
| T3 | Arrange: grip, edges, one Move menu per box; On air movable and resizable | Keep, built | Nik 18 Nov, 6: dynamic per window size; every box movable and resizable, On air too, top by default. |
| T4 | Undo for Play on air, Fade all, Stop all; pads, previews, volume and mute keep the Undo | Keep, built | Nik 18 Nov, 6a: Undo after Stop all brings every room back. |
| T4 | Stop all leaves previews alone | Drop | Nik 18 Nov, 7b: Stop all stops the headphone preview too; the button stays "Stop all". |
| T5 | Connection lost: words, greyed bars, Try again, the other bot | Keep, built | 0.5.2 built "Connection lost · players hear nothing" with Try again; the prototype draws it. |
| T5 | Bots join only when Nik joins them; "Joins when Lyre starts" goes | Keep, built | Nik 18 Nov, 3. |
| T5 | Missing file or empty pad marked before pressing; a warning pop-up | Keep, built | Nik learnt of it after the moment had passed (WCAG 1.4.1, 4.1.3). |
| T5 | Double-click on Next scene starts one scene | Keep, built | 0.5.2 built it; the prototype matches. |
| T6 | Fade all and Stop all keep their words at every width | Change, built | Words from 1000 px of app (a whole window, half a 2560 screen); at half a 1920 screen the strip has no room beside Back, the trail, the session, Prep \| Live, Find, Undo and the window's buttons, so they stay icons there, named on hover and read out. |
| T6 | Leave only in the room menu at half a screen | Drop | Round 8's approved check: Leave is beside the room's button and in its menu. It moves 8 px further from the volume instead. |
| T6 | Transport: Pause first, Stop after a gap | Change, built | Merged with K: see "Where the three disagree". |
| T7 | First start: the tour, then Set up Lyre; a Live tour of six steps; Set up folds when done | Keep, built | Nik 18 Nov, 5b. The Live tour now covers what the players hear, Undo and Fade all. |
| T7 | F1 opens at the screen's article | Change | On this screen is already first in Help, one click from the article. |
| T8 | Rooms screen under Settings, as it is | Keep, built | Nik 18 Nov, 2. |
| T9 | Pad names wrap at spaces; dip mark; What played as a popover; one Esc closes Find | Keep: pad names and the dip mark built; What played and Find's Esc Later | Both are rare mid-game. |

### Look

| # | Proposal | Verdict | Why |
|---|---|---|---|
| K1 | One signal: On air is a red lamp in every theme; no accent in the red-orange band | Keep, built | Nik 18 Nov, 4a: Hearth's orange becomes iron teal; answer 1 below: Parchment's oxblood becomes ink blue. |
| K1 | Elysium becomes bone | Drop | Nik 18 Nov, 5b: Elysium keeps gold. |
| K2 | Status colours for status, the accent for one primary | Keep, built | Connected and Nobody there were both gold. |
| K3 | One header grammar; sentence case; the trays as plain headings | Keep, built | ALL CAPS labels and dashed/solid trays meant nothing. |
| K4 | Display face for the screen's title and campaign names only | Keep, built | Cinzel and Cormorant at 15 px were the hardest text on screen. |
| K5 | Boxes take their content's height | Keep; Live already does (Nik 6 Nov); the campaign page Later | |
| K6 | Row buttons greyed at rest everywhere | Keep, built | Nik's Live rule (6 Nov), now on every list. |
| K | Fern's ground green that reads | Keep, built | The five themes read as three. |
| K | 12 px floor for text | Keep, built | Badges at 10 px. |
| K | Prep \| Live only where it switches | Drop | Nik 11 Nov: "In library view I still need the Prep and Live toggle". |
| K | Skip link | Later | 2.4.1 is met by the landmarks; the app adds it with the shell. |
| K | Playing title on two lines with its loop setting under it | Keep, built | Long titles were cut where Nik needs them; 0.5.2 shows the loop setting on air. |
| K | Transport hierarchy | Keep, built | Merged with T6. |
| K | Dipped as a status, no mark on the pad's face | Keep, built | ⌄ read as "opens a menu". |
| K | Preview strip with headphones and "Only you"; the on-air bar says "Players hear" | Change, built | The bars keep their chips (On air · Table, Only you); the preview row is slimmer with a purple edge and tint, the on-air row a red edge. |
| K | Audio profile: "Audio profile" as its first box; one At its end | Keep, built | Two lists for one setting. The h1 stays the track's name (Back and the trail name the track). |
| K | Add music: one Dock menu with words | Keep, built | Four unlabelled glyphs. |
| K | Look and feel: one card per theme, no menu | Later | Approved in round 7 with its menu; not a reading problem at the table. |
| K | Settings: version to Help's foot | Drop | The approved check UX-R16 puts it at the top right of Settings. |

### Where the three disagree

- **Transport order.** Table: Pause first, then Stop, then Back and Next. Look: Previous, Pause (filled, larger), Next,
  then Stop apart. **Chosen: Previous · Pause · Next, a gap, Stop, then Shuffle, Repeat, Fade**, at the same places
  in the music and ambience rows. Why: it is the order of the Now playing bar and of every music player (Nik, 11 Nov:
  "standard patterns"), and both reviewers agree Stop must stand apart from Pause.
- **The dip mark.** Round 9: ⌄ on each pad. Table: a step-down glyph or nothing. Look: nothing on the face.
  **Chosen: nothing on the pad's face**; its name and hover say it dips; the music line says "Dipped".
- **On air's height vs a two-line title.** Table: a fixed height per room. Look: up to two lines for the title.
  **Chosen: both**: each room keeps room for a two-line title, its bar and the Effects line, whatever plays.
- **Stop all and the preview.** Table: leave previews alone. **Nik 7b decides**: Stop all stops the preview too.
- **Where Undo lives.** Table: one fixed place in the strip. Round 9: strips inside the boxes. **Chosen: the strip**,
  so nothing moves when Undo appears or goes.
- **Side panels.** Prep: start under the top strip. Look: also move × away from the window's buttons. **Chosen: under
  the top strip**; that alone puts × 48 px below the window's buttons, and × stays where every panel has it.

## 2. Screen by screen

**Every screen.** Track library (0.5.2's name) in the menu, heading, Back and help. Sentence-case labels, no ALL CAPS.
Box titles in the body face; the display face for the screen's h1 and campaign names. Text 12 px or more. Row buttons
greyed at rest, full on hover, focus and the selected row. The Track panel and Help open below the top strip, × at
the Track panel's left; the queue opens at the right.

**Rail.** Live, Campaigns, Track library, Playlists, Pad boards; at the foot Settings with **Rooms (1/2)** under it
(Nik: "keep the room screen as an option as it stands under settings"), Look and feel, Help.

**Live.**
- Top strip: Back, trail, session, Prep | Live, Find (shrinks first), **Undo place**, Fade all, Stop all (words from
  1000 px of app; below that, at half a 1920 screen, icons with their names read out and on hover, Fade all's key
  Shift+Esc in its hover text), Keys, Arrange.
- On air: a red lamp in its head, lit while any room plays; no tinted band. Each room: name ▾ (move, copy, Leave), status, mute,
  volume, Leave. Then Music and Ambience, each with a title of up to
  two lines, its bar and time, and one quiet line (where it comes from · how it loops); then the Effects line, always
  there, with Stop effects greyed until something sounds. Transport: Previous · **Pause** (filled) · Next | Stop |
  Shuffle · Repeat · Fade. A lost connection says "Connection lost · players hear nothing" with Try again and the
  free bot. Nobody joins by himself at start.
- Undo covers starting a scene, Next scene, Play on air, Play next, Add to queue, removing from Up next, Leave, moving a
  room, Fade all and Stop all (every room back where it was). Pads, previews, volume, mute, menus and Find leave it.
  Stop all stops the preview too.
- Rows: Preview · Play next · Add to queue, a gap, **Play on air** (on-air colour on hover and focus; "Players hear
  this now"). A pad with no sound is dashed with "No sound" and pressing it shows a warning pop-up (amber, stays
  10 s), not the Saved one; a missing track says "Missing" on its row (the room skips it, as 0.5.2 built).
- Arrange: each box gets a grip in its head (drag to move; a line shows where it lands) a foot to drag for height and a bar
  between columns for width; one **Move…** menu per box does the same from the keyboard (Up, Down, Column left, Column right, Taller,
  Shorter, Fit, Narrower, Wider, and for On air: To the top). On air moves and sizes like the rest, top by default.
  Kept per window size; Put back the usual layout.
- The Live tour: Next scene · On air: what players hear · Preview: only you · Pads and their keys · Undo · Fade all and
  Stop all.

**Session planner.** No Open all. Each open scene shows **When it starts: …** with Change…; the story note is **Story
cue**. Every track title, nested in a playlist or not, opens the Track panel. Track rows: Preview · Play on air · Audio
profile · Repeat · ⋯. No "Note link · Coming later" in scenes or the session. Add music: **Make a playlist of these…**
in its foot (asks a name; the scene gets the new playlist in place of the ticked tracks; Cancel and Done stay); a
**Dock** menu (Left, Right, Float) with words. Add pad boards: **New board…** in its foot asks a name, makes an empty
4 × 3 board and puts it at the end of the scene's boards (Back keeps the ticks as they were); its pads are added on
its own page.

**Playlists.** A → Open button on every playlist row. Row buttons greyed at rest.

**Track panel.** Opens under the top strip, × at its head's left; Open in Track library is an ordinary button.

**Audio profile.** First box "Audio profile"; At its end with the same six ends as the Track panel (Play… opens the
same picker).

**Settings.** Discord bots: no Joins when Lyre starts; Starting volume stays (used when Nik joins the bot). A
**Rooms** line opens the Rooms screen. Connected in green. "Each pad board has its own pad keys." The version stays
at the top right (UX-R16).

**Rooms.** As 0.5.1 had it; its trail says Settings › Rooms; reached from the rail under Settings and from Settings.
Live's room menus have no Rooms… line: rooms are joined and moved in Live itself.

**Themes.** Hearth and Iron: iron teal accent. Parchment: ink blue accent (it was oxblood). Fern and Brass: a green
ground that reads. Candlelit and Elysium (gold) as they were. On air is the same red family in all five, and no
theme's buttons are in it.

**Help.** First start: the short tour, then Set up Lyre. Set up Lyre folds to one line when all nine are done, and its
badge, a quiet outline chip, never shows while Live has a scene running. New campaign: with something typed, the first
Esc says a second one throws it away.

## Specs and checks
The prototype project (`npx playwright test -c playwright.spec.config.ts --project=prototype`, through `yarn heavy`):
**813 passed, 0 failed, 13 skipped** (the skipped ones are `appOnly()` checks of 0.5.1). After Nik's four answers:
818 passed, 0 failed, 13 skipped for the whole project; then, with the Undo icon, Live, the sweeps and Help again
(477 passed, the one failure a fault in the new check itself, fixed and passing) and the new checks (39 passed). That includes the sweeps (no
sideways scroll, no overlap or cut-off text, axe WCAG 2.2 A and AA, keyboard, the window's buttons, every screen from
600 to 2560 px wide). Round 9 left 34 failing; they now pass.
- **New checks, marked `expectFailureUntilBuilt("r10")`** (a new stream in `support/built.ts`, so the app project
  expects them to fail until the 0.6.0 build): Live keeps its place when a scene starts and a pad fires; Undo in one
  place; a pad keeps the scene's Undo; Stop all and Play on air have Undo; double-click on Next scene; the transport
  order; Connection lost and Try again; Arrange with one Move… per box and On air moving into a column; no Joins when
  Lyre starts; Rooms with Settings in its trail; no Open all; When it starts; a nested track title opens the Track
  panel; Make a playlist of these…; the first start ends in Set up Lyre; the six-step Live tour. Round 9's changed
  words (uses, At its end, Play…, the six ends in the Audio profile, Rooms reached from the menu) are marked the same.
- **Checks that read either name** (they pass in the app as it is and in the prototype): the Track library's name,
  Story cue / Starts when, the room's button and Leave, Next time, start where it stopped, Leave out short cues, the
  playlist menu's Move items, Undo found on the page wherever its strip is, the Rooms link at the menu's foot, Help's
  article lists without Set up Lyre's buttons.
- `tools/check-contrast.js`: all five themes pass (Hearth's teal: accent text 10.0:1, accent ink 4.5:1 or better).
  New controls are 24 px or more; the box's foot edge (drag only) has Move… as its keyboard and pointer alternative.
- Not test-first: the new checks were written alongside the code, not before it. Their first run failed five and found
  real faults (Undo under Find lost its click, the strip shifted 3 px when Undo appeared, the Live tour skipped a step),
  which were then fixed.

## Nik's answers to round 10's questions (18 Nov)
Asked with the recommended option first; Nik chose it each time (verbatim in `/root/kenku-wt/R6-NIK-DECISIONS.md`,
"answers to the round 10 merge agent's 4 questions"). All four are built; the questions are closed.

1. **Parchment's buttons**: ink blue in place of oxblood, so On air's red stands out. Accent `#1f3d70` (hover
   `#2b4f88`): its words 10.1:1 on the button, accent text 9.2:1 on the panels, the button 7.8:1 against the page.
   `tools/check-contrast.js` now also fails a theme whose buttons are under 3:1 against the page (1.4.11) or within
   30° of On air's hue; all five pass.
2. **Fade all and Stop all at half a 1920 screen**: icons below 1000 px of window, words from 1000 px up. Their names
   are read out, their hover text names them (Stop all's now starts "Stop all:"), and Fade all keeps Shift+Esc.
   Found while retaking the half-screen shot: Undo's word was cut to "U" below 1100 px (the sweep measured the
   button, not the word inside it). Undo is now an icon there in the same way, its name and Ctrl+Z kept.
3. **Rooms from Live**: only from the menu under Settings (and Settings › Discord bots). Live's room menus and + Room
   have no Rooms… line; a check makes sure of it.
4. **A new pad board from the planner**: New board… in a scene's Add pad boards, as Make a playlist of these… in Add
   music. It makes an empty 4 × 3 board and puts it in the scene; pads and size are changed on its page.

New checks, test first (each failed before the change, marked `expectFailureUntilBuilt("r10")`): `look.spec.ts`
"round 10: Parchment's buttons are ink blue"; `live.spec.ts` "round 10: Nik's answers on the strip at half a screen
and on Rooms" (the Rooms check passed from the start, since no Rooms… line was there; it stays as a guard);
`session-planner.spec.ts` New board… and its Back. The Undo icon check was written just after its fix, then seen
to fail on the build without it.

Shots (`shots/r10`): 11 (half a screen) and 12 (Parchment) retaken; 13 a room's menu in Live; 14 New board… in
Add pad boards.
