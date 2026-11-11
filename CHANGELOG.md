# Changelog

All notable changes to Lyre (called Cue Desk in versions 0.1.x). Versions follow [Semantic Versioning](https://semver.org/). Each entry says what changed for you, in plain language; backlog IDs are in brackets for the team.

## [Unreleased]

## [0.5.0] - 2026-11-11: Live in seven boxes, Back everywhere, Rooms and Settings in Lyre

**Live**
- Live has seven boxes, each with one job: On air across the top, then Scenes and Current scene, then This session and Whole campaign, each with its playlists and pads. Boxes grow with what is in them and the page scrolls; session playlists and the campaign boxes start folded. Alt+1 to Alt+7 jump between them. [SHW-8]
- On air shows each room: its bot and channel, what plays, Up next, volume, Mute, Repeat and Next. A room nobody is in says "Nobody there", with a button that moves the bot to where your players are, and Undo. [OUT-7, SHW-8]
- Every track and playlist in Live has Play now, Play next, Add to queue and Preview: in Current scene, in any scene you unfold in Scenes, in the session and campaign boxes, and in Find. Play now from a scene that is not running plays that item without starting the scene. What you add belongs to that room for the evening; Undo takes it back. [PLY-16, SHW-7]
- Find a track or playlist (/) searches your whole library from Live, for anything not in the plan. [ORG-14]
- Repeat on the Now playing bar and in On air is per room, for what plays now; Repeat one on a scene's track is saved with the scene. The bar also has Shuffle and What played. [PLY-17, PLY-13, PLY-1]
- Keys you give "Work in other programs too" in Settings (for example F9 for Next scene) work while Discord is in front. [UX-12]

**Getting around**
- Back (‹) sits top left on every screen, Live included. It goes back through everywhere you have been, across the menu, up to 50 places, each as you left it: same scroll, same open box. Alt+Left does the same. [UX-18]
- Every screen shows where it sits (Campaigns › The Sunken Crown › Session 14); each part is a link. [UX-20]
- One small "Saved" note in the bottom-right corner for every change, everywhere. If a save fails it stays, says what to do, and has Try again. Ready, Saved and scene counts are gone from the boxes. [UX-19, UX-17]
- Ctrl+K finds and plays any track, playlist, pad or scene. [UX-12]
- Look and feel › Display: Comfortable spacing, text up to 200 % and high contrast. A name cut short shows in full on hover or focus. [UX-6]
- Outputs is now called Rooms. [OUT-9]

**Rooms and Settings**
- Settings is now inside Lyre, in the menu: Discord bots (Connect, Replace…, Rename, Remove with Undo, Add a bot in three steps; only a token's last four characters are ever shown), Sound to Discord with the crossfade between tracks, Headphones and speakers (preview on its own device, or split one headset), Remote control, Keyboard shortcuts (change a key, Put back, a printable sheet) and Local files. Settings shows Lyre's version. [OUT-8, PRV-2, UX-12]
- Rooms: each bot in a voice channel is a chip with Kick; a channel with no bot has Add. Kick never asks: if the players were hearing something, Undo puts the bot back and the music carries on. Each room has a level meter. [OUT-7, OUT-10]

**Preparing your games**
- A Tags screen keeps your tags tidy: groups in your order, each with a colour, tags inside tags (filtering by Melancholy finds the grieving tracks too), other words that find a tag ("sad" offers Melancholy), and Rename, Merge into… and Delete… that change every track at once, with Undo. Open it from the Library's ⋯ or Look and feel's Tag colours…. [DAT-10]
- Playlists and pad boards go into folders (Move to folder…, or drag one onto a folder); folders nest and fold. A manual playlist can have dividers that name its sections, and a pad board dividers that name its rows. [ORG-4]
- Drag tracks onto another playlist, a scene, a pad board or Up next: a Drop on panel shows where they can go. Dropping copies, Shift moves, Esc cancels; ticked Library rows go together. Add to… in a row's ⋯ does the same from the keyboard. [ORG-5]
- A scene's ⋯ › What it does when it starts… and a pad's ⋯ › What it does… list their steps: add, change and reorder them (fade the music first, fire a pad, play from a marker), try them in your headphones, and let a scene move on by itself. [PLY-8, SHW-3]
- A track's details show only the choices its role fits: a sting never loops, an underscore can fade out at its end and pick up where it stopped (also after a restart), and a track can be followed by a playlist or track. [PLY-4, SHW-3]
- In the Audio profile a marker can be the mix-out point, and Play on air from a marker starts the track there. [DAT-3]
- A playlist's tracks can be put in another order for one scene, session or campaign (drag, Alt+Up/Down, or Reorder's Move up and Move down), and back to the playlist's order; Repeat one on a scene's track shows in the planner. A duplicated scene keeps its orders. [ORG-13, PLY-17]
- Less to read: the Library's keys show only while you are in the list, the planner has no scene count or sentence about Live, and how-to lines are read out to screen readers instead of shown. New scenes are named Scene 7, Scene 8. [UX-17]
- Find missing files can preview the file it found again. [SEC-17]
- Prep screens show less: open boxes no longer say Empty or count their rows, and how-tos are hover text or show only while the keyboard is in their box. Adding a tag, or a track to a playlist, shows the Saved note. [UX-17, UX-19]

**Accessibility**
- Dialogs put focus inside when they open, so Tab stays inside and Esc closes them. When the button you pressed goes away, focus moves to the one beside it.
- One change is read out once; search counts are read out when you stop typing; with two rooms, every message says which room.
- Rooms at 200 % text no longer overlap. Library check boxes are bigger. Play on air has one icon everywhere, and What played has its own.

**Security**
- The remote control (Stream Deck, phone) now needs Lyre's secret code with every request, made the first time Lyre starts and kept encrypted on your computer. It stays off until you turn it on and listens only on this computer unless you choose otherwise. Web pages cannot use it, a device that tries ten wrong codes is locked out for ten minutes, and its answers no longer show where your files are. The Kenku FM Stream Deck plugin does not send the code yet, so it cannot control Lyre for now; Settings will show the code. [SEC-4]
- When Lyre cannot check for or install an update, it now tells you once, in plain words, instead of only writing it to its log. [SEC-14]
- The remote control's web server library moved to its current version, which fixes its known security problems. No library Lyre ships has a known serious security problem. [SEC-9]
- Every change is now checked automatically for its tests, a start of the app, accessibility, library security problems, secrets and code security; a release is built only after all of them pass, and a failing check says in plain words what to do. [FND-5, SEC-1]
- The remote control listens only on this computer, or on this computer's own address on your home network. Every address (0.0.0.0), internet addresses and addresses this computer does not have are refused, whatever asks for them. [SEC-4]
- Only Lyre's Settings turns the remote control on. The old main window's Settings no longer turns it back on at every start; if you had it on in 0.4.1, your choice is moved over once. [SEC-4]
- Keys that work in other programs refuse Ctrl+Alt with a letter or digit (AltGr on a Belgian keyboard, which types @, € and #), and Alt+F4 or Ctrl+F4. [UX-12]
- A drag cancelled with Esc cannot drop a file or link onto the page; drag and drop to reorder playlists, scenes and campaigns works again in the app. Lyre saves only the display and device settings it knows. [SEC-7]

**Fixes**
- Deleting a track from the playing playlist with shuffle off no longer makes a different track the current one. [BUG-11]
- Long sounds on a soundboard (ambience over 30 seconds) are streamed instead of being loaded whole into memory. The first time you play a sound without fades, it streams while Lyre learns its length. [PERF-7]
- Stop all and Fade all also cancel what was waiting to start: a scene set to move on by itself, steps after a wait, and music waiting for a loop to end. A saved cue that stops one room cancels only what waited in that room. [PLY-8]
- Next or Previous while a scene's music waits for the current track to end cancels that wait. [PLY-8]
- A "Pick up where it stopped" track that plays to its end starts from the beginning next time, also after a restart. [PLY-4]
- Back returns the session planner to where you left it, even at the very bottom of the scenes. [UX-18]
- Find missing files keeps your place for the keyboard while Lyre looks in a folder.
- A room's time in Live runs to the track's End for that place, not to the end of the file. [DAT-3]

## [0.4.1] - 2026-11-06: fixes from your test of 0.4.0

- What goes to your players never plays on your computer's speakers. You hear it only through Discord, in the voice channel. When no bot is in a voice channel, Live's On air box and the Now playing bar say nobody hears it. Preview and Try pads still play in your headphones only. [BUG-19]
- Press a playing pad to stop it, whatever its play mode. Stop pads in Live's Pads box stops every pad and leaves the music and ambience playing. A playing pad shows that it plays. [BUG-20]
- Rename a session from its own page and from Live's top strip: click the name or press F2, Enter saves, Esc cancels. [BUG-21]

## [0.4.0] - 2026-11-06: run your games in Lyre

**Live**
- Live is here: start scenes with Space, undo with Ctrl+Z within 8 seconds, play music off script by name or mood, and use pads, rooms and volumes from one screen. [UX-2, UX-8, SHW-1, SHW-2]
- One On air box per room, with what plays, what is up next, transport, volume, Mute, and a menu to move, copy or leave. Add a room, then choose which room each box plays to. [UX-14, OUT-6]
- Pad keys work in Live, also with the Pads box folded. Running another session fades out what was playing from the last one. [SFX-2]
- The Keys button lists every key; single-key shortcuts can be switched off. [UX-12]

**Outputs**
- See your bots, who is in each voice channel, and move a bot to another channel during play. Mute a room, change its volume, or play a test chime in that room only. The menu shows how many bots are connected, e.g. "Outputs (1/2)". [OUT-5, OUT-6]

**What you hear, and where**
- The Now playing bar, on every screen while anything plays or is paused: a row for each room the players hear (On air) and one for your headphone preview (Only you), each with Pause, Stop and its own volume. In Live it shows only your preview. [UX-16]
- Normalise volume evens out loudness between tracks. Off at first; turn it on for the library (Library › ⋯ › Normalise volume…), or on or off for a playlist or a track. Lyre measures each track's loudness in the background and never changes your files. [PLY-15, DAT-15]

**Preparing**
- Shuffle, repeat all and repeat one, chosen separately for a playlist itself and for each scene, session or campaign that uses it. [PLY-13]
- Tracks show their tags and their shape (steady, builds, falls away, peaks then falls, rises and falls), suggested from their loudness; change it in a track's details, filter by it, and use it in dynamic playlist rules. [ORG-11, DAT-13]
- A track can have its own name in a scene (⋯ › Name in this scene…). [DAT-14]
- Use in… works on single tracks; keep single tracks on hand for a session or a campaign. [ORG-12]
- Add tracks or playlists…: open a playlist and tick just the tracks you want. [ORG-10]
- From a scene, the wave button opens a track's waveform, end and fades for that scene, and Back returns to it. [PLY-14]
- A dynamic playlist's details sit at the top, with its rules. [EDT-8]
- Pad boards: changing the grid size fills pads left to right, top to bottom, and pads you put in Spare pads yourself stay there; Try pads plays each pad as it will in Live, in your headphones only. [SFX-11, SFX-12]

**Your library**
- Back up, move or share: save the whole library, a campaign, session, scene, playlist, pad board or your tags to one .lyre file, with or without the audio. Open a .lyre file to see what is in it, choose Skip, Merge or Keep both for anything you already have, then bring it in; Undo takes it all back. [DAT-7]
- What came across from Kenku FM: what Lyre copied on its first start, and the files it cannot find. [DAT-9]
- Find missing files: point Lyre at a folder, check each match, then Relink, with Undo. Missing files are marked in the Library and have a filter. [DAT-8]

**Help**
- Press F1, or Help at the foot of the menu, for short how-to articles you can search. A short tour on the first start; take it again from Help. [FND-8]
- Help › Save diagnostics… saves a zip for bug reports. Tokens and your user name are taken out, and nothing is sent anywhere. [FND-9]

**Safety and fixes**
- A .lyre file from someone else can only put audio files on your computer; anything else in it is left out, and Lyre says so. It cannot fill your drive, and is refused if there is no room for its audio.
- Undoing a bring-in also clears the audio files it unpacked.
- A shuffled playlist in a scene no longer plays the scene's previous track again straight away.
- A room's volume slider always matches what the players hear.

## [0.3.1] - 2026-11-05: fixes from your first test of 0.3.0

- Music keeps playing while you prepare: adding, moving or removing a track in a scene no longer stops it, and closing the Add tracks window stops only a preview you started in it. [BUG-12]
- The On air bar stays on every screen while music plays, the Live page included, until you press Stop. [BUG-13]
- Box headers with many buttons (such as the Library with a filter on, at full screen) wrap onto a second line instead of pushing a button out of the box. The automatic layout checks now catch a control cut off at the side. [BUG-14]
- Tab adds the tag you typed (creating it if it is new), or the suggestion you picked, and moves on. [BUG-15]
- A pad's colour and icon show as soon as you click them, and a second click is kept. [BUG-16]
- Play in the Audio profile goes round, Start to End or the loop, until you stop it, with the playhead and time on every pass. [BUG-17]
- Rename a session or a scene where it is listed: double-click its name, press F2, or choose Rename in its ⋯ menu. Enter saves, Esc cancels. [BUG-18]

## [0.3.0] - 2026-11-05: the new interface, for preparing games

**A new Lyre tab beside the Player**
- The new interface opens in its own tab, Lyre, next to the old Player. Use it to build your library and prepare campaigns; run games from the Player tab until Live arrives in 0.4. The old sidebar folds away while the Lyre tab is open. [WP5]
- The first time the Lyre tab opens, your playlists and soundboards from the Player are brought into the new library, with their names, order, pictures and sound settings. A file used in several places becomes one track. The Player's own library is not changed, and a copy of the new library is made first. [DAT-9]
- The new library keeps daily backups. If its file is ever damaged, Lyre says so and offers "Restore the latest backup". [DAT-6]

**Library**
- Search, filter by tag and tag many tracks at once. Adding a file reads its title, artist, album and length from its tags. [DAT-5]
- WMA and AIFF files play: Lyre makes a playable copy in its cache. Files that are not audio are refused with a plain message, and a file that is already in the library is selected instead of added twice. [BUG-10]
- Preview (only you hear it) and Play on air (the players hear it) wherever tracks, playlists, pads and boards are listed or chosen.

**Playlists, pads and campaigns**
- Playlists of your own choosing, and playlists made from tags that keep themselves up to date.
- Audio profile for each track: where it starts and ends, fades, and whether it loops or moves on. The preview follows your settings, and the waveform shows how loud the track is along its length.
- Pad boards you can resize and rearrange, with keys F1 to F12 and four play modes. A new pad takes its sound's name.
- Campaigns, sessions and scenes, with scenes that mix tracks and playlists in any order. Run and Live say they come in 0.4.
- Undo after a reset, deleting a board or scene, and bulk tagging, also with Ctrl+Z.

**Look and feel**
- Five colour themes, Candlelit Library first, each with its contrast shown. Empty screens say what to do first.
- The On air bar shows what the players hear on every screen, and says when only this computer hears it.

**Safety and upkeep**
- The library runs in its own background process: big changes do not interrupt the sound in Discord, and if it stops it restarts by itself and says so.
- The new interface plays only audio from your library's folders; it cannot read other files on your computer.
- Lyre ships ffmpeg (used for WMA and AIFF) with its licence and a check that the copy is the expected one.
- The media cache tidies itself, empties with Clear cache, and is closed properly when Lyre quits.

## [0.2.0] - 2026-11-04: Lyre

**New name and look**
- The app is now called Lyre, after the lyrebird (a superb mimic) and the lyre its tail is shaped like, with its own logo, icons and installer. On first start Lyre brings across your library from Cue Desk test versions, or else from Kenku FM; saved bots come across from Cue Desk without entering the token again. Cue Desk test versions do not update to Lyre: install Lyre once. [FND-12, FND-13]
- Lyre comes with 23 background pictures of its own, under the names Kenku FM used, so playlists and soundboards from Kenku FM show a picture whether or not Kenku FM is installed. Lyre no longer reads anything from Kenku FM's program folder. [FND-14]
- Track and sound names keep the file name exactly as written, capitals and punctuation included, so cue notes in your file names survive. Kenku FM changed them to Title Case.
- A demo kit comes with each release: music, background sounds, effects and a test page made for Lyre, so you can try every feature without your own library.

**Discord and outputs**
- Use several Discord bots at once, in different channels of the same server, each with its own mute. A guided step explains how to add a second bot. [OUT-1]
- Each output shows its status, reconnects by itself after a network drop (with a countdown and a "Try now" button), and keeps broadcasting through a short outage. [OUT-2]
- Joining a voice channel no longer gets stuck on "connecting"; leaving a Stage channel works; a bot moved or disconnected by a moderator stays out and says why. [BUG-6, BUG-7]
- Lyre records and sends audio only while a bot is in a voice channel, and only from tabs that are playing, so it uses much less of your computer. "Performance" mode (now "Lighter on the computer") no longer delays Discord by half a second. [PERF-4, PERF-8]
- Audio stays inside Lyre; there is no network connection for it. [SEC-2]
- Bot tokens are saved encrypted, or kept only until you close Lyre where that is not possible. After moving an old saved token, Settings recommends resetting it. A token Discord refuses is explained plainly and not kept. [SEC-5]

**Tabs and bookmarks**
- Open files from your computer in a tab (for example a home-made soundboard page): Lyre asks first and can remember folders (Settings > Local files). Such pages can only read their own folder, cannot reach the internet and cannot record the screen. [SEC-15]
- Lyre's own windows can no longer record the screen. [SEC-16]
- Bookmark folders, and a sidebar that collapses to icons while still showing each output's status. [UX-10]

**Player**
- The player no longer uses processor time when nothing is playing. [PERF-1]
- Deleting the playing track stops it; Next and Previous carry on from where it was. Deleting a track that is still loading no longer stops the music that was playing. [BUG-8]
- Dragging a volume slider no longer rewrites your whole library dozens of times a second, and the last change is saved when you close Lyre. If changes cannot be saved, the player says so and tries again. [PERF-6]

**Easier to use**
- Dialogs, menus and error messages are no longer hidden behind the player or websites; error messages close by themselves once the problem is fixed.
- A clear gold outline shows where the keyboard is; tabs and bookmarks can be moved with the keyboard from their icon; buttons work with Enter and Space and have clear names.
- Settings is wider on large windows and uses plainer words; a missing file says "Can't find this file. Check the name and folder."
- Paths copied with Windows' "Copy as path" can be pasted into the address bar as they are.

**Behind the scenes**
- A new library database (with daily backups, undo and instant search) and a new playback engine are built and tested, ready for the new interface; your library is not moved into them yet. [DAT-6, PLY-10]

## [0.1.1] - 2026-11-04

**Fixes**
- Playlists and soundboards from Kenku FM show their background pictures again when Kenku FM is installed on the same computer: Cue Desk copies the pictures into its own folder when it starts. Without Kenku FM, backgrounds stay blank for now.

**Behind the scenes**
- The app no longer contains any part that has to be compiled from C++ (zlib-sync removed; Discord works without it), so installers build on GitHub's current Windows computers again. [FND-10]

## [0.1.0] - 2026-11-04: first release of the fork

**New name and home**
- The app is now called Cue Desk (working name), version 0.1.0. It is an independent fork of Kenku FM 1.5.5 by Owlbear Rodeo and can be installed next to Kenku FM. [FND-1]
- On first start, your Kenku FM library (playlists, soundboards, bookmarks, settings and window position) is copied into Cue Desk. Kenku FM itself is left untouched. [FND-1]
- Help > Learn More opens this project's page instead of Kenku FM's website. [FND-1]
- Automatic updates now come from this project's releases. Before, the app would have replaced itself with upstream Kenku FM. Update problems are now recorded in the log instead of being ignored. [SEC-14]

**Fixes**
- The black "drop the tracks here" overlay no longer gets stuck on screen after a drag. [BUG-1]
- Dropping a big folder imports every file, not just the first 100. [BUG-2]
- A sound's fade-in now works on its own, without also needing a fade-out. [BUG-3]
- Looping sounds with fades no longer use more and more memory during a long session. [BUG-4]
- Jumping to another point in a sound now moves its fade-out too, so it fades out just before the end instead of too early or too late. [BUG-5]
- Stopping a sound with a fade-out always finishes, even when the sound failed to start. [BUG-4]
- The "drop here" overlay no longer flickers while you move a file across the window. [BUG-1]
- Editing a bookmark saves the name and the address together when you press Done; Cancel or Escape leaves the bookmark as it was.
- Error and warning messages stay on screen until you close them; success messages still go away by themselves. Screen readers announce errors straight away and other messages politely.
- Error messages appear at the top of the window, so they no longer cover the Done button in Settings, and screen readers announce them even while Settings is open.
- Buttons shown only as icons (Settings, Back, the "…" options menus) now have names that screen readers read out.
- Dragging a link onto the address bar or a bookmark's address field puts the link in the field.
- Audio files are recognised by their extension too, so files such as .m4a, .flac and .opus are no longer turned away. [BUG-10]
- The remote API's "get" requests (used by Stream Deck buttons) answer correctly when several arrive at once, and the soundboard list is no longer out of date after you edit a soundboard. [PERF-9]
- Closing a tab or switching off an input device frees its audio processing, so long sessions stay lighter. [PERF-5]
- The player and the main window load once at start-up instead of twice.
- The Cue Desk icon shows in the window and taskbar on Linux.

**Security**
- Built on Electron 44 (Chromium 152), which receives security fixes. Kenku FM 1.5.5 uses Electron 37, which no longer does. Sites with copy protection (DRM), such as Spotify, no longer play in tabs; see Known limitations in the README. [SEC-1]
- The app files are packed and checked at start-up, and debugging switches that could let another program take control of the app are turned off. [SEC-13]
- The app's internal messages are accepted only from the app's own pages, and each page loads only the app's own code (Content Security Policy). [SEC-8, SEC-11]
- The hidden window that sends sound to Discord runs in the browser's sandbox. [SEC-12]
- The internal audio link can no longer be reached by other computers on your network. [SEC-2]
- Websites in tabs can no longer use your microphone, camera, location or devices; such requests are refused without asking you. [SEC-3]
- Websites in tabs now keep their logins separately from the app. Logins are not carried over from Kenku FM, so log in to websites in tabs again once. [SEC-3]
- Tabs only open normal web addresses, and pages can no longer flood the app with pop-up tabs. [SEC-6]
- Bookmarks saved without https:// (for example "youtube.com") open again; a bookmark that can't be opened shows a message saying why instead of an empty tab. [SEC-6]
- The address bar shows "Not secure" for http:// pages. [SEC-6]
- The app's own windows can no longer be turned into a web page. [SEC-7]
- Only web links (https) are handed to your browser; other kinds of links are refused. [SEC-10]
- Libraries with known security problems were updated (ws, undici, react-router). The remote-control server library (fastify 4) is still to be upgraded; until then its known issues are listed and tracked. [SEC-9]

**Behind the scenes**
- Automated tests for the fixes above, written before each fix, and end-to-end tests that start the packaged app, including sending a page's sound towards Discord. [FND-4]
- Every change is now checked automatically on GitHub: type check, lint, tests with coverage, a dependency security audit, a scan for leaked passwords and CodeQL security analysis. [FND-5]
- Windows installers are built on GitHub and attached to a draft release for review before publishing. [FND-5]
- Release checklist, architecture notes and a developer guide added. [FND-6]
