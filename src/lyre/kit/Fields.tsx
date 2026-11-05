import React, { useId } from "react";
import { Icon } from "./Icon";
import { cx } from "./cx";

export interface SearchFieldProps {
  /** The field's name for screen readers, e.g. "Search the library". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** A search box with its magnifier (ui.css .search). Escape empties it. */
export function SearchField({ label, value, onChange, placeholder = "Search", className, autoFocus, inputRef }: SearchFieldProps) {
  return (
    <div className={cx("search", className)}>
      <Icon name="search" />
      <input
        ref={inputRef}
        className="input"
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
      />
    </div>
  );
}

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** A text field with its label above it (ui.css .field). */
export function TextField({ label, value, onChange, className, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <div className={cx("field", className)}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Leave the label out of sight when the screen around it already says what it is. */
  hideLabel?: boolean;
  className?: string;
}

/** A choice from a list: a native select, so it works the same with the keyboard and every screen reader. */
export function Select<T extends string>({ label, value, options, onChange, hideLabel, className }: SelectProps<T>) {
  const id = useId();
  return (
    <div className={cx("field", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** The value in words for screen readers (and beside the slider with showValue), e.g. "80%", "1:32". */
  valueText?: (value: number) => string;
  showValue?: boolean;
  hideLabel?: boolean;
  className?: string;
}

/** A slider (range input) that arrow keys, Page Up/Down, Home and End move, and that reads its value in words. */
export function Slider({ label, value, min, max, step = 1, onChange, valueText, showValue, hideLabel, className }: SliderProps) {
  const id = useId();
  const text = valueText ? valueText(value) : String(value);
  return (
    <div className={cx("field", className)}>
      {!hideLabel && <label htmlFor={id}>{label}</label>}
      <div className="slider-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={hideLabel ? label : undefined}
          aria-valuetext={text}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {showValue && (
          <span className="num muted" aria-hidden="true">
            {text}
          </span>
        )}
      </div>
    </div>
  );
}
