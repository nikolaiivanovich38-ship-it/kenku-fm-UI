# Round 3: Nik's notes on round 2 (4 Nov 2026, 15:08), and what changed in the shared core

## Nik's words (verbatim)

> So, I like the campaign structure, but I preferred the ability when in a campaign to just tab between live and prep,
> though I think we should have that /and/ the 'run next session' button. I want to be able to add both individual
> tracks and playlists to a scene, not only playlists. I want to be able to slot a track between playlists or just use
> tracks, or just use playlists. I need a play button to listen to tracks, SFX, and playlists when I am adding them to
> scenes, so I can tell I'm getting the right one. I also need the ability to add multiple pads that I can change
> between, and to listen to them and see their content. I also need the ability to see the tracklist for a playlist
> when I'm selecting it, if I want to, via an expander, though by default it's closed. Same for the contents of the pad
> board and ambience list. I should be able to go back and run a session again. I should have run buttons on all
> sessions, but the ones aren't the next session should be visually distinct (e.g. grey). Same thing with adding
> playlists and pad boards at campaign level - I need to be able to listen to them and see their contents if I choose to.
> In the tracks list view, I need a play to me and play on air button, not just play to me.
> I need in line expanders for playlists in the playlist list view, and I need play to me and play on air buttons in it
> too. I don't need duplicate. Call chosen by hand manual and built from tags dynamic. You also need a filter for FX (for
> the pads and stings), so you need Music, Ambience, FX.
> I'm going to need search and filter for pad boards as well.
> How do the 'Spare Pads' work? What are they for?
> I need a play button on each pad when I am defining them in the pad boards open view, so I can listen to the sound.
> In the live view, I want more definition between the sections, so it's easier to see what's going on. The colours are
> a little hard to follow.
> In the live view, in the off script section, I need an X button to the right of the tag list when I have a tag
> selected which clears the list.
> Let's implement the full set of colourschemes, but use Candlelit library as our default.
> When defining campaigns, let's include placeholders where we can define links and integrations to Obsidian. They don't
> need to work yet, but we can use them in future.

## Words
- "Play to me" is our **Preview** (headphones icon, violet, only Nik hears). "Play on air" (broadcast icon) is what the players hear. Every place that lists tracks, playlists, pads or boards for choosing offers Preview; lists of tracks and playlists also offer Play on air.
- Playlists: **Manual** (was "Chosen by hand") and **Dynamic** (was "Built from tags"). Lanes: **Music**, **Ambience**, **FX**.
- **FX** = sound effects (new track kind `fx`, in the data now) plus stings (music tracks with role Sting): `L.isFx(t)`.

## Model changes in core (already done; adapt your view)
- `scene.music` is an **ordered list mixing track ids and playlist ids** (e.g. `['t13','p-abbey-eerie','t42','p-abbess']`).
  `L.sceneItems(sc)` → `[{kind:'track'|'playlist', id, obj}]`. Starting a scene plays the list in order:
  `L.sceneSequence(sc)` flattens it (each track, then each playlist's tracks, then back to the start). `L.next`/`L.prev`
  follow that sequence when the music came from a scene. The first item starts the scene.
- `scene.amb` is one ambience **track id or ambience playlist id**; `L.ambTracks(id)` gives its tracks.
- `scene.board` is gone: **`scene.boards`** is a list (`L.sceneBoards(sc)`); the first shows when the scene starts, the others are one click away.
- Track kinds: `music`, `amb`, `fx`; `L.kindName[kind]`. Playlists can have lane `fx` (sample: `x-stings`). Playing an fx track on air with `L.play(id)` layers it like a pad (it does not replace music).
- `L.usesOfTrack(tid)` lists scenes that use a track directly.
- Campaigns have `obsidian: { vault, note, sessions }` placeholders.
- Default theme is **Candlelit Library** (`L.data.defaultTheme`, used for the Campaigns and Look pages and campaigns without a theme).
- `L.modeSwitch(cid)` returns a Prep | Live switch for a view header; Prep opens the session loaded in Live (or that campaign's next session), Live loads that campaign's session in the live view. `L.nextSession(campaign)`.
- Preview: `L.preview(trackId)`, `L.previewPlaylist(pid)`, `L.previewPad(boardId, padId)`, `L.previewing(key)`, `L.previewLabel()` (use this to name what is previewing; `pb.preview.id` is empty for pads).
- Shared building blocks (`src/views/_shared.js`): `L.previewButton(kind, id)`, `L.playOnAirButton(kind, id)`, `L.expanderButton(key, label)` + `L.expanded(key)` + `L.contentsHTML('playlist'|'board', id)` (expanders closed by default, state per key), and pickers with Preview and expanders: `L.pickPlaylists`, `L.pickBoards`, `L.pickTracks({kinds})` (filters Music/Ambience/FX), `L.pickSceneMusic` (tracks and playlists together), `L.pickAmbience` (track or playlist). Use these instead of writing your own.
- Panes now have a header band (`--surface-2`) and stronger borders for more definition.

## Added at 15:15: audio profile
> We're also going to need an audio profile view which lets me set where the track should end, and either start
> looping or move to the next one. I will need to be able to listen to that and track the progression through it
> while I do that.

Core: route `#/profile/<trackId>` (view name `profile`), `track.profile = { start, end, after: 'loop'|'next'|'stop', loopStart, fadeOut, markers: [{ at, label }] }`,
`L.profileOf(t)` fills defaults; core playback honours it (starts at start, ends at end, then loops to loopStart, moves
to the next track, or stops). Samples: t13 (loops from 1:04 to 5:18) and t02 (starts at 0:08, ends 6:52, fades 6 s, then next).

## Added at 15:21-15:22: fades, and profiles per cue and playlist
> The profile will also need to let me set the fade duration and intensity and start and end points visually
> And define that differently for different cues and playlists

Core: `profile.fadeIn` / `profile.fadeOut` = `{ dur, shape }` (shape 0-100 gentle to sharp), `loopXfade`.
Overrides per place in `L.data.profiles[key][trackId]`, key `'pl:<playlistId>'` or `'sc:<cid>:<sid>:<sceneId>'`;
`L.profileOf(t, ctx)` resolves scene, then playlist, then the track's own; `L.profileWhere`, `L.profileKeys`,
`L.profileStore(t, key, create)`, `L.clearProfile(t, key)`. Playback on air uses the place the track is playing from.
Route: `#/profile/<trackId>` or `#/profile/<trackId>/<key>` (key with ':' as written above).
Sample override: t13 in scene sc3 (The abbey ruins) ends at 3:10 and moves on.

## Added at 17:12: drop files into playlists; outputs and moving bots between rooms
> I want to be able to drag and drop tracks straight from folders on my PC into playlists and have them add there and
> in the tracks list. I'm also missing the view of outputs, and where my bots are broadcasting too, and the ability to
> connect them to different rooms in discord on the fly

Core (done):
- `L.filesFromDrop(event, done(files))` reads dropped files and whole folders (walked), audio only, as `[{ name, folder }]`;
  `L.importFiles(files)` adds them to the Library (`isNew`, kind guessed from the folder name: Ambience, Effects/SFX, else
  Music; a file already in the Library is reused) and returns the track ids. Use these for every drop target.
- Discord model `L.data.discord = { servers: [{ id, name, channels: [{ id, name, members }] }], bots: [{ id, name, status,
  server, channel, muted, volume, mix }] }` with `L.bots()`, `L.bot(id)`, `L.server(id)`, `L.channel(sid, cid)`,
  `L.botJoin(botId, serverId, channelId)` (connecting, then connected after about a second; moving a bot is just joining
  another channel), `L.botLeave`, `L.botMute(id, on?)`, `L.botVolume(id, n)`, `L.botWhere(b)`, `L.botListeners(b)`,
  `L.botStatusText(b)`. Status: connected / connecting / idle / error.
- Route `#/outputs` (view `outputs`, nav `outputs`), linked from the rail as "Outputs (n/m)".

## Added at 17:40: outputs inline in Live, one On air section per mix
> I need the outputs in line on the page I'm on when I'm running a live game, so I can rapidly toggle them, I don't
> want to have to switch away from that page. They can be simple depictions - Output names with a volume slider for
> each attached to the on air section. We can have multiple on air sections clearly saying which output they are
> targeting, which appear dynamically when we add another output, and going away again when they are switched off.

Core (done): mixes. `L.pb` is the **table mix** every output hears by default. An output switched to its own mix
(`L.setBotMix(botId, 'own')`) gets its own music and ambience in `L.pb.own[botId]`; effects and pads always go to the
table mix. Every playback call takes an optional target bot id: `L.play(id, { target })`, `L.next(lane, target)`,
`L.prev`, `L.upNext`, `L.pauseLane`, `L.stopLane(lane, fade, target)`, `L.laneContext(lane, target)`, `L.mix(target)`.
`L.mixes()` lists the mixes in use: `[{ id: 'table'|botId, name, mix, bots }]`; an own mix is listed only while its bot
is in a voice channel and disappears when it leaves (`L.botLeave` drops it) or goes back to the table mix
(`L.setBotMix(id, 'table')`). Progress hooks: `data-progress="music@<botId>"`, `data-time="amb@<botId>"`.
This is the private "whisper" mix for a second room (backlog OUT-5), designed now.
