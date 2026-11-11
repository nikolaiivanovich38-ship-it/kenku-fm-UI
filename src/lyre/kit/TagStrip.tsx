/**
 * ORG-11 tags where music is chosen (core.js L.tagStrip): a compact strip on a track's row with its shape glyph
 * first (DAT-13), then its first three tags, each with its tag group's dot (Mood gold, Leitmotif pink, Scene type
 * blue), then "+n" naming the rest on hover. Below 820 px of the app only the first tag and "+n" show (ui.css
 * .tagstrip; the strip draws both counts and the style sheet shows the one that fits).
 *
 * Screen readers hear every tag at once ("Tags: Eerie, Dread."), and the shape, rather than each chip.
 */
import React from "react";

import type { DomainTrack } from "../../common/domain";
import type { TagGroup } from "../../common/lyre/api";
import type { ChipGroup } from "./Pills";
import { ShapeTag } from "./ShapeGlyph";
import { cx } from "./cx";

/** How many tags show before "+n" at full width. */
const SHOWN = 3;
/** Groups with a colour of their own (ui.css .chip.mood …); others show a plain dot. */
const COLOURED = new Set<string>(["mood", "motif", "scene"] satisfies ChipGroup[]);

export interface TagStripProps {
  track: Pick<DomainTrack, "tags" | "shape" | "suggestedShape">;
  /** The tag groups in the order the game master keeps them (useTagGroups); a screen loads them once for all its rows. */
  groups: readonly Pick<TagGroup, "id" | "name">[];
}

export function TagStrip({ track, groups }: TagStripProps) {
  const all = groups.flatMap((g) => (track.tags[g.id] ?? []).map((value) => ({ group: g, value })));
  const hasShape = !!(track.shape || track.suggestedShape);
  if (!all.length && !hasShape) return null;
  const named = (list: typeof all) => list.map((t) => `${t.group.name}: ${t.value}`).join(", ");
  const rest = all.slice(SHOWN);
  const afterFirst = all.slice(1);
  return (
    <span className="tagstrip">
      <span className="sr-only">Tags: {all.map((t) => t.value).join(", ") || "none"}. </span>
      <ShapeTag track={track} iconOnly />
      {all.slice(0, SHOWN).map((t, i) => (
        <span key={`${t.group.id}:${t.value}`} className={cx("chip", COLOURED.has(t.group.id) && t.group.id, i > 0 && "ts-later")} title={t.group.name} aria-hidden="true">
          <span className="dot" />
          {/* UX-R17: the word ends in … when the chip is cut short, never mid-word; the whole of it on hover. */}
          <span className="ellipsis" title={`${t.group.name}: ${t.value}`}>
            {t.value}
          </span>
        </span>
      ))}
      {rest.length > 0 && (
        <span className="chip ts-more ts-wide" title={named(rest)} aria-hidden="true">
          +{rest.length}
        </span>
      )}
      {afterFirst.length > 0 && (
        <span className="chip ts-more ts-narrow" title={named(afterFirst)} aria-hidden="true">
          +{afterFirst.length}
        </span>
      )}
    </span>
  );
}
