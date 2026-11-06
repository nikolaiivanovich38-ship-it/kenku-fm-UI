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
