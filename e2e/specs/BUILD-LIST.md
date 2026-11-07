# Build list: the round 6 and round 7 checks (0.5.0)

Generated from the `app` project run of 7 Nov 2026, 00:22 to 02:02 UTC (commit d83c904), on the packaged test build of b6 with w6-specs. Every check
listed here was marked `round 6` or `round 7` and failed in the app as expected.

Since step 0 of the shell stream (w6-shell), each check names the streams that must build it instead of its round:
`expectFailureUntilBuilt("shell")`, `("live")`, `("rooms-settings")` or `("prep")`, and both where it needs two (its
stream and the ones under "Also" below), such as `expectFailureUntilBuilt("shell", "prep")`; a sweep through its
screen's `streams` and, for UX-6, `UX6_NOT_MET_YET` (UX-6 is a kit behaviour: the shell plus the screen's stream). A
check is expected to fail until every stream it names is in `BUILT_STREAMS` (`support/built.ts`, a list of its own
because `live` is a screen too). A stream adds its name once all its checks pass. A check that passes before every
stream it names is built shows up as "expected to fail, but passed": it needed fewer streams than it names, so the
stream that sees it takes the other names off in the same commit (the table below says who was expected; the mark in
the spec file is what counts). Inside a marked block, `metByTheAppAlready()` (support/test.ts) still makes one check
required where the app meets it already.

File:line is in `e2e/specs`. Backlog: the item named in the check, else the design note it comes from (`R6 part N`
is `design/prototype/ROUND6.md`, `R6 review Must/Should/Could N` its part 4 table; the round 7 items are
`design/prototype/ROUND7.md`'s headings). "Also" names the other streams a check needs before it can pass.

| Stream | Checks | round 6 | round 7 | of them, need another stream too |
| --- | --- | --- | --- | --- |
| Shell | 39 | 28 | 11 | 32 |
| Live | 107 | 95 | 12 | 13 |
| Rooms and Settings | 39 | 28 | 11 | 8 |
| Prep screens | 66 | 16 | 50 | 4 |
| All | 251 | 167 | 84 | 57 |

A sweep with both marks (a round 6 screen's hover-text sweep) counts as round 7: it needs both.

## Shell (39)

top bar, Back and its history, breadcrumbs (the trail), the Saved pop-up, the Rooms name, Help, Ctrl+K (Find and play), Display (Look and feel).

| Check | Round | Backlog | Also | What it checks |
| --- | --- | --- | --- | --- |
| `campaigns.spec.ts:362` | 6 | UX-18 | Prep screens | round 6: Repeat on the Now playing bar, the campaign's own order, and Back: UX-18: a playlist opened from the campaign page has Back to the campaign, and Back returns to the same row |
| `campaigns.spec.ts:372` | 6 | UX-18 | Prep screens | round 6: Repeat on the Now playing bar, the campaign's own order, and Back: UX-18, round 6 part 7 (Nik, 22:04): a screen opened from the menu has Back to where Nik was |
| `campaigns.spec.ts:399` | 6 | UX-19 | Prep screens | round 6, part 5: the Saved pop-up: notes save after a pause in typing, never per key: Saved and what, while the cursor stays in the notes |
| `campaigns.spec.ts:409` | 6 | UX-19 | Prep screens | round 6, part 5: the Saved pop-up: leaving a field saves it at once; the same save again within 2 s refreshes the one pop-up, read out once |
| `campaigns.spec.ts:421` | 6 | UX-19 | Prep screens | round 6, part 5: the Saved pop-up: the pop-up is in the same place on a prep screen and in Live: bottom right of the work area (part 6) |
| `campaigns.spec.ts:435` | 6 | UX-19 | Prep screens | round 6, part 5: the Saved pop-up: a failed save stays until dismissed, says what to do, and Try again saves it |
| `campaigns.spec.ts:464` | 6 | UX-19 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: the Saved pop-up sits above the Now playing bar, at the bottom right of the work area |
| `campaigns.spec.ts:477` | 6 | UX-18 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: Back is top left on every screen, in the same place, before anything else in the bar |
| `campaigns.spec.ts:493` | 6 | UX-18 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: at the very start of the history Back stays where it is, greyed, saying why; after a move from the menu it goes back (part 7) |
| `campaigns.spec.ts:505` | 6 | UX-18 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: each screen with a parent has its trail right after Back: every part a link, the screen's title last |
| `campaigns.spec.ts:532` | 6 | UX-18 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: Back never repeats the trail: it is a ‹ in a box (part 7), its name and hover say where it goes |
| `campaigns.spec.ts:541` | 6 | UX-18 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: Back's name says where it goes: Rooms opened from Live has Back to Live (a ‹ with no words, part 7) |
| `campaigns.spec.ts:549` | 6 | UX-18 | Prep screens | round 6, part 6: the Saved pop-up at the bottom right, Back always top left, one place for the trail: a long trail is cut in the middle with … and the whole path on hover |
| `campaigns.spec.ts:571` | 6 | UX-18 | Prep screens | round 6, part 7: Back is one history across the whole app: five steps and more: Library, a track, its Audio profile, Pad boards (menu), a board, Live with a scene unfolded; Back walks back through each, as it was |
| `campaigns.spec.ts:605` | 6 | UX-18 | Prep screens | round 6, part 7: Back is one history across the whole app: Back is a ‹ in a box at least 24 px square, and Alt+Left does the same as Back |
| `campaigns.spec.ts:617` | 6 | UX-18 | Prep screens | round 6, part 7: Back is one history across the whole app: going back returns to the same scroll position and the control that was used to leave |
| `campaigns.spec.ts:652` | 7 | UX-12 | Prep screens | round 7: what played, and Find and play: Ctrl+K opens Find and play: type part of a name, Enter plays it on air, Esc closes and puts focus back |
| `campaigns.spec.ts:670` | 7 | UX-12 | Prep screens | round 7: what played, and Find and play: in Find and play, Alt+Enter previews, Shift+Enter adds to the queue, and a pad or a scene can be found too |
| `help.spec.ts:85` | 6 | FND-8, R6 review Should 12 | Live | FND-8 the Help entry: round 6: Play next, Add to queue and Repeat is a fifteenth article, under Run a session |
| `live.spec.ts:721` | 6 | UX-18 | Live | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: UX-18: Live opened from the session planner has Back to the session; Alt+Left goes there too |
| `live.spec.ts:920` | 6 | R6 review Should 12 | Live | round 6, part 4: the review's fixes in Live: Should 12: Help is at the foot of Live's Keys, and F1 opens it anywhere |
| `live.spec.ts:947` | 6 | R6 review Could 15 | Live | round 6, part 4: the review's fixes in Live: Could 15: Back from the planner opened in Current scene's ⋯ puts focus back on that ⋯ |
| `live.spec.ts:978` | 6 | UX-19 | Live | round 6, part 5: Live's Scenes box and the Saved pop-up: Repeat one saved with a scene shows the Saved pop-up (part 6: at the bottom right), clear of On air |
| `live.spec.ts:1088` | 6 | UX-18 | Live | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: Back is the first thing in Live's top strip; as the first screen it is there, greyed, saying why (part 7) |
| `live.spec.ts:1100` | 6 | UX-18 | Live | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: the trail in Live is Campaign › Session; Back after Run does not repeat the campaign the trail shows |
| `live.spec.ts:1275` | 7 | UX-12 | Live | round 7, part 2: Live: Ctrl+K opens Find and play in Live too |
| `live.spec.ts:1287` | 7 | UX-11 | Live | round 7, part 2: Live: with Comfortable and 200 % text, Live still fits: nothing scrolls sideways and On air is in view |
| `look.spec.ts:38` | 7 | UX-11 |  | round 7: display options: Compact is the default; Comfortable makes every control taller |
| `look.spec.ts:49` | 7 | UX-11 |  | round 7: display options: Text size goes from 100 to 200 %, and at 200 % nothing scrolls sideways |
| `look.spec.ts:62` | 7 | UX-11 |  | round 7: display options: High contrast makes quiet text as strong as the rest (7:1 or more) |
| `look.spec.ts:69` | 7 | UX-11, DAT-10 |  | round 7: display options: tag colours are edited with the tags, and always come with the tag's name |
| `look.spec.ts:79` | 7 | A11Y-6 |  | round 7: motion and target size: with reduced motion asked for, nothing slides or pulses |
| `outputs.spec.ts:200` | 6 | OUT-8, UX-18 | Rooms and Settings | round 6: Add bot and Kick in the voice channels: OUT-8, UX-18: Tokens and new bots opens Settings, and Back returns to Outputs |
| `outputs.spec.ts:212` | 6 | UX-18 | Rooms and Settings | round 6, part 4: the screen is Rooms: the menu, the screen's title and Back say Rooms |
| `playlists.spec.ts:329` | 6 | UX-19 | Prep screens | round 6: quiet statuses: no box says Ready or Saved, open or folded |
| `playlists.spec.ts:339` | 6 | UX-19 | Prep screens | round 6: quiet statuses: a playlist's notes save after a pause in typing, with the Saved pop-up |
| `session-planner.spec.ts:549` | 6 | UX-19 | Prep screens | round 6, part 5: no scene count, no sentence about Live, and the Saved pop-up: a scene's notes save after a pause in typing, with the Saved pop-up |

Sweeps (`sweeps.spec.ts`, 2 checks; one line per screen and kind, sizes and themes together):

| Screen | Sweep | Lines | Checks | Round | Backlog |
| --- | --- | --- | --- | --- | --- |
| Look and feel | hover text (UX-6) | 439 | 2 | 7 | UX-6 |

## Live (107)

round 6 part 3's Live (seven boxes, one On air box with a part per room, Find a track, Current scene), Play next and Add to queue, Repeat per room, round 7 part 2.

| Check | Round | Backlog | Also | What it checks |
| --- | --- | --- | --- | --- |
| `live.spec.ts:51` | 6 | R6 part 3 (Live boxes) |  | scenes and undo: Space starts the next scene and the Next scene button keeps focus |
| `live.spec.ts:99` | 6 | R6 part 3 (Live boxes) |  | scenes and undo: Esc on its own does not fade anything, Shift+Esc fades everything out |
| `live.spec.ts:126` | 6 | R6 part 3 (Live boxes) |  | scenes and undo: opened from another page, Live waits on standby with nothing playing |
| `live.spec.ts:146` | 6 | R6 part 3 (Live boxes) |  | single-key shortcuts: with single-key shortcuts off, Space, / and pad keys do nothing |
| `live.spec.ts:162` | 6 | R6 part 3 (Live boxes) |  | single-key shortcuts: / jumps to Find a track (round 6: was Off script), typing finds tracks, and Esc in the box clears it |
| `live.spec.ts:175` | 6 | R6 part 3 (Live boxes) |  | single-key shortcuts: a pad key is ignored while typing in a box |
| `live.spec.ts:188` | 6 | R6 part 3 (Live boxes) |  | single-key shortcuts: a pad key starts that pad's sound |
| `live.spec.ts:226` | 6 | R6 part 3 (Live boxes) |  | BUG-20: stopping pads: a pad that plays says so, and pressing it again stops it, whatever its play mode |
| `live.spec.ts:241` | 6 | R6 part 3 (Live boxes) |  | BUG-20: stopping pads: Stop pads beside the scene's pads stops every pad and leaves the music and ambience playing |
| `live.spec.ts:265` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: a hold pad plays while its key is down and stops when it comes up |
| `live.spec.ts:277` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: On air sits above Current scene (round 6 part 6: at the top; before: Scene music above On air) |
| `live.spec.ts:285` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: Play next (round 6: Add to queue) queues a track and Next music then plays it |
| `live.spec.ts:306` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: Next follows the scene's order into the playlist after the track, and up next is never the track already playing |
| `live.spec.ts:321` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: a row shows the length that will play with the scene's own end point, with the end rule as a tooltip |
| `live.spec.ts:329` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: a track's title opens its details with a link to the Audio profile for this scene, and does not play it |
| `live.spec.ts:340` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: row actions read Preview, Play next, Add to queue (round 6), Play on air, in that order |
| `live.spec.ts:358` | 6 | R6 part 3 (Live boxes) |  | choosing what plays: the scene's pads (round 6: in Current scene) offer the scene's boards as a switch |
| `live.spec.ts:368` | 6 | R6 part 3 (Live boxes) |  | Off script search (round 6: Find a track): a tag you pick can be cleared with the X next to the tag list |
| `live.spec.ts:380` | 6 | R6 part 3 (Live boxes) |  | Off script search (round 6: Find a track): the Music, Ambience and FX filter narrows the results, and playing an effect layers it over the music |
| `live.spec.ts:397` | 6 | R6 part 3 (Live boxes) |  | rooms: with no room joined On air (before: the top strip) warns that players hear nothing and offers Join Table |
| `live.spec.ts:407` | 6 | BUG-19 (R6 part 3) |  | rooms: BUG-19: with no room joined, what plays says nobody hears it, in its On air box and in the Now playing bar |
| `live.spec.ts:424` | 6 | R6 part 3 (Live boxes) |  | rooms: a room's box has Mute, shown as the one status Muted, and a volume slider that works from the keyboard |
| `live.spec.ts:439` | 6 | R6 part 3 (Live boxes) |  | rooms: Add a room: a second On air box for it appears, saying Silent |
| `live.spec.ts:447` | 6 | R6 part 3 (Live boxes) |  | rooms: with two rooms, each box that plays gets a To: Table choice (round 6: Current scene, Session playlists, Find a track) |
| `live.spec.ts:458` | 6 | R6 part 3 (Live boxes) |  | rooms: a room that joins from Discord gets its box too |
| `live.spec.ts:465` | 6 | R6 part 3 (Live boxes) |  | rooms: choosing To: Side room sends Play on air from a box (round 6: Session playlists) only to that room, and the row buttons say so |
| `live.spec.ts:478` | 6 | R6 part 3 (Live boxes) |  | rooms: Off script can send a track to a chosen room too |
| `live.spec.ts:491` | 6 | R6 part 3 (Live boxes) |  | rooms: a pad key plays in the room chosen for the scene's pads (round 6: in Current scene) |
| `live.spec.ts:505` | 6 | R6 part 3 (Live boxes) |  | rooms: Next scene always starts in the first room, whatever the Scene music box points to |
| `live.spec.ts:516` | 6 | OUT-7 | Rooms and Settings | rooms: a room's menu offers to copy what another room is playing |
| `live.spec.ts:526` | 6 | OUT-7 | Rooms and Settings | rooms: Leave (round 6: Kick) takes the room's box and the To: choices away again |
| `live.spec.ts:538` | 6 | UX-16 |  | round 5: the Now playing bar, names in scenes, play order and single tracks in Live: UX-16: in Live the room boxes show what each room hears, so the Now playing bar shows only a preview, tagged Only you |
| `live.spec.ts:552` | 6 | UX-16 |  | round 5: the Now playing bar, names in scenes, play order and single tracks in Live: UX-16: with two rooms playing, the Now playing bar on a prep screen has a row for each, tagged with the room's name |
| `live.spec.ts:568` | 6 | DAT-14 |  | round 5: the Now playing bar, names in scenes, play order and single tracks in Live: DAT-14: a scene's name for a track shows in its list, its On air box and the bar, with its own name on hover |
| `live.spec.ts:586` | 6 | ORG-12 |  | round 5: the Now playing bar, names in scenes, play order and single tracks in Live: ORG-12: the campaign's single tracks are in its list (round 6: Campaign playlists), ready to play on air |
| `live.spec.ts:601` | 6 | SHW-7 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: SHW-7: clicking a scene's name unfolds its music in play order, ambience and pad boards, and changes nothing on air |
| `live.spec.ts:618` | 6 | SHW-7 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: SHW-7: Right unfolds a scene from the keyboard and Left folds it |
| `live.spec.ts:629` | 6 | SHW-7 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: SHW-7: the music box is Current scene (round 6 part 3); before a scene starts it shows no scene |
| `live.spec.ts:639` | 6 | PLY-16 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: PLY-16: Add to queue on a track puts it at the bottom of the room's Up next, where × takes it out |
| `live.spec.ts:652` | 6 | PLY-16 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: PLY-16: Add to queue on a playlist queues all of it, and Undo (or Ctrl+Z) takes it back |
| `live.spec.ts:665` | 6 | PLY-16 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: PLY-16: a track in an unfolded scene can be added to the queue before that scene starts |
| `live.spec.ts:674` | 6 | PLY-17 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: PLY-17: the room's music has Repeat, pressed while on, going off, all, one |
| `live.spec.ts:691` | 6 | PLY-17 |  | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: PLY-17: each track of Current scene music has Repeat one, pressed while on |
| `live.spec.ts:701` | 6 | OUT-7 | Rooms and Settings | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: OUT-7: each room box shows its bot; the bot button changes the channel on the page |
| `live.spec.ts:711` | 6 | OUT-7 | Rooms and Settings | round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot: OUT-7: Kick takes the bot out at once; if the players were hearing it, Undo puts it back |
| `live.spec.ts:736` | 6 | R6 part 3 (Live boxes) |  | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: Live has seven boxes, each a region with a heading of its own name |
| `live.spec.ts:746` | 6 | R6 part 3 (Live boxes) |  | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: the session's and the campaign's boxes start folded (part 6: Session playlists too); the scene's pads are open |
| `live.spec.ts:756` | 6 | R6 part 3 (Live boxes) |  | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: Alt+3 goes to Current scene (part 6: On air is box 1) and F6 to the next box, Session playlists |
| `live.spec.ts:767` | 6 | PLY-16 |  | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: Play next goes right after the current track, Add to queue to the bottom of Up next |
| `live.spec.ts:779` | 6 | PLY-17 |  | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: Repeat in On air is for what plays now: after the music stops it is off again |
| `live.spec.ts:790` | 6 | PLY-17 | Prep screens | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: Repeat one on a scene's track is saved with the scene and shows on that track in the planner |
| `live.spec.ts:801` | 6 | R6 part 3 (Live boxes) |  | round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved: Find a track opens its results under the field; Esc closes them and the boxes stay where they were |
| `live.spec.ts:821` | 6 | R6 review Must 1 |  | round 6, part 4: the review's fixes in Live: Must 1: Ctrl+Z takes back only the last action: after a pause it leaves the scene change alone |
| `live.spec.ts:831` | 6 | R6 review Must 2 | Rooms and Settings | round 6, part 4: the review's fixes in Live: Must 2: a bot moved to a channel with nobody in it says Nobody there, offers Move to Table, and has Undo |
| `live.spec.ts:845` | 6 | R6 review Must 4 |  | round 6, part 4: the review's fixes in Live: Must 4: at 320 px Live does not scroll sideways and Find a track, Fade all, Stop all and Keys are on screen |
| `live.spec.ts:854` | 6 | R6 review Must 4 |  | round 6, part 4: the review's fixes in Live: Must 4: in a window 400 px high each room is one line, and opens to show everything |
| `live.spec.ts:865` | 6 | R6 review Should 6 |  | round 6, part 4: the review's fixes in Live: Should 6: the session's and the campaign's boxes sit under This session and Whole campaign |
| `live.spec.ts:876` | 6 | R6 review Should 7 |  | round 6, part 4: the review's fixes in Live: Should 7, replaced by Nik's 21:59 (part 7): when a list in a tray grows, the box under it moves down and the page grows |
| `live.spec.ts:885` | 6 | R6 review Should 8 |  | round 6, part 4: the review's fixes in Live: Should 8 (Nik, 6 Nov 13:55): Preview, Play next and Add to queue show on every row at rest |
| `live.spec.ts:894` | 6 | R6 review Should 9 | Rooms and Settings | round 6, part 4: the review's fixes in Live: Should 9: Kick shows its word from 1280 px |
| `live.spec.ts:900` | 6 | R6 review Should 10 |  | round 6, part 4: the review's fixes in Live: Should 10: with no bot in a voice channel, the row on air says On air · no room |
| `live.spec.ts:928` | 6 | R6 |  | round 6, part 4: the review's fixes in Live: Nik, 6 Nov 13:55: a new scene clears what was added; its Undo brings it back |
| `live.spec.ts:940` | 6 | PLY-16 |  | round 6, part 4: the review's fixes in Live: Play next of the track the scene plays next lists it once in Up next |
| `live.spec.ts:956` | 6 | R6 review Could 21 |  | round 6, part 4: the review's fixes in Live: Could 21: the next scene's cue reads Starts when: and its words |
| `live.spec.ts:968` | 6 | UX-19 (R6 part 5) |  | round 6, part 5: Live's Scenes box and the Saved pop-up: the Scenes box says neither Ready nor a scene count, before or after a scene starts, open or folded |
| `live.spec.ts:1012` | 6 | R6 part 3 (Live boxes) |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: On air is at the top, the whole width, right under the top strip; Scenes and Current scene come under it |
| `live.spec.ts:1035` | 6 | R6 part 3 (Live boxes) |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: Scenes and Current scene take the height of their contents: nothing scrolls inside them |
| `live.spec.ts:1045` | 6 | R6 part 3 (Live boxes) |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: the trays grow with their contents: every box in This session and Whole campaign opened, nothing scrolls inside them, the page scrolls (Nik, 21:59) |
| `live.spec.ts:1057` | 6 | R6 part 3 (Live boxes) |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: Session playlists start folded, and stay open once unfolded, also after leaving Live |
| `live.spec.ts:1068` | 6 | PLY-16 |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: a long Up next (over four lines) folds to one line with how many more, and unfolds |
| `live.spec.ts:1082` | 6 | R6 part 3 (Live boxes) |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: Keys lists the boxes in their new order: Alt+1 is On air, then Scenes and Current scene |
| `live.spec.ts:1112` | 6 | ORG-14 |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: Find finds playlists and tracks: Playlists first, each with the row's buttons; a playlist unfolds to its tracks |
| `live.spec.ts:1131` | 6 | SHW-7 |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: an unfolded scene's tracks and playlists have Preview, Play next, Add to queue and Play on air, as Current scene |
| `live.spec.ts:1142` | 6 | SHW-7 |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: Play on air in a scene that is not running plays that track in the room and does not start the scene |
| `live.spec.ts:1152` | 6 | SHW-7 |  | round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes: the ambience of an unfolded scene (Great hall) has the same buttons, and Play on air changes the room's ambience |
| `live.spec.ts:1178` | 7 | PLY-1 |  | round 7, part 2: Live: What played opens in the room itself, newest first, with Play again and Play next; nothing covers On air |
| `live.spec.ts:1193` | 7 | PLY-8 | Prep screens | round 7, part 2: Live: a scene that moves on by itself says so in Scenes, and its own steps run when it starts |
| `live.spec.ts:1207` | 7 | PLY-8 | Prep screens | round 7, part 2: Live: a play step set to Play next from a marker waits in Up next, and starts at the marker |
| `live.spec.ts:1224` | 7 | PLY-8 | Prep screens | round 7, part 2: Live: a pad's own steps run when it is pressed in Live |
| `live.spec.ts:1237` | 7 | ORG-4 | Prep screens | round 7, part 2: Live: a board's dividers show above their row of pads in Live |
| `live.spec.ts:1249` | 7 | UX-12 | Rooms and Settings | round 7, part 2: Live: Live's keys follow Settings › Keyboard shortcuts |
| `live.spec.ts:1264` | 7 | UX-12 |  | round 7, part 2: Live: a second Next scene within a second is ignored, so a double press never skips a scene |
| `live.spec.ts:1281` | 7 | PLY-4, DAT-3 | Prep screens | round 7, part 2: Live: each room's progress line shows the track's markers |

Sweeps (`sweeps.spec.ts`, 24 checks; one line per screen and kind, sizes and themes together):

| Screen | Sweep | Lines | Checks | Round | Backlog |
| --- | --- | --- | --- | --- | --- |
| Live with a scene unfolded | Tab | 278 | 1 | 6 | SHW-7 |
| Live with a scene unfolded | hover text (UX-6) | 439 | 2 | 6+7 | UX-6 |
| Live with a scene unfolded | layout and axe | 246 | 7 | 6 | SHW-7 |
| Live with a scene unfolded | resize | 358 | 1 | 6 | SHW-7 |
| Live with a scene unfolded | short window | 398 | 1 | 6 | SHW-7 |
| Live with a second room and the pads open | Tab | 278 | 1 | 6 | R6 part 3 (Live boxes) |
| Live with a second room and the pads open | hover text (UX-6) | 439 | 2 | 6+7 | UX-6 |
| Live with a second room and the pads open | layout and axe | 246 | 7 | 6 | R6 part 3 (Live boxes) |
| Live with a second room and the pads open | resize | 358 | 1 | 6 | R6 part 3 (Live boxes) |
| Live with a second room and the pads open | short window | 398 | 1 | 6 | R6 part 3 (Live boxes) |

## Rooms and Settings (39)

Rooms (Add bot, Kick), Settings in Lyre (bots, tokens, Add a bot), remote control code, headphones and speakers, keyboard shortcuts.

| Check | Round | Backlog | Also | What it checks |
| --- | --- | --- | --- | --- |
| `outputs.spec.ts:81` | 6 | OUT-7 |  | moving a bot between rooms: Bring… (round 6: Add bot) on a voice channel in the list brings a bot there |
| `outputs.spec.ts:137` | 6 | R6 part 3 (Live boxes) | Live | outputs and the live game: the Prep \| Live switch is here too, with Prep pressed |
| `outputs.spec.ts:146` | 6 | R6 part 3 (Live boxes) | Live | outputs and the live game: a room that a bot is moved to on the Outputs screen also gets its On air box in Live |
| `outputs.spec.ts:161` | 6 | OUT-7 |  | round 6: Add bot and Kick in the voice channels: OUT-7: no Bring…; each bot in a channel has its own Kick, and a channel with no bot has Add bot |
| `outputs.spec.ts:169` | 6 | OUT-7 |  | round 6: Add bot and Kick in the voice channels: OUT-7: with one free bot, Add bot puts it in the channel in one click; Kick takes it out in one |
| `outputs.spec.ts:179` | 6 | OUT-7 |  | round 6: Add bot and Kick in the voice channels: OUT-7: with two free bots, Add bot offers a short choice of them |
| `outputs.spec.ts:189` | 6 | OUT-7 |  | round 6: Add bot and Kick in the voice channels: OUT-7: kicking a bot the players are hearing asks nothing, and Undo puts it back with its music |
| `settings.spec.ts:18` | 6 | OUT-8, UX-18 | Shell | Settings: is in the menu, has Back to where Nik was (round 6 part 7), and lists each bot with its status, servers and a masked token |
| `settings.spec.ts:31` | 6 | OUT-8 |  | Settings: Disconnect and Connect a bot |
| `settings.spec.ts:40` | 6 | OUT-8 |  | Settings: Replace… takes a new token and shows only its last four characters |
| `settings.spec.ts:50` | 6 | OUT-8 |  | Settings: Remove is behind the bot's ⋯ menu, with an Undo |
| `settings.spec.ts:59` | 6 | OUT-8 |  | Settings: the other settings Lyre still needs are here; the rare ones are folded |
| `settings.spec.ts:77` | 6 | OUT-8 |  | Add a bot, in the order Discord needs: three steps: create it, invite it first, then connect it with its token |
| `settings.spec.ts:90` | 6 | OUT-8 |  | Add a bot, in the order Discord needs: the Application ID makes the invite with View Channels, Connect and Speak |
| `settings.spec.ts:101` | 6 | OUT-8 |  | Add a bot, in the order Discord needs: the invite can be made by hand: OAuth2 › URL Generator, scope bot, the three permissions, Generated URL |
| `settings.spec.ts:115` | 6 | OUT-8 |  | Add a bot, in the order Discord needs: the last step takes the token from Bot › Reset Token, connects, and says which servers the bot is in |
| `settings.spec.ts:130` | 6 | OUT-8 |  | Add a bot, in the order Discord needs: a bot connected before it was invited says it is in no server yet, with the invite again |
| `settings.spec.ts:148` | 6 | OUT-8 |  | round 6, part 4: Add a bot in the order it is done: step 2 says where the Application ID is before its field; step 3 says Discord shows the token once |
| `settings.spec.ts:173` | 7 | SEC-4 |  | round 7: remote control needs a secret code: is off by default; on, it shows the code to type on the other device and listens on this computer only |
| `settings.spec.ts:185` | 7 | SEC-4 |  | round 7: remote control needs a secret code: Make a new code replaces the code, so the old one stops working |
| `settings.spec.ts:196` | 7 | SEC-4 |  | round 7: remote control needs a secret code: it can listen on the home network instead, for a phone or tablet |
| `settings.spec.ts:209` | 7 | PRV-2 | Live | round 7: headphones and speakers: the preview and what you hear of On air each have their own device, remembered |
| `settings.spec.ts:217` | 7 | PRV-2 | Live | round 7: headphones and speakers: one headset can be split: the preview in one ear, On air in the other |
| `settings.spec.ts:231` | 7 | PLY-8 | Live | round 7: crossfade and keyboard shortcuts: the crossfade between tracks has a default, in Sound to Discord |
| `settings.spec.ts:240` | 7 | UX-12 | Live | round 7: crossfade and keyboard shortcuts: every shortcut is listed with its key; one can be changed by pressing the new key, and reset |
| `settings.spec.ts:257` | 7 | UX-12 |  | round 7: crossfade and keyboard shortcuts: a key already in use is refused, and Esc keeps the old key |
| `settings.spec.ts:268` | 7 | UX-12 | Live | round 7: crossfade and keyboard shortcuts: a printable sheet lists every key |

Sweeps (`sweeps.spec.ts`, 12 checks; one line per screen and kind, sizes and themes together):

| Screen | Sweep | Lines | Checks | Round | Backlog |
| --- | --- | --- | --- | --- | --- |
| Settings | Tab | 278 | 1 | 6 | OUT-8 |
| Settings | hover text (UX-6) | 439 | 2 | 6+7 | UX-6 |
| Settings | layout and axe | 246 | 7 | 6 | OUT-8 |
| Settings | resize | 358 | 1 | 6 | OUT-8 |
| Settings | short window | 398 | 1 | 6 | OUT-8 |

## Prep screens (66)

Library, Tags, Playlists, folders and dividers, drag between lists, Pad boards, Campaigns, Session planner, Audio profile, steps, track roles, markers.

| Check | Round | Backlog | Also | What it checks |
| --- | --- | --- | --- | --- |
| `audio-profile.spec.ts:123` | 6 | R6 part 1 (less text) |  | fades: a looping track also has a loop crossfade that smooths the jump back |
| `audio-profile.spec.ts:298` | 7 | PLY-4, DAT-3 |  | round 7: mix out and playing from a marker: one marker can be the mix-out point; choosing another moves it |
| `audio-profile.spec.ts:309` | 7 | PLY-4, DAT-3 |  | round 7: mix out and playing from a marker: Play on air from a marker starts the track there |
| `campaigns.spec.ts:310` | 6 | PLY-17 | Live | round 6: Repeat on the Now playing bar, the campaign's own order, and Back: PLY-17: a Now playing row has Shuffle and Repeat; Repeat goes off, all, one for what plays now, not saved (round 6 part 3) |
| `campaigns.spec.ts:326` | 6 | ORG-13 |  | round 6: Repeat on the Now playing bar, the campaign's own order, and Back: ORG-13: a campaign playlist's tracks can be put in another order for this campaign only, and back |
| `campaigns.spec.ts:340` | 6 | ORG-13 |  | round 6: Repeat on the Now playing bar, the campaign's own order, and Back: ORG-13: Back to the playlist's order undoes the campaign's own order |
| `campaigns.spec.ts:353` | 6 | ORG-13 |  | round 6: Repeat on the Now playing bar, the campaign's own order, and Back: ORG-13: the campaign's playlists themselves can be moved into another order |
| `campaigns.spec.ts:637` | 7 | PLY-1 | Live | round 7: what played, and Find and play: What played lists the room's tracks, newest first, each with Play again and Play next |
| `library.spec.ts:335` | 6 | R6 part 1 (less text) |  | round 6: the key legend: the keys show under the list while the keyboard is in it, and are read out with the list |
| `library.spec.ts:404` | 7 | PLY-4, SHW-3 |  | round 7: how a track behaves: a sting never loops: its loop choices are off, and say why |
| `library.spec.ts:413` | 7 | PLY-4, SHW-3 |  | round 7: how a track behaves: Follow with… hands over to a playlist or track when it ends |
| `library.spec.ts:423` | 7 | PLY-4, SHW-3 |  | round 7: how a track behaves: Ending: Fades out, and Pick up where it stopped, are saved with the track |
| `library.spec.ts:437` | 7 | ORG-5 |  | round 7: dragging selected tracks to another list: two ticked tracks dragged onto a playlist are both added |
| `pad-boards.spec.ts:129` | 6 | R6 part 1 (less text) |  | resizing a board: spare pads: the editor says why spare pads exist |
| `pad-boards.spec.ts:322` | 6 | R6 review Must 5 |  | round 6, part 4: the review's fixes on a pad board: Must 5 (WCAG 2.5.3): an empty slot shows Add pad and is named Add pad: row, column |
| `pad-boards.spec.ts:335` | 7 | ORG-4 |  | round 7: folders and dividers: boards go into folders with Move to folder… (New folder… makes one) |
| `pad-boards.spec.ts:350` | 7 | ORG-4 |  | round 7: folders and dividers: a divider names a row of pads |
| `pad-boards.spec.ts:364` | 7 | PLY-8 |  | round 7: what a pad does: a pad plays its sound; its ⋯ › What it does… adds steps such as turning the music down first |
| `playlists.spec.ts:381` | 7 | ORG-4 |  | round 7: folders: Move to folder… › New folder… makes a folder with the playlist in it; folding the folder hides it |
| `playlists.spec.ts:390` | 7 | ORG-4 |  | round 7: folders: folders nest, a playlist moves between them, and deleting a folder keeps its playlists (they move up a level) |
| `playlists.spec.ts:408` | 7 | ORG-5 |  | round 7: folders: a playlist can be dragged onto a folder |
| `playlists.spec.ts:419` | 7 | ORG-4 |  | round 7: dividers inside a playlist: a divider goes above a track, names a section, and is not a track |
| `playlists.spec.ts:450` | 7 | ORG-5 |  | round 7: adding to other lists: dragging a track shows where it can go; dropping it on another playlist copies it there |
| `playlists.spec.ts:460` | 7 | ORG-5 |  | round 7: adding to other lists: with Shift held the track moves: it leaves this playlist |
| `playlists.spec.ts:468` | 7 | ORG-5 |  | round 7: adding to other lists: Esc while dragging puts everything back |
| `playlists.spec.ts:481` | 7 | ORG-5 | Live | round 7: adding to other lists: Add to… does the same from the keyboard: a playlist, a scene or Up next |
| `session-planner.spec.ts:411` | 6 | ORG-11 |  | round 5: play order, single tracks, tags, names in scenes and audio settings from the scene: ORG-11: tracks in a scene's music show their tags, and so does the music picker |
| `session-planner.spec.ts:476` | 6 | R6 part 1 (less text) |  | round 6: fewer sentences in the planner: the music picker's how-to is read out with the dialog, not shown above the list |
| `session-planner.spec.ts:484` | 6 | R6 part 1 (less text) |  | round 6: fewer sentences in the planner: the session's playlists say they are for every scene to a screen reader, not on screen |
| `session-planner.spec.ts:496` | 6 | R6 review Must 3 |  | round 6, part 4: the review's fixes in the planner: Must 3 (WCAG 2.5.7; Nik, 6 Nov 13:51): Reorder shows Move up and Move down on a scene's playlist, for this scene only |
| `session-planner.spec.ts:515` | 6 | R6 review Should 13 |  | round 6, part 4: the review's fixes in the planner: Should 13: the session's boards are Session pads, as in Live |
| `session-planner.spec.ts:520` | 6 | R6 review Could 19 |  | round 6, part 4: the review's fixes in the planner: Could 19: two new scenes have names of their own, and so have their buttons |
| `session-planner.spec.ts:537` | 6 | UX-19 (R6 part 5) |  | round 6, part 5: no scene count, no sentence about Live, and the Saved pop-up: the Scenes box has no scene count, open or folded |
| `session-planner.spec.ts:544` | 6 | R6 part 1 (less text) |  | round 6, part 5: no scene count, no sentence about Live, and the Saved pop-up: the sentence about the order of Live's lists is gone, for screen readers too |
| `session-planner.spec.ts:566` | 7 | PLY-8 |  | round 7: what a scene does when it starts: the usual start is three steps: its music, its ambience and its first pad board |
| `session-planner.spec.ts:578` | 7 | PLY-8 |  | round 7: what a scene does when it starts: a step can be added, changed and moved; a play step has its transition and what it does to Up next |
| `session-planner.spec.ts:594` | 7 | PLY-8 |  | round 7: what a scene does when it starts: Then: the scene can move on by itself when its music ends, and is marked |
| `session-planner.spec.ts:603` | 7 | PLY-8 |  | round 7: what a scene does when it starts: Try in headphones plays the first step's music as a preview |
| `tags.spec.ts:33` | 7 | DAT-10 | Shell | the Tags screen: opens from the Library's ⋯ menu, with Back to the Library, and shows each group as its own box in order |
| `tags.spec.ts:44` | 7 | DAT-10 |  | the Tags screen: a tag inside another is shown under it, and other words for a tag are on hover and read out |
| `tags.spec.ts:50` | 7 | DAT-10 |  | the Tags screen: Rename changes the tag on every track, in one step that Undo takes back |
| `tags.spec.ts:62` | 7 | DAT-10 |  | the Tags screen: the renamed tag is what the Library shows on its tracks and in its filters |
| `tags.spec.ts:75` | 7 | DAT-10 |  | the Tags screen: Merge into… moves every track to the other tag, and the old name keeps finding it |
| `tags.spec.ts:85` | 7 | DAT-10 |  | the Tags screen: Delete… takes a tag off its tracks, with Undo |
| `tags.spec.ts:95` | 7 | DAT-10 |  | the Tags screen: a new group with its own tag appears on every track's details and in the Library filters |
| `tags.spec.ts:108` | 7 | DAT-10 |  | the Tags screen: groups can be put in another order, and the track details follow it |
| `tags.spec.ts:116` | 7 | DAT-10 |  | the Tags screen: a group's colour is chosen by name; the tag's name always shows with it |
| `tags.spec.ts:128` | 7 | DAT-10 |  | tags where you use them: typing another word for a tag offers the tag itself |
| `tags.spec.ts:134` | 7 | DAT-10 |  | tags where you use them: filtering by a tag that holds others finds the tracks of the tags inside it |

Sweeps (`sweeps.spec.ts`, 17 checks; one line per screen and kind, sizes and themes together):

| Screen | Sweep | Lines | Checks | Round | Backlog |
| --- | --- | --- | --- | --- | --- |
| A dynamic playlist | hover text (UX-6) | 439 | 1 | 7 | UX-6 |
| Library | focus shows the full text (UX-6) | 472 | 1 | 7 | UX-6 |
| Library | hover text (UX-6) | 439 | 1 | 7 | UX-6 |
| Library with a track open | hover text (UX-6) | 439 | 2 | 7 | UX-6 |
| Tags | Tab | 278 | 1 | 7 | DAT-10 |
| Tags | hover text (UX-6) | 439 | 2 | 7 | UX-6 |
| Tags | layout and axe | 246 | 7 | 7 | DAT-10 |
| Tags | resize | 358 | 1 | 7 | DAT-10 |
| Tags | short window | 398 | 1 | 7 | DAT-10 |

## Checks two streams both need (57)

| Streams | Checks | Which |
| --- | --- | --- |
| Shell + Prep screens | 22 | campaigns:362, campaigns:372, campaigns:399, campaigns:409, campaigns:421, campaigns:435, campaigns:464, campaigns:477, campaigns:493, campaigns:505, campaigns:532, campaigns:541, campaigns:549, campaigns:571, campaigns:605, campaigns:617, campaigns:652, campaigns:670, playlists:329, playlists:339, session-planner:549, tags:33 |
| Live + Rooms and Settings | 14 | live:516, live:526, live:701, live:711, live:831, live:894, live:1249, outputs:137, outputs:146, settings:209, settings:217, settings:231, settings:240, settings:268 |
| Live + Prep screens | 9 | campaigns:310, campaigns:637, live:790, live:1193, live:1207, live:1224, live:1237, live:1281, playlists:481 |
| Shell + Live | 9 | help:85, live:721, live:920, live:947, live:978, live:1088, live:1100, live:1275, live:1287 |
| Shell + Rooms and Settings | 3 | outputs:200, outputs:212, settings:18 |

## Suggested order

1. **Shell first** (39 checks). Back and its history (UX-18), the Saved pop-up (UX-19), the trail, the Rooms
   name, Find and play (Ctrl+K), Display and Help's fifteenth article. Every other stream's screens carry Back and the
   pop-up. 22 of these checks sit on Campaigns, Playlists or the planner, which the app has already, so the
   Shell turns those green on its own; the 9 in Live and 3 on Rooms or Settings also wait for that stream.
2. **Then Rooms and Settings and the Prep screens, side by side** (39 and 66). They need nothing of each other.
   Rooms and Settings should land early in this step: Kick, the bot in each room and Settings › Keyboard shortcuts are
   what 14 Live checks wait for. The Prep screens' steps (PLY-8), dividers (ORG-4) and markers (PLY-4, DAT-3) are
   what 9 Live checks wait for.
3. **Live** (107, the most). Its round 6 part 3 boxes can be built alongside step 2 once the Shell's Back and
   pop-up are in; its round 7 part 2 checks (steps, dividers, markers, keys from the shortcuts map) come last, after
   the Prep screens and Settings.

Each stream adds its own name to `BUILT_STREAMS` when its checks pass; a check that two streams need stays expected
to fail until the second of them is in.

