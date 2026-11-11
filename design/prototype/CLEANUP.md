# Round 4: clean-up and simplification (Nik, 4 Nov 2026, 17:55)

> I also think we have in general too much detail on screen - can we do a little clean up and simplification of the look
> and feel, the colours, the design, to make it easier to understand what a box is doing and what a box is for and to
> make it easy to track by eye the different purposes of each box and their current statuses.

## Rules for every view
1. **One box, one job.** The title says the job in Nik's words. Each box gets `kind` (identity edge, shared by all boxes
   of that purpose across the app) and **one status pill** (`status: { text, tone }`) in its header saying what it is
   doing now: e.g. Playing / Silent / 3 sounding / 2 selected. A box with nothing to say has no pill (round 6 part 5:
   no Ready, no Saved, no scene count). Use `L.pane({ ..., kind, status })`.
   Kinds: `onair` (what players hear, red), `music` (choosing music: playlists, scene music, track lists, blue),
   `scenes` (plans: campaigns, sessions, scenes, accent), `search` (finding: off script, filters, neutral), `fx` (pads and
   effects, lime), `plain` (details, settings).
2. **Colour means something, the same everywhere.** Red only for what the players hear. The theme accent only for your
   next action or your current selection. Lane dots (music, ambience, FX) only as small dots. Everything else neutral:
   no coloured chips, no coloured text for decoration. Tag chips are neutral now (core).
3. **Show less by default.** One line per row. Secondary details (tags beyond one, file names, "starts when", rule text,
   artist/album) appear for the selected/current item, on hover (title attribute) or in an expander, not on every row.
   At most one chip per row. No explanatory paragraphs that repeat on every visit: one short hint per box at most,
   and only where an action is not obvious.
4. **Buttons.** Repeated row actions are small icon buttons with tooltips and accessible names, always in the same
   order: Preview (headphones), Play next (where it exists), Play on air (broadcast), then a ⋯ menu for the rest.
   A box has at most one text button in its header: its main action.
5. **Status words** (use these exact words): Playing, Paused, Silent, Joining, Muted, Receiving, Not receiving,
   Empty, n selected. Saving is shown by the Saved pop-up (`L.saved`, ROUND6.md part 5), never as a box status.
6. Keep everything that already works (keys, accessibility, half-screen layout, no overlaps); this is subtraction.
