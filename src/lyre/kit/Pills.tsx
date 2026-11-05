import React from "react";
import { Icon } from "./Icon";
import { cx } from "./cx";

export type StatusTone = "live" | "on" | "idle" | "warn";

/** A box's one status pill (ui.css .pane-status): live = the players hear it, on = ready, warn = needs you. */
export function StatusPill({ text, tone = "idle" }: { text: string; tone?: StatusTone }) {
  return <span className={cx("pane-status", `s-${tone}`)}>{text}</span>;
}

/** A small label: "On air" (onair), a count or "New" (accent). */
export function Badge({ tone, children }: { tone?: "onair" | "accent"; children: React.ReactNode }) {
  return <span className={cx("badge", tone)}>{children}</span>;
}

/** A key on the keyboard, e.g. Space. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Tag groups keep their dot colour; lanes colour the chip (music, ambience, effects); accent marks a choice. */
export type ChipGroup = "mood" | "motif" | "scene";
export type ChipLane = "music" | "amb" | "fx" | "accent";

export interface ChipProps {
  group?: ChipGroup;
  lane?: ChipLane;
  /** Hover text, e.g. the tag group's name. */
  title?: string;
  /** Shows a remove button named "Remove <text>". */
  onRemove?: () => void;
  /** The remove button's name when the chip's text is not plain words. */
  removeLabel?: string;
  children: React.ReactNode;
}

/** A tag or a short fact (ui.css .chip). */
export function Chip({ group, lane, title, onRemove, removeLabel, children }: ChipProps) {
  return (
    <span className={cx("chip", group, lane)} title={title}>
      {group && <span className="dot" />}
      {children}
      {onRemove && (
        <button
          type="button"
          className="x"
          aria-label={removeLabel ?? `Remove ${typeof children === "string" ? children : "tag"}`}
          title={removeLabel ?? `Remove ${typeof children === "string" ? children : "tag"}`}
          onClick={onRemove}
        >
          <Icon name="close" size="s" />
        </button>
      )}
    </span>
  );
}

export interface ChipButtonProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  group?: ChipGroup;
  lane?: ChipLane;
  children: React.ReactNode;
}

/** A chip you press to filter by it; it says whether it is on (aria-pressed). */
export function ChipButton({ pressed, onPressedChange, group, lane, children }: ChipButtonProps) {
  return (
    <button type="button" className={cx("chip", group, lane)} aria-pressed={pressed} onClick={() => onPressedChange(!pressed)}>
      {group && <span className="dot" />}
      {children}
    </button>
  );
}

/** How much energy a track has, 0 to 5, as five bars; screen readers hear "Energy 3 of 5". */
export function EnergyMeter({ value }: { value: number }) {
  const level = Math.max(0, Math.min(5, Math.round(value || 0)));
  return (
    <span className="energy" role="img" aria-label={`Energy ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((bar) => (
        <span key={bar} className={bar <= level ? "on" : undefined} />
      ))}
    </span>
  );
}

