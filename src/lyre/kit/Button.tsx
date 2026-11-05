import React from "react";
import { Icon, type IconName } from "./Icon";
import { cx } from "./cx";

type NativeButton = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">;

export interface ButtonProps extends NativeButton {
  /** primary: the next action (accent); ghost: quiet; danger: deletes or stops for good. */
  variant?: "primary" | "ghost" | "danger";
  /** "s": the 24 px size for rows and pane headers. */
  size?: "s";
  icon?: IconName;
  /** For a button that is on or off: says which to screen readers (aria-pressed). */
  pressed?: boolean;
  type?: "button" | "submit";
}

/** A button with words (ui.css .btn). It is type="button", so it never submits a form by accident. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, pressed, type = "button", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("btn", variant, size, className)}
      aria-pressed={pressed}
      {...rest}
    >
      {icon && <Icon name={icon} size="s" />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<NativeButton, "children" | "aria-label"> {
  icon: IconName;
  /** What the button does, to whom: its accessible name (A11Y-2), e.g. "Play on air: Crypt drips". */
  label: string;
  /** Hover text when it should say more than the name; the name is used otherwise. */
  hint?: string;
  /** A quiet 24 px square (ui.css .closer) for closers and row actions. */
  quiet?: boolean;
  variant?: "primary" | "ghost" | "danger";
  size?: "s";
  pressed?: boolean;
}

/** A button with only an icon. It always has a name, and its hover text says the same (or more). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, hint, quiet, variant, size, pressed, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={quiet ? cx("closer", className) : cx("btn", "icon", variant, size, className)}
      aria-label={label}
      title={hint ?? label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={size === "s" ? "s" : undefined} />
    </button>
  );
});

export interface ToggleButtonProps extends Omit<ButtonProps, "pressed" | "onClick"> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/** A button that is on or off (A11Y-3), e.g. Keys, Loop, Mute. */
export function ToggleButton({ pressed, onPressedChange, ...rest }: ToggleButtonProps) {
  return <Button {...rest} pressed={pressed} onClick={() => onPressedChange(!pressed)} />;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedProps<T extends string> {
  /** Names the group, e.g. "Prep or live", "Show". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "s";
  className?: string;
}

/** A row of buttons of which one is pressed (ui.css .seg), as the prototype's Prep or Live switch and filters. */
export function Segmented<T extends string>({ label, options, value, onChange, size, className }: SegmentedProps<T>) {
  return (
    <div className={cx("seg", size, className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.icon && <Icon name={option.icon} size="s" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
