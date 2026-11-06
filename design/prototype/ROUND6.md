# Round 6: less text, less clutter (6 Nov 2026)

> "I don't need more text on the interfaces, in fact we should try to reduce the text and the clutter on screen where
> we can - there's a lot of information to take in and read and differentiate and we should try to reduce the
> cognitive load. We should apply a UX/UI best practices pass over it."
>
> Nik, 6 Nov 2026, 00:41

This round is subtraction only. No behaviour changed, and nothing a game master needs mid-game left Live.

## Rules applied

1. **Measure first.** `tools/r6-measure.js` counts what is visible without scrolling, per screen and state, at
   1920×1080 and 960×1000: words, controls, hint or explanation lines, facts shown twice, distinct colours and badge
   kinds. The prototype's own strip and design notes are left out. Numbers below are from that script.
2. **Aesthetic and minimalist design** (Nielsen 8). A line that repeats a label, the box title or the page header goes.
3. **Progressive disclosure.** How-to sentences for rare actions move to hover text (`title`) and the guide; the
   default case is not described ("Manual", "Whole track, then the next one", "None: it shows its own name
   everywhere"); only the exception is marked ("Dynamic", "Lyre suggested…").
4. **Quiet when resting.** A box's resting status (Ready, Saved, Empty, Copied, or a count of rows the box already
   lists) shows only while the box is folded, where it is the one line left. Statuses that say something is happening
   (Playing, On air, n selected, n sounding, a warning) always show. Same for a summary that repeats the open body.
5. **Hide the rare, show the frequent.** "Fill the column" shows on pointer hover or keyboard focus in the box header
   (it stays in the Tab order, with its name). Key legends show while the keyboard is in their box.
6. **Never lose meaning for keyboard and screen-reader users.** Text taken off screen goes to an accessible
   description (`aria-describedby`, new `describe` option on boxes and sheets), an accessible name, or hover text.
   Hover text alone is used only where the same fact is also reachable another way (the Library details, the guide).
7. **Counts beside a heading** stay only where the list scrolls (Library, Playlists); where every item is on screen
   (Campaigns) the count goes.
8. **Consistent placement.** The session's Campaign playlists box has its "Change" as a header icon button, where the
   other boxes have Add.

## Totals (all 29 screens and states, both sizes)

| | Before | After | Change |
| --- | ---: | ---: | ---: |
| Visible words | 14,373 | @WORDS@ | @WORDSP@ |
| Hint and explanation lines | 314 | @HINTS@ | @HINTSP@ |
| Facts shown twice | 330 | @TWICE@ | @TWICEP@ |
| Visible controls | 4,964 | @CTLS@ | @CTLSP@ |
| Badge kinds (sum over screens) | 245 | @BADGES@ | @BADGESP@ |

Controls fall least: almost every control is used, and the round removes words, not functions. The column
button is still there for a keyboard user; it only stops drawing the eye.

## Per screen (1920×1080; words at 960×1000 in brackets)

@TABLE@

## Cuts, per screen

**Campaigns.** "3 campaigns" beside the heading (the cards are the count). The theme's name on each card: the card is
drawn in its theme; the name is in the card's hover text.

**One campaign.** "Next: Session 14…" in the Sessions header (the row's Next badge and Run next session say it).
"In every session. New ones: Playlists." in both side boxes: read out with the box, in the Add button's hover text;
new playlists and boards are made from the rail. Resting counts and "Saved"/"Empty" on open boxes.

**Session planner.** "In play: this scene's music first, then this session's, then the campaign's, then the whole
library." (about Live, not the plan; read out, and for the guide). "Plays in order, then loops. Drop files here to
add them." and "The first is shown when the scene starts." became the buttons' hover text. "From the campaign.
Change." became an edit icon in the box header; "Campaign pad boards: …" line kept. "6 scenes" and counts on open boxes.

**Music picker and other pickers.** The intro sentence ("Tick playlists, single tracks or both; …") is the dialog's
accessible description and the list's hover text. "Preview plays in your headphones only. The arrow beside a name
shows what is inside." removed (the headphones icon and the arrow are standard and named). "Tick single tracks to add
only those…" inside an open playlist became hover text. Playlist second lines show only what is not the usual
("Dynamic · 4 tracks", "Ambience · 3 tracks"), the rule on hover. Use in…: "Available in every session" on every row
moved to hover; a scene row keeps a second line only when ticking it replaces something.

**Library.** "69" on the Tracks box (the heading says 69 tracks). The file's own title as a grey second title on every
row: shown on the open row only, on hover elsewhere. The key legend shows while the keyboard is in the list, and is
the grid's accessible description. "None: showing every track" when no filter is on. Details: the summary repeating
the title field; "Point Lyre at the folder it moved to." (Relink's hover text); "Names in scenes: None…" row (shown
only when it has names); "Whole track, then the next one." (shown only when the track does something else); "Suggested
by Lyre from the track's loudness. Choose another to change it." became "Suggested by Lyre" (the rest on hover), and
"Your choice." goes when it is also Lyre's suggestion; "Manual" on each playlist row (only "Dynamic" is marked); "Add
it to a scene directly, or to a playlist a scene plays." (hover).

**Playlists.** "Drop audio files on a row to add them" in the box header (hover text of the list). The count beside
the heading stays, as in the Library: the list scrolls, so the count is not on screen otherwise. On Campaigns every
card fits, so its count went.

**One playlist.** Manual, Music under the name field in Details (the page header shows it). "Search the library, or
drop files here" in the Add tracks header (the search box says it). "Drag rows, or press Alt+Up / Alt+Down…" shows
while the keyboard is in the list. "Campaign: every session. Session: that evening. Scene: …" is Used in's accessible
description and Use in…'s hover text. Dynamic: the rule summary in the Rules header while open (the plain-words line
below says it), "Any shape" and "Energy 0 means a track with no energy set." (hover text and accessible description).
Ready and Saved on open boxes.

**Pad board.** "Pads that are not on the grid wait here; …" is the Spare pads box's accessible description and hover
text (the greyed key still shows it). "Drag to swap pads. Keys: …" shows while the keyboard is in the grid. The Try
pads banner is now "Trying: only you hear them." with the rest on hover. "4 × 2" in the Pads header (the quick-size
buttons show it). Each play mode button has its explanation as hover text; the chosen one's line stays.

**Audio profile.** "Title in the file …" and "File name …" under the title (hover; both are in the Library details).
"Editing the track's own settings" when the list already says "This track everywhere (its own)". "Then silence" under
Stop. "smooths the jump back to 1:04" (the crossfade group's description). The key legend shows while the keyboard is
in the waveform box; with keys off, the switch alone says so.

**Live.** Unchanged except Scene music's playlist rows: "Manual · 5 tracks" is now "5 tracks" (the kind is hover
text). Everything a game master acts on mid-game stays.

**Back up, move or share.** Each "What to save" option's description shows for the chosen option only (others on
hover). "The 38 tracks come without their audio files: Lyre lists them under Find missing files until you point it
at a folder that has them." became "No audio files: find them later with Find missing files." (the rest on hover).

**Find missing files.** "Lyre matches on the file name and its size, …" is Look there's hover text.

**Outputs.** "Tokens and new bots: Settings, as in Lyre 0.2." became "Tokens and new bots: Settings."

**Every screen.** Fill the column (the ⤢ in each box header) shows on hover and keyboard focus.

Not changed: Look and feel (it is the theme reference and shows every swatch on purpose), What came across from Kenku
FM (read once), and the Now playing bar (round 5, approved yesterday).

## Questions for Nik

1. **Resting statuses only on folded boxes.** Open boxes no longer say Ready, Saved, Empty or "6 scenes".
   *Recommend keeping:* those words never asked you to do anything, and seven boxes on a screen saying Ready is seven
   things to read. Playing, On air, n selected and warnings still show.
2. **Fill the column on hover.** The ⤢ button appears when the pointer is over the box or the keyboard is in its
   header. *Recommend keeping:* it is a rare layout action and was in every header. If you use it often, say so and it
   comes back for good.
3. **"In play: this scene's music first, …" off the planner.** *Recommend keeping it off:* it explains Live's list
   order, which Live itself shows. It stays for screen readers and goes in the guide.
4. **Only the exception is marked.** "Manual" is gone from pickers, the Library details and Live; "Dynamic" stays.
   *Recommend keeping:* most playlists are manual, so the word told you nothing; a dynamic playlist changes as you tag,
   which is worth a word.
5. **Key legends while the keyboard is in the box.** The Library, playlist, pad grid and Audio profile key lines show
   only while you are using the keyboard there. *Recommend keeping:* mouse use never needed them, and keyboard use
   sees them at the moment they apply.

## Specs

Changed checks (prototype first, app later): Stop is found by its name without "Then silence"; the loop crossfade's
explanation and why spare pads exist are checked as accessible descriptions; counts on open boxes (markers, spare
pads) are checked by counting rows. New `round 6` checks: the Library key legend, the music picker's description, the
session playlists' description and a quiet status on a playlist page. Checks the app does not meet yet call
`expectFailureUntilBuilt("round 6")`.

Screenshots before and after for the five busiest screens are in `shots/r6` (not committed).
