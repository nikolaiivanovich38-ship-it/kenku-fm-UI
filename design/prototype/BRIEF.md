# Lyre design round 2: brief for view builders

Lyre is a desktop app (Electron, Windows) that a tabletop game master uses to play music, ambience and sound effects
into Discord during online D&D, Vampire and wizarding-school games. You are building one part of a **clickable HTML
prototype** (no real audio) for the second design round. The product owner (Nik) is a non-technical end user and
the person who judges this prototype. Root folder: `/tmp/claude-0/-home-claude/a5e78b7e-815d-5e8a-bdce-70d49bc8697d/scratchpad/r2`.

## Nik's feedback on round 1 (verbatim)

> A1 live view: Too much on one screen, buttons are too big. Closers should be smaller. The way you set up tracks and
> playlists in sessions doesn't make sense to me. You need to build this so that it can work in a live session taking
> up only half the screen and doesn't have overlaps, because I'll have a VTT and Discord on one screen and notes and
> the soundboard sharing the other. Also, in the design, in the live view the pads for sound effects, and the sound
> effects themselves, are much less important than music tracks and playlists for a scene. On the details views we
> want to see the metadata title alongside the title we gave the track alongside the file name and path. I also don't
> really see how you add tracks and assign them tags in this view. All the panes should be collapsible and expandable.
> Everything is just a little bit chunky. Also, let's come up with a beautiful design language that moves us away from
> the Kenku purple [...]. Also, I don't see how I edit pad boards. I also want the ability to reduce and expand the
> number of pads I have on a board. I also need the ability to manually define playlists outside of sessions, and
> assigns playlists to scenes and sessions and campaigns. I also don't see the top level, where I can define multiple
> campaigns?

Background you should know: Nik runs his games as improvisation inside a broad structure, so the music has to follow
the mood of the moment; live play needs both prepared material (the scene's playlists) and free choice (anything in
the library, found by mood). He titles tracks with long descriptive notes ("Melancholy tense - melancholy heroism -
fade"), uses film-score recordings, groups tracks by tags (Mood, Leitmotif, Scene type), and wants both hand-made and
tag-built ("dynamic") playlists. He sometimes takes a player into a second Discord room for a private scene.

## The model (already in `src/data.js`; read it)

- **Campaign > Session > Scene.** Campaigns are the top level. Each campaign has a table theme.
- **Playlists** live on their own (the Playlists page). Manual (tracks chosen and ordered by hand) or dynamic
  (built from tag rules). Lane: music or ambience. A playlist can be assigned to a campaign (available all campaign),
  a session (available that evening) or a scene (the scene plays it).
- **Scene** = name, "starts when" cue line, music playlists (ordered; the first one starts when the scene starts,
  the others are alternatives for that scene), one ambience playlist, one pad board, notes.
- **Pad boards** live on their own (Pad boards page) and are assigned the same way. A board has `cols` × `rows`
  slots; pads beyond a shrunk grid move to the board's `spare` tray, never deleted silently.
- **Tracks** have three names that must all be visible in details views: `title` (the title Nik gave it, may be
  empty), `metaTitle` (from the file's tags), `file` (file name), plus `folder` (path). `L.title(t)` gives the best
  display name. Tags are `t.tags.mood / motif / scene`.

## Design rules (all views)

- **Compact.** Use the tokens and classes in `src/tokens.css` and `src/ui.css`: controls 28 px (`.btn`), small 24 px
  (`.btn.s`, `.closer`), rows 30 px. No 44 px buttons. Closers are `.closer` (24 px, quiet).
- **Half screen without overlaps.** Every view must work at 960 px wide (half of a 1920 screen) and still work at
  720 px, and use space well at 1280 px. Use container-friendly layouts (CSS grid/flex, `min-width: 0`, ellipsis,
  `@container app (max-width: …)` queries on `#app`, which has `container-name: app`). Nothing may overlap, nothing may
  cause a horizontal scrollbar on the page, no button text may be clipped.
- **Every pane collapsible and expandable**: use `L.pane({...})`; put panes in `.col` columns so collapsed panes give
  their height to the others. A collapsed pane shows a one-line `summary`.
- **Themes:** never hard-code colours; use the CSS variables (`--surface`, `--ink-2`, `--accent`, `--music`, …). Pad
  colours come from `L.colors` (they are pad identities, shown as a stripe or icon tint, not as text colour on
  arbitrary backgrounds). Test in the campaign theme and in `parchment` (light).
- **Accessibility:** WCAG 2.2 AA. Real buttons and labels; `aria-pressed`/`aria-expanded`/`aria-selected` where
  relevant; keyboard reachable in a sensible order; visible focus (already global); targets at least 24 px; colour is
  never the only signal; `L.say()` announces live changes. Icon-only buttons need `title` and an accessible name.
- **Plain language** in the UI, British spelling, sentence case. No jargon ("lane" is fine on the live screen only if
  labelled "Music" / "Ambience"). Avoid the words "set" and "carry" in UI text where another word works.
- **No new libraries, no external requests.** Plain JS (ES5-style like the core is fine; ES2017 OK), no frameworks.
- Prep views may use `L.sheet` for focused tasks. The **live view must not open modal sheets or overlays** that cover
  its controls; menus are fine.
- Each view defines `notes: [...]` (3-6 short bullets, plain HTML) explaining to Nik what changed in response to his
  feedback and how to try it. These show in the prototype's "Design notes" strip.

## Core API

Read the header comment of `src/core.js` (routing, `L.view`, `L.acts`, `L.inputs`, `L.pane`, `L.menu`, `L.sheet`,
lookups, simulated playback) and `src/views/_shared.js` (`L.pickerSheet`, `L.pickPlaylists`, `L.pickBoards`,
`L.assignSheet`). Look at `src/views/look.js` for a small finished example. Mutate `LYRE_DATA` objects directly
(`L.data`) and call `L.render()`; no persistence is needed. Give every focusable element that survives re-renders a
stable `data-k` so focus is kept. Elements with `data-progress="music|amb|preview"` / `data-time="…"` update every tick
without re-render.

## Files

You own only the files named in your task. Do not edit `core.js`, `ui.css`, `tokens.css`, `data.js`,
`_shared.js`, `index.html` or `build.js`; if you need a core change, put a helper in your own file and mention in your
report what should move to core. Prefix your CSS classes with your view's short prefix to avoid clashes.

## Check your work before reporting

1. `cd <root> && OUT=<yourname>.html node src/build.js` (your own output file, so builds by others do not collide).
2. `OUT=<yourname>.html node tools/shot.js '#/<route>' <root>/shots/<yourname>-<n>.png <width> <height> [theme] ['js to run first']`
   at 960×1000, 720×900 and 1280×1000, in the campaign theme (omit theme) and `parchment`. It prints console errors,
   overlapping controls, horizontal scroll and clipped button text: all must be empty/false. Then **look at the
   screenshots** (Read the PNG) and fix what looks cramped, misaligned or chunky. Exercise your main flows with the
   js argument (e.g. clicking buttons via `document.querySelector(...).click()`) and screenshot the result.
3. Tab through your view once with Playwright (a short script of your own in `tools/`) to confirm order and that
   nothing is unreachable.
4. Report back: what you built (routes, flows), decisions you made and why, anything you could not do, and the
   screenshot paths of your best 960 px shots. Keep the report under 400 words.

## Shared words (use exactly these so the views read as one app)

- **Campaigns, Sessions, Scenes**; a scene's **Starts when** line (the cue in the story).
- **Playlists**: "Chosen by hand" (manual) and "Built from tags" (dynamic). **Music** and **Ambience**.
- **Use in…**: the button that opens `L.assignSheet` for a playlist or board. **Used in** lists where it is used.
- **Pad boards**, **pads**, **Spare pads** (the tray for pads that do not fit the grid).
- **Your title**, **Title in the file** (metaTitle), **File name**, **Folder**.
- **Preview**: only Nik hears it (violet, headphones icon). **On air**: what the players hear.
- **Off script**: finding any track by mood or name during play.
- What the live view offers, in this order: the current scene's playlists, then the session's playlists, then the
  campaign's playlists, then the whole library (Off script search).
