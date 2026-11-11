/**
 * Where a sound goes (design round 5, UX-16; the prototype's L.destTag): the same tag wherever sound is shown, in
 * words with an icon and a colour, never colour alone.
 *   On air   (filled, the on-air colour, broadcast icon)  the players hear it; with the room's name when there are two
 *            or more rooms ("On air · Side room").
 *   Only you (outlined, the preview colour, headphones)   a preview: only the game master hears it.
 * Paused, the tag turns grey; the Now playing bar adds a "Paused" badge beside it.
 */
import React from "react";

import { Icon } from "./Icon";
import { cx } from "./cx";

export interface DestTagProps {
  to: "air" | "you";
  /** The room it plays in, for On air when there are two or more rooms. */
  room?: string;
  paused?: boolean;
  /**
   * Should 10 of the round 6 review: the players do not hear it after all (no bot in a voice channel, or nobody in the
   * room's channel): why, as its hover text. The tag is outlined in the warning colour instead of filled.
   */
  nobody?: string;
}

export function DestTag({ to, room, paused = false, nobody }: DestTagProps) {
  const you = to === "you";
  const words = you ? "Only you" : room ? `On air · ${room}` : "On air";
  const title = you ? "Only you hear this, in your headphones" : nobody ? nobody : room ? `The players hear this in ${room}` : "The players hear this";
  return (
    <span className={cx("dest", you ? "you" : "air", paused && "paused", !you && nobody && "warn")} title={title}>
      <Icon name={you ? "headphones" : "broadcast"} size="s" />
      <span className="ellipsis">{words}</span>
    </span>
  );
}
