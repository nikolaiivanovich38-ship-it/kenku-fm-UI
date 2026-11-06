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
   (Part 5, Nik's answer: Ready, Saved and the scene count are gone altogether, folded boxes too; saving shows in
   the Saved pop-up.)
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
| Visible words | 14,373 | 12,446 | −13 % |
| Hint and explanation lines | 314 | 188 | −40 % |
| Facts shown twice | 330 | 282 | −15 % |
| Visible controls | 4,964 | 4,848 | −2 % |
| Badge kinds (sum over screens) | 245 | 215 | −12 % |

The five busiest screens (Library with a track open, the music picker with a playlist open, a manual playlist, the
planner with two scenes open, Back up with a file open), at 1920×1080: words 2,113 → 1,698 (−20 %), hint lines
43 → 22, controls 684 → 672. Live is almost unchanged on purpose.

Volume normalisation (PLY-15, merged from wave4 after the cut) adds about 100 words on the Library details, a
playlist's Details and the Audio profile, and no hint lines: its explanations are hover text already.

Controls fall least: almost every control is used, and the round removes words, not functions. The column
button is still there for a keyboard user; it only stops drawing the eye.

## Per screen (1920×1080; words at 960×1000 in brackets)

| Screen and state | Words | Hint lines | Shown twice | Controls |
| --- | ---: | ---: | ---: | ---: |
| campaigns | 121 → 113 (106 → 98) | 4 → 3 | 6 → 6 | 15 → 15 |
| campaign | 132 → 108 (115 → 91) | 3 → 1 | 2 → 1 | 80 → 73 |
| campaign-onair | 155 → 131 (138 → 114) | 3 → 1 | 2 → 1 | 86 → 79 |
| planner | 263 → 204 (246 → 187) | 8 → 2 | 6 → 4 | 125 → 118 |
| planner-two-scenes | 269 → 228 (240 → 181) | 8 → 2 | 7 → 5 | 131 → 124 |
| planner-order-menu | 318 → 259 (301 → 242) | 9 → 3 | 6 → 4 | 130 → 123 |
| picker-inside | 479 → 318 (443 → 294) | 12 → 3 | 7 → 4 | 171 → 164 |
| library | 448 → 404 (265 → 218) | 3 → 2 | 4 → 5 | 168 → 166 |
| library-track | 686 → 582 (424 → 391) | 7 → 3 | 16 → 13 | 214 → 217 |
| library-t44 | 584 → 514 (367 → 336) | 6 → 4 | 14 → 13 | 199 → 200 |
| library-filters | 448 → 404 (221 → 207) | 3 → 2 | 4 → 5 | 168 → 166 |
| playlists | 143 → 133 (128 → 118) | 1 → 1 | 0 → 0 | 147 → 147 |
| playlist-manual | 382 → 350 (322 → 300) | 5 → 3 | 9 → 5 | 134 → 133 |
| playlist-dynamic | 197 → 150 (182 → 135) | 6 → 3 | 3 → 1 | 61 → 57 |
| playlist-gothic | 245 → 207 (230 → 192) | 6 → 3 | 2 → 0 | 85 → 81 |
| boards | 87 → 87 (72 → 72) | 1 → 1 | 6 → 6 | 34 → 34 |
| board | 264 → 221 (249 → 206) | 4 → 2 | 8 → 7 | 84 → 80 |
| board-try | 232 → 204 (217 → 189) | 4 → 3 | 0 → 0 | 82 → 78 |
| profile | 268 → 240 (235 → 204) | 6 → 2 | 7 → 7 | 60 → 63 |
| profile-scene | 266 → 248 (221 → 200) | 6 → 3 | 6 → 6 | 49 → 52 |
| live | 122 → 121 (107 → 106) | 3 → 3 | 0 → 0 | 52 → 52 |
| live-playing | 221 → 219 (206 → 204) | 6 → 6 | 6 → 6 | 72 → 72 |
| live-aftermath | 189 → 189 (174 → 174) | 3 → 3 | 4 → 4 | 64 → 64 |
| outputs | 115 → 111 (100 → 96) | 3 → 2 | 5 → 5 | 28 → 28 |
| look | 340 → 340 (285 → 285) | 12 → 12 | 26 → 26 | 33 → 33 |
| backup-open | 297 → 220 (282 → 205) | 11 → 11 | 9 → 9 | 34 → 34 |
| moved | 181 → 179 (166 → 164) | 6 → 6 | 1 → 1 | 17 → 17 |
| relink | 203 → 180 (188 → 165) | 5 → 4 | 4 → 4 | 18 → 18 |
| bar-both | 252 → 212 (236 → 196) | 6 → 2 | 6 → 5 | 96 → 89 |

Screen names are the states in `tools/r6-measure.js` (for example `picker-inside` is the music picker with a playlist open).

## Cuts, per screen

**Campaigns.** "3 campaigns" beside the heading (the cards are the count). The theme's name on each card: the card is
drawn in its theme; the name is in the card's hover text.

**One campaign.** "Next: Session 14…" in the Sessions header (the row's Next badge and Run next session say it).
"In every session. New ones: Playlists." in both side boxes: read out with the box, in the Add button's hover text;
new playlists and boards are made from the rail. Resting counts and "Saved"/"Empty" on open boxes.

**Session planner.** The sentence about the order of Live's lists (about Live, not the plan; deleted in part 5,
screen-reader copy included). "Plays in order, then loops. Drop files here to
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
by Lyre from the track's loudness. Choose another to change it." became "Suggested by Lyre" (the rest on hover and
read out); "Your choice." goes, and "Lyre suggested … Use the suggestion" shows only when your choice differs; "Manual" on each playlist row (only "Dynamic" is marked); "Add
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

1. **Resting statuses only on folded boxes.** Open boxes no longer say Ready, Saved, Empty or "6 scenes". (Nik,
   16:14: no Saved in any box, a Saved pop-up instead; Ready and the scene count go, folded too. Done in part 5.)
   *Recommend keeping:* those words never asked you to do anything, and seven boxes on a screen saying Ready is seven
   things to read. Playing, On air, n selected and warnings still show.
2. **Fill the column on hover.** The ⤢ button appears when the pointer is over the box or the keyboard is in its
   header. *Recommend keeping:* it is a rare layout action and was in every header. If you use it often, say so and it
   comes back for good.
3. **The sentence about Live's list order off the planner.** *Recommend keeping it off:* it explains Live's list
   order, which Live itself shows. (Nik, 16:14: "Definitely delete the planner sentence": deleted in part 5, the
   screen-reader copy too.)
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

Screenshots before and after for the five busiest screens are in `shots/r6/before` and `shots/r6/after` (2.6 MB, so
not committed; `SHOTS=1 ONLY=… node tools/r6-measure.js <dir>` makes them again, `OUT=<old build>` for the before).

## Your notes on 0.4.0

> "We should add a 'Add to queue' button to tracks and playlists, so that they can be added quickly to the end of the
> currently playing list, in the live view" · "I need a repeat button on the now playing bar" · "I need the ability to
> reorder tracks in playlists in the scene view, and have that reordering apply only in that scene. I need the same with
> playlists in the session playlist view, and campaign playlists in the campaign playlists view" · "I need the ability
> to click the scene in the live view and have it expand, so I can see everything queued up in that scene, before I
> press play on that scene. I don't want this to repolace the scene music pane, but that should be retitled 'Current
> Scene Music' and only display the scene now running." · "I need a contextual back button everywhere." · "I need a way
> to switch outputs dynamically on the page in live view" · "I also need repeat one buttons on the tracks in the current
> scene music pane" · "Enhance the instructions for adding new bots with proper directions about the Oauth2 URL step and
> inviting the bot to the server, and doing that before having the token is added to Lyre" · "I don't like this
> 'bring...' label or the design for the voice channels pane in outputs. It's confusing and unintuitive and too many
> clicks to add a bot to a channel, and to take them out of it. There should be an easy way to kick bots with a click,
> in both that view, and in the live view"
>
> Nik, 6 Nov 2026, 10:34, after testing 0.4.0; he also asked when Settings, tokens and new bots come to the new
> interface.

These designs follow round 6's rules: labels over sentences, no new hint lines, the rare behind ⋯ or on hover, icons
with names and hover text, and nothing lost for the keyboard or a screen reader. BUG-19, BUG-20 and BUG-21 are the
w5-fixes stream's.

**UX-18 Back.** Every screen opened from another one has Back first in its header, named for where it goes ("Back to
Session 14", "Back to The abbey ruins" from inside a scene, "Back to Outputs"). It returns to the same place: the route
(so the selected track, playlist or board), the scroll position of every box, the open scene, and focus on the control
you left by. Alt+Left and the mouse's back button do the same. Screens opened from the menu, or by address, have none,
and moving within one screen (another track in the Library, another place in the Audio profile) is not a step. Where a
breadcrumb would go to the same place as Back, that breadcrumb is left out. The Audio profile's own Back is now this
one; opened by address it still goes to the scene or session it shows. *Data:* none; the steps live in the window. In
Electron, the mouse's back button on Windows arrives as the window's `app-command` `browser-backward`.

**PLY-16 Add to queue.** The queue icon on every track and playlist in Live (Current scene music, its session and
campaign menus, Off script, an unfolded scene) is now Add to queue: it goes to the end of the queue in that box's room
(its To: room when there are two or more; all of them for All rooms), or plays at once when the room is silent. The
room's box lists the queue as Up next, numbered, each with ×, and Clear; a queued playlist is one item with its track
count, playing its tracks in that place's order. An 8-second Undo shows in the room's box, and Ctrl+Z works too. The
queued items play after the current track, before the scene or playlist carries on (question 1). *Data:* none saved;
the queue is per room and per evening.

**PLY-17 Repeat.** Each Now playing row has Shuffle and Repeat beside Next, standard media icons pressed while on.
Repeat goes off → all → one; for a playlist it is the PLY-13 play order of that playlist in the place it plays from
(question 3), so the box's play order button shows the same; for a single track it is off or one. Live's room boxes
have the same Repeat in their music controls. Each track of Current scene music has Repeat one: that track plays again
when it ends, in this scene only. It shows on the row on air, when it is on, and on hover or keyboard focus, so seven
rows do not show seven more icons. *Data:* playlists use `play_orders` (PLY-13); Repeat one needs `repeat_ones
(place_key, track_id)`, a row present while on.

**ORG-13 Order per place.** An open playlist in a scene (the planner), in Session playlists and in Campaign playlists
shows a drag handle on each track; drag, or Alt+Up / Alt+Down on any control of the row, moves it, in that place only.
The list's accessible description says so. Once the order differs, "Order in this scene" and "Back to the playlist's
order" show above it. Live and the Now playing bar play in that order; shuffle still applies on top. The session's and
the campaign's playlists can be dragged into order in their panes as well, or moved with Move up / Move down in ⋯.
*Data:* `track_orders (place_key, playlist_id, track_ids)` beside `play_orders`, keyed the same way ('sc:…', 'ss:…',
'cp:…'). Tracks it does not name (added later) follow in the playlist's own order; a removed track drops out; the row
goes when it equals the playlist's order, or with its place or playlist. The panes' own order is the position the
session's and campaign's playlist lists already keep.

**SHW-7 See a scene before it starts.** A scene's name in Live's Scenes box is a button: click it (or Enter, or Right;
Left folds) and the scene unfolds in place: its music in the order it will play, each track with its length, Preview
and Add to queue, then its ambience (with Preview) and its pad boards. The row's Start button plays it. Unfolding never
changes what plays. The music box is now **Current scene music** and shows only the scene that runs: before the first
scene it says "No scene yet" and lists nothing until a session or campaign playlist is chosen from its two menus
(question 2). *Data:* none.

**OUT-7 Add bot and Kick.** Outputs' voice channels have no Bring…. Each bot in a channel is a chip with its own ×
(Kick); a channel with no bot has Add (read out as "Add bot to Whispers"), which puts the one free bot there in one
click, or offers a short choice
when there are several (with no bot free, the choice says which room the bot leaves). The bot boxes' Leave is the same
×. In Live, each room box shows its bot as a button beside Mute and volume: it changes the channel (or puts another free
bot in this channel) on the page, and also holds Copy what another room plays, Outputs, and Bots and tokens. Its × kicks
the bot. Kicking never asks: when the players there were hearing something, an Undo (8 s in Live, the undo bar
elsewhere) puts the bot back and plays what it played from where it was. *Data:* none new.

**OUT-8 Settings in Lyre.** Settings is in the menu (gear, above Look and feel). Discord bots first: each bot with its
status (Connected, Connecting…, Not connected, Could not connect), the servers it is in (or "In no server yet" with
Invite it…), Connect or Disconnect, its token as its last four characters with Replace…, and Rename and Remove behind ⋯
(Remove has Undo; the last bot cannot be removed). Add a bot is a three-step sheet in Discord's order: **1 Create it**
(Open the Discord Developer Portal; New Application, a name, Create); **2 Invite it**, before Lyre has the token: paste
the Application ID (General Information) and Open the invite opens
`https://discord.com/oauth2/authorize?client_id=<id>&scope=bot&permissions=3146752` (View Channels 1024 + Connect
1048576 + Speak 2097152), choose the server, Authorize; you need Manage Server there; "Or make the invite by hand" folds
out OAuth2 › URL Generator, Scopes: bot, Bot Permissions: View Channels, Connect, Speak, open the Generated URL;
**3 Connect it**: Bot › Reset Token › Copy, paste, Connect. Then it says which servers the bot is in, or that it is in
none yet with the invite again. The other main-window settings Lyre still needs (`src/renderer/features/settings`) are
the rest of the page: Sound to Discord (Best sound quality or Lighter on the computer, the description on hover),
and folded, Remote control (Stream Deck: on or off, address, port), Website tabs (address bar, microphones and other
inputs, several inputs at once, Clear website data) and Local files (folders that open without asking, Ask again).
Outputs' "Tokens and new bots" and Live's "Bots and tokens" open it, with Back. *Data:* a bot's application ID (new,
optional, only for the invite link); its servers come from Discord at login and are not saved; the token stays
encrypted (SEC-5).

Sources for the Discord steps, checked 6 Nov 2026 (discord.com/developers/docs now redirects to docs.discord.com):
- [Building your first Discord Bot](https://docs.discord.com/developers/quick-start/getting-started): New Application
  and Create; the Application ID on General Information; Bot › Token › Reset Token, copied once; an app installed to a
  server "must be authorized by a server member with the `MANAGE_GUILD` permission" (Manage Server). It now invites
  through the Installation page's Install Link; Lyre's own invite link makes that step unnecessary.
- [Hosting on Cloudflare Workers](https://docs.discord.com/developers/tutorials/hosting-on-cloudflare-workers): "Click
  on the OAuth2 tab, and choose the URL Generator. Click the bot … scope", check the permissions, "copy the Generated
  URL", paste it in the browser and select the server.
- [OAuth2](https://docs.discord.com/developers/topics/oauth2): the bot authorization URL,
  `https://discord.com/oauth2/authorize?client_id=…&scope=bot&permissions=…`.
- [Permissions](https://docs.discord.com/developers/topics/permissions): VIEW_CHANNEL 1 << 10, CONNECT 1 << 20, SPEAK
  1 << 21, MANAGE_GUILD 1 << 5. The page does not give the client's labels; "View Channels", "Connect", "Speak",
  "Manage Server" and the Authorize button are the portal's and Discord's own words, not checked against the docs.

### Numbers (round 6 script, 1920×1080; 960×1000 words in brackets)

The twelve screens these designs change, before (the prototype after round 6's cuts and the wave 4 merge) and after:
words 2,270 → 2,278 (+0.4 %) at 1920×1080 and 1,995 → 1,991 at 960×1000; hint lines 30 → 29; facts shown twice
48 → 47; controls 937 → 975 (+4 %: Repeat, the bot button and Kick, Add to queue on playlist rows, and scene names that
are now buttons). Live on standby has fewer words than before (121 → 115): before a scene runs, Current scene music
lists nothing.

| Screen and state | Words | Hint lines | Shown twice | Controls |
| --- | ---: | ---: | ---: | ---: |
| live | 121 → 115 (106 → 99) | 3 → 2 | 0 → 0 | 52 → 55 |
| live-playing | 219 → 223 (204 → 207) | 6 → 6 | 6 → 6 | 72 → 84 |
| live-aftermath | 189 → 193 (174 → 177) | 3 → 3 | 4 → 3 | 64 → 74 |
| outputs | 111 → 109 (96 → 93) | 2 → 2 | 5 → 5 | 28 → 30 |
| campaign | 108 → 109 (91 → 91) | 1 → 1 | 1 → 1 | 73 → 74 |
| campaign-onair | 131 → 132 (114 → 114) | 1 → 1 | 1 → 1 | 79 → 81 |
| planner | 204 → 205 (187 → 187) | 2 → 2 | 4 → 4 | 118 → 119 |
| planner-two-scenes | 228 → 229 (181 → 181) | 2 → 2 | 5 → 5 | 124 → 125 |
| planner-order-menu | 259 → 260 (242 → 242) | 3 → 3 | 4 → 4 | 123 → 124 |
| profile | 240 → 241 (204 → 204) | 2 → 2 | 7 → 7 | 63 → 64 |
| profile-scene | 248 → 249 (200 → 200) | 3 → 3 | 6 → 6 | 52 → 53 |
| bar-both | 212 → 213 (196 → 196) | 2 → 2 | 5 → 5 | 89 → 92 |
| settings (new) | 66 (50) | 0 | 3 | 23 |
| live-scene-open (new: Crypt ambush unfolded while playing) | 416 (384) | 6 | 11 | 119 |
| planner-playlist-open (new: a scene's playlist open, own order) | 269 (228) | 2 | 6 | 127 |

The one word added on most prep screens is the rail's Settings. The unfolded scene is long because Crypt ambush plays
17 tracks; it is folded unless you open it.

### Questions for Nik (round 6, part 2)

1. **Add to queue plays after the current track, before the list carries on.** You wrote "to the end of the currently
   playing list". *Recommend this:* a scene's or playlist's list with Repeat all never ends, so anything added after
   it would never play; Up next shows the order, and what you add goes to its end.
2. **Current scene music keeps the Session and Campaign menus.** It shows only the running scene's own list, but its
   two menus still open the session's and campaign's playlists there. *Recommend keeping them:* mid-game they are the
   next place you reach for, and a separate box would add a fifth box to Live.
3. **Repeat on the bar is the playlist's play order where it plays from**, remembered like the play order button, not
   only for this play. *Recommend this:* one setting, shown the same on the bar, in Live and in the planner; a repeat
   for this play only would show one thing on the bar and another in the scene.

## Part 3: Live

> "In live I need several boxes - one for scenes, where I can expand each scene, and choose to play it or not, and
> see its details, pads, playlists and tracks, and do any live adjustments I need. One for the current playing scene,
> with all the details of that scene expanded. One for the currently playing music (On Air) which shows what's being
> played to which audience. One for campaign playlists, that I can expand and choose to play in whole or part at any
> time, one the same for session playlists, one for campaign pads, and one for session pads. They need to be clearly
> distinguished, their functions very visually clear and distinct at a glance, and with simple, easy to understand
> names, wordings, buttons and layouts. What we had wasn't bad, but it was high on cognitive load and I think we can
> reduce that a bit."
>
> "you have a tracklist, which has a top and a bottom - the first added and last added. Add to queue should play after
> last added. We need a separate play next button (which I think we already have in some places)."
>
> "we need to have separate repeat functions for the things playing on each output. Repeat on the now playing bar
> should not persist. It should end once the music has stopped. The now playing bar is about what's happening right
> now, and it's transient."
>
> Nik, 6 Nov 2026, 12:14 and 12:24. At 12:30 he chose to keep Repeat one on a track in Current scene saved with the
> scene.

This section replaces part 2's PLY-16 (Add to queue after the current track) and PLY-17 (Repeat on the bar saved as the
playlist's play order) where they differ, and answers part 2's questions 1 to 3.

### Layout

```
 three columns (from 1200 px of app: 1920x1080, 1280x800)
 +-----------------------------------------------------------------------------------------+
 | Prep|Live   The Sunken Crown > Session 14 v   [ Find a track  / ]    Fade all  Stop all  Keys |
 +----------------+---------------------------+--------------------------------------------+
 | 1 SCENES       | 2 CURRENT SCENE  name     | 4 [Session] PLAYLISTS     (open)            |
 | Next scene >   |   notes                   | 5 [Session] PADS          (folded)          |
 | > scene  Start |   music in play order     | 6 [Campaign] PLAYLISTS    (folded)          |
 | > scene  Start |   ambience                | 7 [Campaign] PADS         (folded)          |
 |   ...          |   the scene's pads + keys |                                            |
 +----------------+---------------------------+--------------------------------------------+
 | 3 ON AIR                                                                        [+ room] |
 | Table  Playing                  mute  volume  bot v  x  | Side room ...                  |
 |  Music  title  progress  |< || >| repeat fade | Up next |                                |
 |  Ambience title ...                          |  ...    |                                |
 +-----------------------------------------------------------------------------------------+
 two columns (820 to 1199 px, 960x1000): Scenes, then the session and campaign boxes | Current scene; On air below.
 one column (below 820 px): Scenes, Current scene, the four session and campaign boxes; On air below.
```

The boxes never change places during play. Scenes and Current scene are where the eye starts; the session's boxes come
before the campaign's; On air is docked along the bottom of the screen in every layout, so it is in view whatever the
other boxes do (it takes at most 46 % of the height and scrolls inside itself beyond that). Each kind of box has one
icon and one coloured edge, and the name in words: scenes (scroll, grey), the running scene (play, the theme's accent),
On air (broadcast, red), playlists (playlist icon, the music blue), pads (grid, the pads lime). The session and campaign
versions of a box are the same box with a small tag in words, "Session" or "Campaign", before the name. Colour is never
the only cue, and no new colours were added: `tools/check-contrast.js` passes for all five themes.

Each box is a region named as Nik named it, with a level 2 heading. Alt+1 to Alt+7 go straight to the boxes in the
order of the diagram (each box's toggle has its `aria-keyshortcuts`), and F6 / Shift+F6 move to the next or previous box.
F6 gives way to a pad of the Current scene's board that has F6 as its key, so pad keys F1 to F12 keep working. Space,
Ctrl+Z, Shift+Esc and / are unchanged. Queue, Play next, Up next, Kick, Undo and Stop pads are announced in the page's
live region.

Folded at first: Session pads, Campaign pads and Campaign playlists. The running scene's own pads are open in Current
scene, and tonight's planned music is the scene's and the session's. A box once unfolded stays unfolded on this
computer.

### The boxes

**Scenes.** Next scene (Space) and the 8-second Undo strip at the top, then every scene with Now and Next marked and
Start (or Restart) on each. "Starts when" shows for the next scene only: the running scene's details are in Current
scene. A scene's name unfolds it in place (Enter or Right; Left folds): when it starts, its notes, its music in play
order, its ambience and its pad boards, each board unfolding to its pads. In an unfolded scene a track has Preview,
Play next, Add to queue and Repeat one, and a playlist its play order there; there is no Play on air, because Start is
how a scene is played, and unfolding never changes what plays.

**Current scene.** The running scene, all of it: its name in the header, its notes (two lines, More), its music in
the order it plays with the track on air marked, its ambience, and its pad boards (a switch when it has more than one)
with their keys. Before the first scene it says "No scene yet". Its ⋯ holds the rare things: play its music from the
top, open it in the session planner, edit its pad board. Stop pads appears beside the pads while a pad sounds.

**On air.** What each room hears, a part per room with the room's name as a heading: Playing, Paused, Muted, Joining
or Silent; Mute, volume, the bot button (change channel or bot, copy another room, Outputs, Bots and tokens) and Kick.
Under it the music (Previous, Pause, Next, Repeat, Fade), the ambience, the effects while any sound, and Up next. With
no bot in a voice channel the part is "No room", says "Nobody hears it", and offers Join Table (BUG-19). Add a room is
the + in the header. Up next is the room's running list from the next track to the bottom: Play next items, the
planned tracks still to come (folded to the first, with "n more"), then what was added, marked with the queue icon and
read out as "Added:". Each entry has ×, which takes it out for this evening only, with Undo.

**Session playlists** and **Campaign playlists.** Each playlist unfolds to its tracks in that place's order; Play on
air plays it from the top, and a single track plays any time. The session's and the campaign's single tracks are rows
at the bottom (ORG-12). With two rooms or more each has its own To:.

**Session pads** and **Campaign pads.** The boards of the session or the campaign, a switch when there are several,
pads to click. Pad keys belong to the Current scene's board only, so two boards with the same keys never compete.

**Find a track** (was the Off script box). A field in the top strip; / or a click opens its results under it, with the
Music, Ambience and FX filter, the moods and All tags. Esc clears it, a second Esc (or ×, or a click elsewhere) closes
it, and no box moves.

**Rows.** Every track and playlist row in Live reads as its name and length with one action showing, Play on air
(Preview in an unfolded scene). Preview, Play next, Add to queue, Repeat one and the play order show on the row on
air, on hover and when the keyboard is on the row; they are always in the Tab order, and on a touch screen they always
show. Moods and energy are in a row's details, opened by its name.

### Play next, Add to queue and Repeat (the data for the contracts)

**Queue per room, for the evening, not saved.** Each room keeps a running list: the plan (a scene's music in order, a
playlist in its place's order, or one track), Play next items, which play right after the current track (the newest
first, and before the rest of a Play next playlist that is playing), and Add to queue items, which play after the
bottom of the plan in the order added. A queued playlist is one item with its tracks in its place's order. With Repeat
off, an added item plays once and leaves the list; with Repeat all, added items come round again with the rest. After
the bottom: a scene's music starts again from its top, as it always has; a playlist starts again with Repeat all and
otherwise stops. × in Up next takes a planned track out for this evening (a skip, keyed by its position in the scene or
the playlist) or removes an added item. Starting another scene starts a new plan; what was added stays at the bottom.
Loading another session clears the lists. The contract needs, per room: `pn` and `q` lists of
`{ trackIds, playlistId | null, placeKey, name }`, the playing position (plan, Play next or added), the plan position
to return to, and the skips. Nothing is written to the database. Ctrl+Z and the 8-second Undo take back the last add,
removal or Clear added.

**Repeat per room, not saved.** Each room has `repeat: null | 'off' | 'all' | 'one'` for what plays now, shown on the
Now playing bar and in On air. Until it is pressed it shows what the music does by itself: a scene track's saved Repeat
one, a playlist's own play order where it plays from (PLY-13), or off. Pressing goes off, all, one in turn. It goes back
to null when that room's music stops, and when a scene or Play on air starts a new plan. The play order saved per place
(PLY-13, `play_orders`) is never changed by it.

**Repeat one per scene and track, saved.** `repeat_ones (place_key 'sc:<campaign>:<session>:<scene>', track_id)`, a row
while it is on; for the contract, it goes with the scene or the track and is in backups. The same button is on that track in
Current scene, in an unfolded scene and in the session planner (the scene's tracks, and the tracks of its playlists).
Starting the scene next session repeats that track again. Pressing it while that track plays clears a Repeat chosen in
that room, so the saved setting shows at once.

### Numbers

Round 6 script (`tools/r6-measure.js`), Live as it was this morning (round 6 with part 2 and the 0.4.1 fixes) and
after; 1920×1080, words at 960×1000 in brackets. Before a scene runs (`live`) and mid-scene (`live-playing`) are the two
Nik's rule is about; both are below this morning's on every count.

| Screen and state | Words | Hint lines | Shown twice | Controls |
| --- | ---: | ---: | ---: | ---: |
| live | 115 → 85 (99 → 69) | 2 → 1 | 0 → 0 | 55 → 44 |
| live-playing | 223 → 218 (207 → 202) | 6 → 2 | 6 → 5 | 84 → 84 |
| live-aftermath | 193 → 174 (177 → 158) | 3 → 1 | 3 → 4 | 74 → 72 |
| live-scene-open (Crypt ambush unfolded) | 416 → 261 (384 → 240) | 6 → 3 | 11 → 7 | 119 → 95 |

Mid-scene the screen now shows the scene's pads, Session playlists, the four session and campaign boxes and Up next,
which this morning were folded or did not exist, for 5 fewer words and the same number of controls. Most of the room
comes from one action per row (Play on air) with the others on hover and focus, the track counts and the scene
position moved to hover text, the moods and energy moved to a row's details, the Off script box's filters and moods
moved under Find a track, and no "Starts when" on the running scene. The unfolded scene is shorter because a playlist
in it is one row that unfolds, where part 2 listed all 17 tracks. The prep screens are unchanged (planner 205, two
scenes 229, campaign with the bar 132, the bar with two rooms 213 words): the planner's Repeat one is hidden until the
row is pointed at or focused, or it is on.

Checks: the prototype spec project passes (`yarn heavy`), `tools/r5-check.js` passes ("every screen passed"),
`tools/check-contrast.js` passes for the five themes. Screenshots of Live mid-scene, with a Play next and an added
playlist in Up next, are in `shots/r6/live-part3-1920.png`, `-1280.png` and `-960.png`.

### Questions for Nik (round 6, part 3)

1. **Find a track is a field in the top strip, not an eighth box.** Your seven boxes have no place for Off script.
   *Recommend keeping it there:* the search is used in bursts, the field is always in the same place, / still jumps to
   it, and its results cover the boxes only while you search (Esc puts everything back). The other choice is an eighth
   box, folded.
2. **One action per row.** A track or playlist row shows Play on air; Preview, Play next, Add to queue, Repeat one and
   the play order show when you point at the row, when the keyboard is on it, and on the row on air (always on a touch
   screen). *Recommend keeping:* it is most of the drop in reading load, and the buttons are where your pointer already
   is. If you miss them, say so and Preview comes back for good.
3. **What you add stays when the next scene starts.** Play next and Add to queue items belong to the room for the
   evening, so they stay at the bottom of the new scene's list (× or Clear added takes them out). *Recommend keeping:*
   it is what "for this evening" means, and nothing you queued is lost by pressing Space. The other choice is that a
   new scene clears them.

### Try it

The click list for the whole of round 6 is at the end of Part 4.

## Part 4: review fixes

> "dragging is generally fine for me and my audience, so don't over clutter the interface if you can avoid it."
>
> Nik, 6 Nov 2026, 13:51. His answers of 13:55 (`R6-NIK-DECISIONS.md`) decided the row buttons, the queue on a new
> scene, "room" and Find a track.

The independent review is `reviews/r6-ux.md`. One line per finding:

| # | Finding | What was done |
| --- | --- | --- |
| 1 | Ctrl+Z after an action with no Undo took back the scene before it | Fixed as proposed. Pause, Next, Previous, Fade, a pad, Repeat, Repeat one, mute, volume, moving or kicking a bot, Play on air, Fade all and Stop all end the Undo strips showing (`touched()` in `live.js`, with core's Repeat, Repeat one, `botJoin` and `botLeave` wrapped). Only one Undo is live at a time, the latest. |
| 2 | A bot moved into an empty channel still said Playing; the move had no Undo | Fixed: the room says **Nobody there** (warning) with **Move to Table**; a move that leaves listeners silent has the 8-second Undo; the channel list says "empty" and marks "players"; the Now playing bar says "Nobody is in Side room: nobody hears it". The fix offers only a channel with two people or more and no other bot. |
| 3 | A scene's playlist could be reordered only by dragging or Alt+Up/Down (WCAG 2.5.7) | Fixed with Nik's 13:51 rule instead of a ⋯ on every row: one **Reorder** switch above an open playlist's tracks (in a scene, the session and the campaign) shows **Move up** and **Move down** on each row while it is on. Dragging stays the main way and the rows stay as they were at rest. Chosen over hover-and-right-click because a trackpad user can see it, a touch screen can press it, and it is one control per list, not one per row. |
| 4 | Live did not reflow at 320 px or 200 % zoom | Fixed: below 640 px the top strip wraps (Prep \| Live and the icon buttons, then the session, then Find a track full width), a room's header wraps, a lane's label goes above its title; under 480 px of height each room is one line (name, status, title, Pause) with **Show everything in …**. Text read out after a cut-off title no longer widens the page. No sideways scroll at 320×640 or 640×400. |
| 5 | An empty pad slot showed "Add pad" but was named "Empty slot…" | Fixed as proposed: "Add pad: row 3, column 4". |
| 6 | The seven boxes could not be told apart without colour | Fixed with shape: On air has a filled band for a header; Current scene a 5 px accent edge down its left side; box icons are 18 px. Instead of the Session/Campaign tags, the four boxes sit in two trays headed **This session** (filled) and **Whole campaign** (dashed outline), so position and shape say which is which. Checked with the review's five-second test in all five themes, in greyscale and with deuteranopia: the band, the left edge and the two trays are told apart in each. |
| 7 | Three boxes start folded while 40 % of the screen is empty | Partly. In three columns the boxes of a column now share its height down to On air and scroll inside, so no blank space is left and no box moves when a list grows. Session pads and the campaign's boxes still start folded (once unfolded they stay so): opening them adds 25 to 60 words, over the part 3 numbers Live must keep. Up next still shows one planned track: the rest is Current scene's list, in the same order, just above it. When Session pads is open and its board is the one Current scene shows, it says "Drowned Abbey: in Current scene" instead of drawing the same 12 pads twice. |
| 8 | Play next, Add to queue and Preview invisible until hover | Fixed as Nik decided: always shown, greyed (`--ink-3`) at rest, full colour on hover and focus. Repeat one and the play order button still show on hover or focus (they are settings, not quick actions). |
| 9 | One icon for opposite actions | Fixed: Undo is a hooked arrow (restart keeps the circle); a muted room shows a struck-through speaker; Kick is a door with an arrow out (Live and Rooms), in Live with the word Kick from 1280 px, 8 px from the bot button; Play on air is a play triangle sounding out, so it no longer looks like the On air tag. |
| 10 | "On air · The players hear this" with no room | Fixed: "On air · no room" (or "On air · nobody there"), outlined in the warning colour, hover "Nobody hears it: …". The Now playing bar uses the same tag. |
| 11 | Pad and playlist names cut at 1280 and 960 | Fixed: pad names wrap to two lines in every pad box, with the key in the top-right corner and the play mode (or On) in the bottom-right; playlist names wrap to two lines. |
| 12 | Nowhere for "the guide" | Fixed with the app's own Help (FND-8, from wave4, files unchanged): **Help** at the foot of the rail, F1, a side panel with search and the articles; **Help** at the foot of Live's Keys. The Live article is rewritten and a new one, "Play next, Add to queue and Repeat", holds what left the screen (list order, Repeat against Repeat one, rooms). Drafts in `design/prototype/help-drafts`, which replace the app's article of the same name in the prototype. |
| 13 | Different names for the same things | Fixed: the planner's and campaign page's boxes are **Session pads** and **Campaign pads**; Outputs is **Rooms** (menu, screen title, Back, Live's room menu, "Open Rooms"; the address stays `#/outputs`); Repeat one's hover says "Repeat in this scene (saved)" and a pressed one has the saved dot. |
| 14 | Two announcements for one event | Fixed: a toast within half a second of an announcement is shown but not read out again. |
| 15 | Back from a screen opened from Live's ⋯ focused Prep \| Live | Fixed: a link in a menu records the menu's button, and Back focuses it. |
| 16 | Live keeps Back after Run | Left: Nik asked for "a contextual back button everywhere" (6 Nov 10:34). Back goes where he came from (the campaign page after Run); Prep \| Live goes to the planner. |
| 17 | Add a bot step 2: the ID's place after the field | Fixed: "General Information › Application ID › Copy" comes first; step 3 says "Discord shows it once." |
| 18 | Settings shows 0.4.0 | Fixed: the version is `L.version` (0.5.0 here; the app shows its own). |
| 19 | Two new scenes gave duplicate control names | Fixed: a new scene is "Scene <n>" until renamed; the ambience button is "Choose ambience for <scene>". |
| 20 | On air's Fade is icon-only, with a non-standard glyph | Left: the word on each lane (music and ambience in every room) would raise Live's words over part 3's; the button's name and hover say "Fade music out". |
| 21 | "Starts when As the recap starts" | Fixed: "Starts when: As the recap starts". |

Also done:
- **Queue on a new scene** (Nik, 13:55): starting a scene clears what was added to every room's list; the scene's
  Undo brings it back.
- **Play next of the track the scene plays next** listed it twice; it now plays once (the planned copy is skipped,
  and Undo restores it). While fixing it: after a Play next track started, Up next disappeared until the next redraw
  (the playing item was marked after core drew the screen); fixed in `startEntry`.
- **The campaign's name** left the top strip (it is read out, and in the session button's hover text). Its three
  words paid for Help in the rail and Kick in each room.
- `tools/lv-keys.js` is rewritten for the seven boxes (it pointed at Scene music, Off script and the old room boxes);
  it now also checks Must 1, Must 2, the queue, Help and the greyed row buttons. All its checks pass.
- Every tool, and `openRoute` in the specs, marks the first-run tour as seen (`tour: "done"`), as wave4 does.

### Numbers

`tools/r6-measure.js`, part 3 (before) and after; 1920×1080, words at 960×1000 in brackets.

| Screen and state | Words | Hint lines | Shown twice | Controls |
| --- | ---: | ---: | ---: | ---: |
| live | 85 → 84 (69 → 66) | 1 → 1 | 0 → 0 | 44 → 48 |
| live-playing | 218 → 217 (202 → 199) | 2 → 2 | 5 → 5 | 84 → 97 |
| live-aftermath | 174 → 173 (158 → 155) | 1 → 1 | 4 → 4 | 72 → 79 |
| live-scene-open | 261 → 260 (240 → 236) | 3 → 3 | 7 → 7 | 95 → 116 |
| planner-playlist-open | 269 → 261 (228 → 227) | 2 → 2 | 6 → 5 | 128 → 130 |
| outputs (Rooms) | 109 → 110 (93 → 93) | 2 → 2 | 5 → 5 | 30 → 31 |
| bar-both | 213 → 220 (196 → 202) | 2 → 2 | 5 → 4 | 93 → 94 |

Live's reading load is at or under part 3 in every state. Controls rise because Preview, Play next and Add to queue
now show on every row (Nik's 13:55 answer: they are icons, so nothing more to read) and Help joins the rail.
`bar-both` gains "Nobody is in Side room: nobody hears it" (Must 2). Checks: the prototype spec project passes
(`yarn heavy`), `tools/r5-check.js` ("every screen passed"), `tools/check-contrast.js`, `tools/lv-keys.js`.

### For the lead: Help words for the app

The app's articles are the lead's (`src/lyre/help/articles`). Drafts in `design/prototype/help-drafts`:
- `10-live.md`: rewritten for the seven boxes, rooms, Nobody there and Ctrl+Z.
- `15-up-next.md` (new): Play next, Add to queue, Up next, the two Repeats.
- `01-connect-discord.md`: Outputs → Rooms, Leave → Kick (the rest of it still describes 0.4's Settings).
- `03-add-music.md`: Off script → Find a track.

### Try it (the whole of round 6, in the order of an evening)

Open `design/prototype/lyre-prototype.html`.
1. Press F1: Help opens beside the screen. Search "queue", open the article, press Esc.
2. Campaigns › The Sunken Crown › Session 14. Open The abbey ruins, then The Abbess under its music.
3. Press **Reorder** above its tracks and **Move up** on the second track. Press Reorder again: the arrows go.
4. Add scene twice: two new scenes, "Scene 7" and "Scene 8".
5. Press **Live** in Prep | Live. Click "Crypt ambush" in Scenes: it unfolds; nothing changes in On air.
6. Press **Start** beside The abbey ruins. On air, along the bottom, says Table, Playing.
7. On "Haunted sea shanty…" in Current scene, press **Play next** (greyed until you point at it, but always there).
   It is listed once in Up next.
8. Press **Add to queue** on The Abbess, then **Next scene**: what you added goes. Press **Undo**: it comes back.
9. Press **Pause** in On air, then Ctrl+Z: the scene stays.
10. Press **Repeat** in On air: all, then one. Point at Repeat one on the first track: "Repeat in this scene (saved)".
11. Unfold **Pads** under This session: "Drowned Abbey: in Current scene". Press a pad key (1 to 4, Q to R).
12. The bot button (Lyre Table) › Side room ("empty"): the room says **Nobody there** with **Move to Table** and Undo.
    Press Undo.
13. Press /, type bells, press Esc twice.
14. Narrow the window (or zoom to 200 %): the top strip wraps, and each room becomes one line.
15. Rooms in the menu: **Kick** (door and arrow) on a bot; **Tokens and new bots** › Add a bot: the Application ID's
    place comes before its field.

## Part 5: the Saved pop-up; Ready, Saved and the scene count go

> "We should have little pop ups somewhere unobtrusive but noticeable as a consistent design standard indicating
> something has been saved, so we have consistent feedback across the whole platform. I don't want saved in each box.
> Let's kill ready, seems dumb. Kill the scene count, unnecessary. […] Definitely delete the planner sentence."
>
> Nik, 6 Nov 2026, 16:14

### The standard (build it once, in the shell)

**Where** (changed in part 6, Nik, 17:14: "Let's move the saved pop up to the bottom right hand corner"). The
bottom-right corner of the work area, 12 px in from the right edge and 12 px above the bottom, or 12 px above the Now
playing bar when the bar shows; at most 400 px wide. The same place on every screen and at every width. It covers
neither the Now playing bar, nor On air (at the top of Live since part 6), nor the top bar. The failure card and the
Undo note (Reset to whole track, Delete board, Tag…) stack in the same corner: the Undo note lowest, then the failure,
then the pop-up. If it would sit over the field or button in use (a Notes field at the bottom right, say), it moves to
just above that control. Clicks pass through it, so it never blocks what it briefly covers. With Help open it stays in
the work area, left of Help.

**When.** Whenever something is saved: a field on Enter, on leaving it, or after a second without typing (never per
key); a list, tick box, switch or slider when it changes (a slider on release); Done in a picker when the ticks
changed; a drop; a reorder; a rename; a change in the Audio profile once the drag, nudge or typing is over; Repeat one
and a play order (saved with their place); Settings. Not when the change already shows its own message with an
action: an Undo strip (Live's scene change and queue, a deleted scene or board, Tag…, Reset to whole track), the
export's "Saved … in Documents\Lyre" with Show in folder, an import's or relink's result, a drop on the Playlists page
or Library that asks what to do or offers Open. One event, one message.

**Wording.** "Saved: " and what, in a few words: "Saved: The Sunken Crown notes", "Saved: Repeat one in The abbey
ruins", "Saved: order of Session 14 scenes", "Saved: name “The Abbess”". A drop adds what came in after " · ":
"Saved: The abbey ruins music · 2 tracks from position 3 · 2 new tracks added to the Library". Other notes (Undone, a
warning, a test chime) use the same place and look without the tick and "Saved:".

**Timing.** 3 s (longer text up to 6 s). The same save again within 2 s refreshes the one pop-up: its timer restarts,
the tick pulses once, and it is not read out again. A different save replaces it: one pop-up at a time.

**Failure.** A warning card in the same place: warning icon, "Not saved: <what>", "Lyre could not write it to your
computer. Try again; if it fails again, check that the drive has space.", **Try again** and a close button. It stays
until Try again works or it is dismissed; a later note shows under it. In the prototype: **Make the next save fail**
in the strip at the top, then change anything.

**Accessibility.** The pop-up is a status (role=status, polite, atomic) that is always in the page and empty when
nothing shows, so screen readers read it once when it fills. It is not read out when the same event was just
announced (Could 14) or on a refresh within 2 s. The failure is an alert. It never takes focus; Try again and the close
button are reachable with Tab (after the page), and focus goes back to where it was. Reduced motion: no slide, no
pulse. Contrast (`tools/r6-saved.js`, five themes): Saved 11.9 to 15.7:1; failure text 8.9 to 14.9:1; warning edge
5.9 to 10.4:1.

**For the lead: what changes in the app.**
- `src/lyre/shell/Announcer.tsx`: the toast moves from bottom centre to the place above (measure the work area and the
  Now playing bar, as the prototype's `L.placeToasts`); it stays mounted and empty instead of `hidden`; 3 s, up to 6 s for long
  text; `aria-live="off"` within 0.5 s of `say` and on a refresh. Add `saved(what, { key, detail })` with the 2 s merge
  by key, and `saveFailed(what, retry)` (role=alert, Try again, Dismiss, focus back). `toast` keeps its name for
  other notes.
- A field hook (`useSavedField`, or in the field components): Enter, leaving the field, or 1 s without typing. The
  Library's title saves 400 ms after typing today (ARCHITECTURE.md, `TrackDetails.tsx`): same rule, with the pop-up.
- Each screen's successful write calls `saved`; a refused or failed write (`isRefused`) calls `saveFailed` with the same
  write as retry.
- `UndoNote.tsx`: in the same corner, under the pop-up (part 6; Live has its own strips). A change that offers Undo
  shows no pop-up; "Undone" goes through `toast`, so it moves to the new place by itself.
- Remove from the screens: the Library details' Saved, the playlist boxes' Ready and Saved, the pad editor's Ready and
  Saved, the campaign Notes' Saved, the Audio profile's "Saved" line and its waveform box's Ready, the export box's and
  the import and Look in a folder boxes' Ready and Saved pills, Live's Scenes box "Ready" and "Scene n of m", the
  planner's "6 scenes", and the planner's sentence about Live's list order (its screen-reader copy too).

### Changes (prototype)

| # | Change |
| --- | --- |
| 1 | `core.js`: `L.saved`, `L.toast`, `L.saveFailed`, `L.failNextSave`, fields marked `data-save` save themselves; `L.placeToasts`; renames in place show the pop-up. `index.html`: `#lyre-toasts` with the status and the alert. `ui.css`: the look. |
| 1 | Every save in the prototype shows it: campaign, session and scene fields and notes; Obsidian fields; pickers (scene music, ambience, pad boards, on hand, Use in…, Add to playlists, a pad's sounds); planner drops; reorders (sessions, scenes, scene music and boards, on-hand playlists, a playlist's tracks in a place, a manual playlist); play order and Repeat one; Library details (title, notes, tags, energy, shape, role, loop advice, volume, playlists); playlist name, notes, rules, volume, add and remove; pad board name, pad label, sound, play mode, hotkey, colour, icon, volume, fade, layout; Audio profile; Rooms volume; Settings switches, sound mode, remote address and port, tokens, bot names, Ask again; library volume setting. |
| 2 | "Saved" left every box: Library details, playlist Details, pad editor, campaign Notes, Audio profile (`ap-saved` keeps only the read-only note), the export box. The export's "Saved X in Documents\Lyre" with Show in folder **stays in its box**: a result with an action outlives a 3 s pop-up, and it is that save's one message. |
| 3 | "Ready" left every box: All playlists, Tracks, Matching tracks, Add tracks, Rules, Used in, the pad editor with no pad, the waveform box (Paused still shows), the export, Open a file, Look in a folder, Live's Scenes before a scene runs. |
| 4 | Scene count gone: Live's "Scene n of m" (Now and Next say it) and the planner's "6 scenes" (Empty still shows when there are none). Kept, as they are not the same kind: Sessions "4 sessions", Campaign and Session playlists and pads counts, "12 pads", markers, "n found", "n of m bots in rooms" (each says whether a folded box holds anything worth opening, or is a result). |
| 5 | The planner's screen-reader sentence about Live's list order is deleted, and its copies in this file. |
| 6 | `L.quietStatus` and its comment, `CLEANUP.md` status words, the prototype's design notes (campaign, playlists, library, pad board) say the same. No help draft mentioned these words. |
| – | Also: Rooms' Test chime was a note and an announcement of the same event; now the note only (read once). |

### Numbers

`tools/r6-measure.js`, before and after (all 31 states, both sizes): words 13,478 → 13,450, hint lines 182 → 182,
facts shown twice 306 → 306, controls 5,570 → 5,570, badge kinds 240 → 230. Live with a scene playing: 217 → 213 words
(199 → 195 at 960). Open boxes already hid Ready and Saved since part 1, so the rest of the drop is on folded boxes
and in Live. The pop-up is outside the page's boxes and is not counted.

Checks: `tools/r6-saved.js` (new: one place at 1920 and 960 on Live and three Prep screens, text, merge read out once,
focus, failure stays, contrast in five themes) passes; screenshots `shots/r6/saved-*.png`. `tools/r5-check.js`,
`tools/check-contrast.js`, `tools/lv-keys.js` and the prototype spec project (`yarn heavy`) pass.

### Specs

New `round 6, part 5` blocks (each `expectFailureUntilBuilt("round 6")`): campaigns (the pop-up's words after a pause,
not per key, focus kept, no Saved in Notes; leaving a field saves; the same save within 2 s is one pop-up read out
once; the same place on a Prep screen and in Live; a failed save stays and Try again saves it, through
`target.failNextSave`), Live (no Ready or scene count, open or folded; Repeat one's pop-up under the top strip, clear
of On air), the session planner (no scene count, no sentence about Live, a scene's notes save with the pop-up),
playlists (no Ready or Saved in any box, open or folded; notes save with the pop-up). Changed: Live's "Scene 1 of 6"
checks find the running scene by its Restart button; the Audio profile's read-only note is found by its words (the
page now has the pop-up's status too).

### Try it

1. Campaigns › The Sunken Crown. Type in Notes and stop: "Saved: The Sunken Crown notes" shows at the top right for
   3 seconds. Type again within 2 seconds of it: the same pop-up, its tick pulses.
2. Press **Make the next save fail** in the strip at the top, type a letter in Notes and press Tab: "Not saved" stays
   with Try again. Press **Try again**.
3. Run next session › Start The abbey ruins. Point at the first track in Current scene and press Repeat one: the pop-up
   is in the same corner, under the top strip, nowhere near On air. Scenes has no "Scene 3 of 6" or "Ready".
4. Prep › Session 14: no "6 scenes" on Scenes. Open The abbey ruins; on its second music item press ⋯ › Move up:
   "Saved: order of The abbey ruins music".
5. Playlists › The Abbess: no box says Ready or Saved, open or folded.

## Part 6: Nik's 17:14 changes

> "Let's move the saved pop up to the bottom right hand corner, rather than the top right hand corner. Session
> playlists should start closed. Also, in Live, let's put the on air box at the top of the screen, across the whole
> screen, beneath the top bar with search in it. Let's let the Scenes and current scene boxes adjust their height
> dynamically based on their contents, as they used to.
> I'm missing the contextual back button in the top bar. It should be constantly present in the top left of the top
> bar. We should also have a sensible place for breadcrumbs.
> The search bar should be able to find a track or a playlist.
> I need a play now button on tracks and playlists in the live -> scenes pane for all of them, not just for the current
> scene.
> Why do I only have play in headphones for the single track great hall on the live Scenes pane, and not the play next
> and play? I need all of them."
>
> Nik, 6 Nov 2026, 17:14

### What changed, and why

| # | What | Why |
| --- | --- | --- |
| 1 | **Saved pop-up at the bottom right** of the work area, 12 px in and 12 px up, or 12 px above the Now playing bar when it shows; the failure card and the Undo note (Reset to whole track, Delete board, Tag…) stack in the same corner. The Part 5 standard above is updated. In Live (a scene playing, the trays folded) it lies over empty space at 1920, 1280 and 960: under the Whole campaign tray at 1920 and 1280, beside the trays under Current scene at 960. With the trays unfolded it lies over the lower edge of the last of them (Campaign pads), or at 960 over the bottom of a long Current scene. | Nik's words. On air is now at the top, so the bottom corner is the quiet one. |
| 2 | **Session playlists start folded**, like the other three tray boxes; once unfolded it stays so on this computer (also after leaving Live). | Nik's words. |
| 3 | **On air at the top, the whole width**, right under the top strip, on every size; under it Scenes and Current scene (and the trays), which scroll as one page. **Scenes and Current scene take the height of their contents** again (part 4's shared height and inner scroll undone for them). **The trays keep theirs** in three columns: their column stays in view while Scenes scrolls and its boxes share its height, so a box there never moves when a list above it grows (Should 7 still holds). On air is at most 40 % of the height (it scrolls inside beyond that); a room's Up next past four lines folds to one line, its first entry and "n more". With a scene playing On air is 187 px tall, so the start of Scenes and of Current scene is in view at 1280×800 and 960×1000 (both start 195 px under the strip). **Keys: On air is box 1** (Alt+1, then Alt+2 Scenes, Alt+3 Current scene, Alt+4 to 7 the trays as before), and F6 follows that order in every layout. Reflow at 320 px passes: Back, Prep \| Live and the buttons, then the trail and the session, then Find. | Nik's words; On air as box 1 because Alt and F6 now follow the screen from the top. |
| 4 | **Back, always, top left of every top bar** (every Prep screen's header and Live's strip), before anything else, at the same place on every screen (12 px from the left, 10 px from the top of the bar; checked on ten screens). With nowhere to go back to (opened from the menu or by address) it stays, greyed, `aria-disabled`, still reachable with Tab, its hover "Nothing to go back to: you opened this screen from the menu". Core puts it there (`withBack`); a view's own Back and the code that dropped a duplicate breadcrumb are gone. | Nik's words. Never moving or vanishing is what makes it findable without looking. |
| 5 | **The trail, one place:** right after Back in the same bar, each parent a link, and the screen's own title (its h1) as the last part, plain text: Campaigns › The Sunken Crown › *Session 14*; Pad boards › *Drowned Abbey*; Playlists › *The Abbess*; Library › *track › Audio profile*; Library › *Back up, move or share*; Live: The Sunken Crown › *Session 14* (the session button, which still chooses another session). Screens with no parent (Campaigns, Library, Playlists, Pad boards, Rooms, Settings, Look and feel) have none: Rooms and Settings are top-level and their sections are boxes on one page, so a trail there would point nowhere. A trail of three parents or more shows the first and the last with "…" between; under 640 px of app only the last parent after "…"; the whole path is the trail's hover text and what "…" stands for is read out. **Never twice:** Back says only "Back" when the trail already shows where it goes (its name and hover still say "Back to The Sunken Crown"); it says "Back to Live" when the trail does not (Rooms opened from Live). The title is the trail's last part, so it is not repeated in the trail either. Views give `crumbs(p)`; core draws it (`L.trailHTML`). | One place, one look; the h1 doubling as the last part costs no extra line or words. |
| 6 | **Find a track or playlist** (the field's name; it fits at 960 because, below 1100 px of app, Fade all and Stop all are icons, named on hover and read out; and the session button shows "Session 14" at every width, its name on hover and read out, so the trail reads Campaign › Session). Results: **Playlists** (by name or notes; with tags picked, those with a track that has them all; the Music, Ambience and FX filter applies), then **Tracks**, each under a small heading, each row with Preview, Play next, Add to queue and Play on air; a playlist unfolds to its tracks as in the playlist boxes. `/` focuses it, Esc clears, a second Esc closes. | Nik's words. |
| 7 | **An unfolded scene in Scenes has the full row buttons** on every track and playlist, as Current scene: Preview, Play next, Add to queue (Repeat one, a playlist's play order), Play on air, greyed at rest, same names and icons. **The ambience line too** (Great hall was an ambience, so it had only Preview), in Scenes and in Current scene. In a scene that is not running, **Play on air plays that item and does not start the scene**: a track plays now in the room (Current scene's To:), and the room's list carries on after it, as from Find; a playlist plays from its first track in the scene's order for it; an ambience becomes the room's ambience. Scenes still marks the running scene Now, Current scene does not change, and the row played is marked On air in the unfolded scene. On air shows that track (by the scene's name for it) in the room's Music, with Up next carrying on with the running scene's music; in Live the Now playing bar shows only a preview, so it does not change; on a Prep screen afterwards its row reads "Scene: Crypt ambush (Session 14)" as where the track came from. **Ambience Play next and Add to queue** put it in the room's "next ambience" list, shown at the bottom of Up next as "Ambience next: …" with ×; Next on the room's ambience plays it (an ambience loops until changed, so it cannot follow on by itself). Not saved; a new scene clears it like the rest (its Undo brings it back). Effects keep Preview and Play on air only. | Nik's words. Start stays the only thing that plays a scene. |

Also: names in Scenes and Current scene stay readable at 1280 and 960. While every tray box is folded, the trays'
column is only as wide as its folded headers (35 : 45 : 20, at least 236 px), so Scenes and Current scene get the room;
opening a tray box gives the columns part 4's widths back. A name keeps at least 14 characters' width (the row's
buttons go under it rather than squeeze it), wraps to two lines and then shows whole on hover (its title) and while its
row has keyboard focus (UX-6). Words do not rise (scene unfolded at 960: 226 → 222); the Live and sweep specs pass.
The help drafts say On air is at the top, Find a track or playlist, Alt+1 to Alt+7 from On air, Back, playing
from an unfolded scene, and Ambience next (`10-live.md`, `15-up-next.md`, `03-add-music.md`). The session button still
reads out the campaign's name, as it is read on its own when it has focus.

**For the lead (the contracts):** per room, `aq`: a list of `{ trackIds, playlistId | null, placeKey, name }` (the
ambience waiting); Next on the ambience takes its first. Back: always rendered, `aria-disabled` without a step. The
trail: each screen's parents, from its route.

### Numbers

`tools/r6-measure.js`, part 5 (before) and after; 1920×1080, words at 960×1000 in brackets.

| Screen and state | Words | Hint lines | Shown twice | Controls |
| --- | ---: | ---: | ---: | ---: |
| live | 84 → 82 (66 → 60) | 1 → 1 | 0 → 0 | 48 → 44 |
| live-playing | 213 → 211 (195 → 189) | 2 → 2 | 5 → 5 | 97 → 96 |
| live-aftermath | 169 → 167 (151 → 145) | 1 → 1 | 4 → 4 | 79 → 78 |
| live-scene-open (Crypt ambush unfolded) | 256 → 254 (232 → 226) | 3 → 3 | 7 → 7 | 116 → 122 |
| profile (Audio profile) | 242 → 226 (204 → 188) | 2 → 2 | 7 → 6 | 65 → 64 |

Live reads less in every state. Back and the trail add four words ("Back", "The Sunken Crown"); Session playlists folded
and the session's name moved to hover take more away. Controls rise only with a scene unfolded (+6: Play on air on each
row and the ambience's three buttons), as item 7 asks; elsewhere they fall (Session playlists folded). The Audio
profile no longer shows the track's name twice. All 31 states, both sizes: words 13,450 → 13,386, hint lines 182 → 182,
facts shown twice 306 → 299, controls 5,570 → 5,609 (Back on every screen: +1 each).

Checks: the prototype spec project (`yarn heavy`): 547 passed, 4 failed, and the 4 are not part 6's: the
`library-files` checks for the export's, the import's and the relink's result line as a status fail on the part 5 build
too, since commit 5fca9bc took `role="status"` off those lines (so each result is read out once); the lead should
decide whether the specs or the prototype gives way; `tools/r5-check.js` ("every screen passed"),
`tools/check-contrast.js` (five themes), `tools/lv-keys.js` (every check, 12 new for part 6), `tools/r6-saved.js` (now
also at 1280; the pop-up 12 px from the right and 12 px above the bottom on every screen, in Live over empty space at
1920, 1280 and 960). Screenshots: `shots/r6/live-part6-1920.png`, `-1280.png`, `-960.png` (The abbey ruins playing,
Crypt ambush unfolded) and `shots/r6/prep-part6-960.png` (Session 14 opened from the campaign page: Back, then
Campaigns › The Sunken Crown ›).

### Specs

New `round 6, part 6` blocks (each `expectFailureUntilBuilt("round 6")`), written first and run on the part 5
prototype: 22 of the 26 new or changed checks failed there; the four that passed were the two "start of Scenes and
Current scene in view" checks (true while On air was at the bottom too), "nothing scrolls inside Scenes and Current
scene" at 1920 (true when they were short enough), and Back to Live from Rooms (part 5's Back already said it). Live (`live.spec.ts`): On air at the top, the whole width;
in view at 1280×800 and 960×1000; no inner scroll; Session playlists folded and remembered; Up next folded past four
lines; Keys and Alt+1; Back first in the strip, disabled with its reason; the trail and Back after Run; Find with
Playlists then Tracks; the row buttons in an unfolded scene and on Great hall, and Play on air there not starting the
scene. Prep (`campaigns.spec.ts`): the pop-up above the Now playing bar; Back in the same place on ten screens; Back
disabled from the menu; the trail on six screens with the h1 last, and none on six; Back not repeating the trail; Back
to Live from Rooms; a long trail cut in the middle at 600 px. Changed: On air above Current scene (was below); the trays'
boxes all folded; Alt+3 and F6 to Session playlists; Should 7 unfolds Session playlists first; the pop-up at the
bottom right (Live and Prep); the rooms checks unfold Session playlists before its To:; "Found tracks" is "Tracks".

### Questions for Nik (round 6, part 6)

1. **Ambience Play next and Add to queue.** An ambience loops until it is changed, so what you add waits as "Ambience
   next" at the bottom of Up next and plays when you press Next on the room's ambience. *Recommend keeping it:* it gives
   the ambience the same buttons as everything else and nothing changes until you choose. The other choice is Preview
   and Play on air only on an ambience.
2. **Alt+1 is now On air** (it was Scenes): the keys follow the screen from the top, as F6 does. *Recommend keeping it.*
   The other choice is the old numbers (Scenes 1, Current scene 2, On air 3), which no longer match the order on screen.

### Try it

Open `design/prototype/lyre-prototype.html`.
1. Campaigns › The Sunken Crown › Session 14 (its name): the top bar reads ‹ Back, Campaigns › The Sunken Crown ›
   Session 14. Point at Back: "Back to The Sunken Crown".
2. Pad boards in the menu: Back is greyed; point at it ("Nothing to go back to…"). Open Drowned Abbey: Back, then
   Pad boards › Drowned Abbey.
3. Campaigns › The Sunken Crown › Run next session. On air is at the top; the trail reads The Sunken Crown › Session 14.
   Session playlists is folded.
4. Start The abbey ruins. On its first track in Current scene press Repeat one: "Saved: Repeat one in The abbey ruins"
   at the bottom right.
5. Click Crypt ambush in Scenes: every row, and its ambience, has Preview, Play next, Add to queue and Play on air.
   Press Play on air on its first track: On air plays it; Scenes still says Now: The abbey ruins.
6. Press Play next on Crypt ambush's ambience: Up next ends with it ("Ambience next"). Press Next on the ambience in On
   air: it plays.
7. Press Add to queue on three tracks of Current scene: Up next folds to one line with "n more"; press it.
8. Press /, type abbess: Playlists, then Tracks. Unfold The Abbess; press Esc twice.
