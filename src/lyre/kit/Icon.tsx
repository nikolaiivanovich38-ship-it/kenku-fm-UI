import React from "react";
import { ICONS, type IconName } from "./icons";
import { cx } from "./cx";

export type { IconName };

/** Every icon's name, for checks and pickers. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** "s" 14 px, "l" 20 px; 16 px when left out. */
  size?: "s" | "l";
  className?: string;
}

/**
 * An icon. Always decoration: the control or text beside it says what it means (A11Y-2), so screen readers skip it.
 */
export function Icon({ name, size, className }: IconProps) {
  return (
    <svg className={cx("i", size, className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The Lyre mark (fern-gully lyre), as drawn at the top of the rail. Decoration: the word "Lyre" sits beside it. */
export function LyreLogo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#142B24" />
      <path d="M26 24V48M38 24V48" fill="none" stroke="#F1E4C8" strokeWidth="4" />
      <g fill="#D9A441">
        <path d="M25 53C14 48.5 8 37 10.8 25.5C12.2 19.5 11 15.5 5.6 13.6C4.4 13.2 4.6 10 6.4 9.8C15 9 20.2 15.5 18.6 24.8C17.2 34 21 42.5 30 48Z" />
        <path transform="matrix(-1 0 0 1 64 0)" d="M25 53C14 48.5 8 37 10.8 25.5C12.2 19.5 11 15.5 5.6 13.6C4.4 13.2 4.6 10 6.4 9.8C15 9 20.2 15.5 18.6 24.8C17.2 34 21 42.5 30 48Z" />
        <rect x="12" y="20" width="40" height="4" />
      </g>
      <rect x="20" y="48" width="24" height="8" rx="2" fill="#C0582F" />
    </svg>
  );
}
