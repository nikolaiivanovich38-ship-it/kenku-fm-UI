# Lyre design prototype (the specification)

This clickable prototype was built and reviewed with the product owner in four rounds on 4 November 2026, and changed
in round 5 (5 November 2026) after he tested Lyre 0.3.0 (`ROUND5.md`).
**It is the specification for the new interface (WP5):** every screen, word and behaviour in it is what gets built.
A change of mind is tried here first, then built in the app once.

- `lyre-prototype.html`: the built prototype, one self-contained file (open it in a browser; no sound).
- `src/`: its source. `core.js` holds the shared model and simulated playback; `views/*.js` one screen each;
  `tokens.css` the five themes; `ui.css` the shared boxes and controls. Build with `node design/prototype/src/build.js`.
- `BRIEF.md`, `ROUND3.md`, `CLEANUP.md`, `ROUND5.md`, `ROUND6.md`, `ROUND7.md`, `ROUND8.md` (0.5.1: Lyre is the whole window): the product owner's notes, verbatim, and the design rules that answer them
  (round 6: less text on screen, with before and after numbers from `tools/r6-measure.js`).
- `tools/`: the scripts that checked each screen (Playwright; set `LYRE_SPEC_CHROMIUM` to use a Chromium other than Playwright's own; `r5-check.js` checks the round 5 screens). They are the source for the acceptance tests in
  `e2e/specs` (FND-15), which run against this prototype now and against the app as each screen is built.
- The rules the prototype proved live as tested TypeScript in `src/common/domain` (DAT-12).

Fonts are embedded from @fontsource packages under the SIL Open Font License 1.1 (Atkinson Hyperlegible,
Barlow Condensed, Lora, Cinzel, Cormorant Garamond).
