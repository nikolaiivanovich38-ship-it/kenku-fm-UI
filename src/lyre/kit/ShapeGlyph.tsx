/**
 * DAT-13 a track's shape: how it moves from start to end (Steady, Builds, Falls away, Peaks then falls, Rises and
 * falls), as a small line drawing beside its word. Ported from core.js L.shapeGlyph and L.shapeTag; the words and
 * which shape applies come from the domain (SHAPE_WORDS, shapeOf). ui.css .shape-g, .shape-tag.
 */
import React from "react";

import { SHAPE_WORDS, shapeOf, type DomainTrack, type TrackShape } from "../../common/domain";

/** The drawings, on a 24 × 12 box, copied from the prototype. */
export const SHAPE_PATHS: Record<TrackShape, string> = {
  steady: "M1 6.5C5 5.5 9 7.2 12 6s7-1 11 .5",
  builds: "M1 10.5C9 10.5 15 8 23 1.5",
  fallsAway: "M1 1.5C9 2 15 9 23 10.5",
  peaksThenFalls: "M1 10.5C7 10 9 1.5 13 1.5s7 8.5 10 9",
  risesAndFalls: "M1 9.5C3 2.5 6 2.5 8 7.5s4 5 6 0 4-5.5 5-4 2 5 4 4.5",
};

export type ShapedTrack = Pick<DomainTrack, "shape" | "suggestedShape">;

/** The drawing alone. Decoration: whatever sits beside it says the shape in words. */
export function ShapeGlyph({ shape }: { shape: TrackShape }) {
  return (
    <svg className="shape-g" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
      <path d={SHAPE_PATHS[shape]} />
    </svg>
  );
}

/** "Shape: Builds", with "(suggested from its loudness)" while the game master has not chosen one. */
export function shapeTitle(track: ShapedTrack): string {
  const { shape, source } = shapeOf(track);
  return shape ? `Shape: ${SHAPE_WORDS[shape]}${source === "suggested" ? " (suggested from its loudness)" : ""}` : "";
}

/**
 * The shape that applies to a track, drawn with its word (or, `iconOnly`, with the words for screen readers only),
 * and on hover whether Lyre suggested it. Nothing for a track with no shape yet.
 */
export function ShapeTag({ track, iconOnly = false }: { track: ShapedTrack; iconOnly?: boolean }) {
  const { shape } = shapeOf(track);
  if (!shape) return null;
  const title = shapeTitle(track);
  return (
    <span className="shape-tag" title={title}>
      <ShapeGlyph shape={shape} />
      {iconOnly ? <span className="sr-only">{title}</span> : <span>{SHAPE_WORDS[shape]}</span>}
    </span>
  );
}

/**
 * The line under the Shape choice in a track's details (library.js): "Suggested by Lyre from the track's loudness.
 * Choose another to change it." or "Your choice." with what Lyre suggested when that differs. The screen adds its
 * own "Use the suggestion" button.
 */
export function shapeHint(track: ShapedTrack): string {
  if (track.shape) {
    const other = track.suggestedShape && track.suggestedShape !== track.shape ? ` Lyre suggested ${SHAPE_WORDS[track.suggestedShape].toLowerCase()}.` : "";
    return `Your choice.${other}`;
  }
  return track.suggestedShape ? "Suggested by Lyre from the track's loudness. Choose another to change it." : "";
}
