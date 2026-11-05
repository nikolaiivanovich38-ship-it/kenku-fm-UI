import React, { useId, useState } from "react";
import { Icon } from "./Icon";

export interface ExpanderButtonProps {
  /** The name of what is inside, e.g. a playlist's name: "Show contents of <label>". */
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** The id of the element it shows or hides. */
  controls?: string;
}

/** The chevron that opens a playlist or board in place (ui.css .xp-btn), named after what it opens. */
export function ExpanderButton({ label, expanded, onToggle, controls }: ExpanderButtonProps) {
  return (
    <button
      type="button"
      className="xp-btn"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-label={`${expanded ? "Hide" : "Show"} contents of ${label}`}
      title={`${expanded ? "Hide" : "Show"} what is in ${label}`}
      onClick={onToggle}
    >
      <Icon name="chevdown" size="s" />
    </button>
  );
}

export interface ExpanderRowProps {
  label: string;
  /** The row itself (name, facts, buttons), drawn after the chevron. */
  row: React.ReactNode;
  /** What is inside, drawn under the row while open. */
  children: React.ReactNode;
  /** Expanders start closed (round 3: "closed by default"). */
  defaultOpen?: boolean;
  className?: string;
}

/** A list row with an expander: closed by default, showing what is inside underneath when opened (UX-5). */
export function ExpanderRow({ label, row, children, defaultOpen = false, className }: ExpanderRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <li className={className}>
      <div className="lrow">
        <ExpanderButton label={label} expanded={open} onToggle={() => setOpen(!open)} controls={bodyId} />
        {row}
      </div>
      {open && (
        <div className="xp-body" id={bodyId}>
          {children}
        </div>
      )}
    </li>
  );
}
