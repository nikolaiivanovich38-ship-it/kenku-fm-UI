/**
 * Round 10 (ROUND10.md, T7; Nik, 18 Nov 03:14, answer 5b): the Live tour's six steps, for Help › Tour of this screen.
 * r10-live writes the steps; r10-prep's tour component (help/Tour.tsx, a tour per screen) shows them. Each step points
 * at the first of its targets that is drawn (a CSS selector list, tried in order), with the prototype's words
 * (design/prototype/src/views/r9guide.js, after the language pass).
 */
export interface TourStep {
  /** CSS selectors, tried in order; the first one drawn on screen is pointed at. */
  target: string;
  title: string;
  text: string;
}

export const LIVE_TOUR: readonly TourStep[] = [
  {
    target: '[data-lv="nextsc"], #view [data-scene]',
    title: "Next scene",
    text: "Press Space to start the next scene. If you press it twice within a second, the second press is ignored.",
  },
  {
    target: '[data-pane="lv-onair"] .pane-toggle, [data-pane="lv-onair"]',
    title: "On air: what the players hear",
    text: "This box shows each room, what it plays now and what comes next. The red light is on while the players hear something.",
  },
  {
    target: ".lv-trk-acts .lv-pvb",
    title: "Preview: only you",
    text: "To hear a track in your headphones only, use the headphones button. Play on air, the last button on a row, is for the players.",
  },
  {
    target: '[data-pane="lv-current"] .lv-pad, .lv-pad',
    title: "Pads and their keys",
    text: "Click a pad or press its key to play it. Press Stop pads, beside them, to stop all pads.",
  },
  {
    target: ".lv-undoplace",
    title: "Undo",
    text: "Undo shows here for 8 seconds after you change what the players hear. You can also press Ctrl+Z.",
  },
  {
    target: '[data-lv="fade"]',
    title: "Fade all and Stop all",
    text: "Everything fades out with Fade all (Shift+Esc), or stops at once with Stop all, your preview too. You can undo both.",
  },
];
