/**
 * 0.5.2 item 17 ("Need to be able to filter by track shape"): the Library's Shape filter (DAT-13) for other lists of
 * tracks: Add tracks on a playlist and the scene pickers. Five chips, any number pressed (none: any shape), with Clear
 * while one is, as in the Library's Filters box. A track's shape is the game master's choice, else Lyre's suggestion.
 */
import React from "react";
import { shapeOf, SHAPE_WORDS, TRACK_SHAPES, type TrackShape } from "../../common/domain";
import { ShapeGlyph, type ShapedTrack } from "./ShapeGlyph";
import { Icon } from "./Icon";

/** None chosen is any shape; otherwise the track's shape (chosen, else suggested) must be one of them. */
export function matchesShapes(track: ShapedTrack, shapes: readonly TrackShape[]): boolean {
  if (!shapes.length) return true;
  const { shape } = shapeOf(track);
  return !!shape && shapes.includes(shape);
}

export function ShapeFilter({ value, onChange, className }: { value: readonly TrackShape[]; onChange: (shapes: TrackShape[]) => void; className?: string }) {
  return (
    <div className={`chips shape-filter${className ? ` ${className}` : ""}`} role="group" aria-label="Shape" title="None pressed: any shape">
      <span className="faint">Shape</span>
      {TRACK_SHAPES.map((shape) => {
        const on = value.includes(shape);
        return (
          <button key={shape} type="button" className="chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== shape) : [...value, shape])}>
            {on ? <Icon name="check" size="s" /> : <ShapeGlyph shape={shape} />}
            {SHAPE_WORDS[shape]}
          </button>
        );
      })}
      {value.length > 0 && (
        <button type="button" className="btn s ghost" aria-label="Clear Shape" title="Clear Shape" onClick={() => onChange([])}>
          Clear
        </button>
      )}
    </div>
  );
}
