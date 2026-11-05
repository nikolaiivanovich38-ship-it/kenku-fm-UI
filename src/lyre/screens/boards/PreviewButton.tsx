import React from "react";
import { Icon } from "../../kit/Icon";

export interface PreviewButtonProps {
  /** What it previews, as the game master knows it: a pad's label, a track's title, a board's name. */
  name: string;
  previewing: boolean;
  onClick: () => void;
  /** A board's button previews its first pad and says so. */
  firstPadOf?: boolean;
  tabIndex?: number;
}

/**
 * Preview in your headphones only (the prototype's L.previewButton): a headphones button, a stop button while it
 * plays. The players never hear it.
 */
export function PreviewButton({ name, previewing, onClick, firstPadOf, tabIndex }: PreviewButtonProps) {
  const label = previewing ? `Stop preview of ${name}` : firstPadOf ? `Preview the first pad of ${name}` : `Preview ${name}`;
  const hint = previewing ? "Stop preview" : firstPadOf ? "Preview the first pad in your headphones" : "Preview in your headphones";
  return (
    <button type="button" className="btn s icon pv" aria-pressed={previewing} aria-label={label} title={hint} tabIndex={tabIndex} onClick={onClick}>
      <Icon name={previewing ? "stop" : "headphones"} size="s" />
    </button>
  );
}
