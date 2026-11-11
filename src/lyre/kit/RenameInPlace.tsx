/**
 * EDT-1, BUG-18: renaming in place. A name shown in a list (a session, a scene) turns into a text box where it is:
 * double-click the name, press F2 on it, or choose Rename in its ⋯ menu (Enter there). Enter saves, Esc cancels;
 * leaving the box saves too, as a file manager does. An empty name or an unchanged one saves nothing. Focus goes back
 * to the name afterwards, so keyboard users stay where they were.
 *
 * - `useRenameInPlace()` keeps whether the name is being edited and where focus goes back to.
 * - `renameKeys(start)` gives the F2 handler for the name's own control (a link or a button keeps its Enter).
 * - `<RenameField>` is the box.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface RenameInPlace {
  editing: boolean;
  /** Start editing; focus comes back to `returnTo` (or what had focus) when done. */
  start: (returnTo?: HTMLElement | null) => void;
  /** Stop editing (after a save or Esc) and put focus back. */
  done: () => void;
}

export function useRenameInPlace(): RenameInPlace {
  const [editing, setEditing] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const [refocus, setRefocus] = useState(0);
  const start = useCallback((to?: HTMLElement | null) => {
    returnTo.current = to ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setEditing(true);
  }, []);
  const done = useCallback(() => {
    setEditing(false);
    setRefocus((n) => n + 1);
  }, []);
  // After the box has gone and the name is drawn again: the control that shows it may be a new element.
  useEffect(() => {
    if (!refocus) return;
    const target = returnTo.current;
    if (target?.isConnected) target.focus();
    else if (target?.dataset.k) document.querySelector<HTMLElement>(`[data-k="${target.dataset.k}"]`)?.focus();
  }, [refocus]);
  return { editing, start, done };
}

/** F2 on the name's control starts editing it. */
export function renameKeys(start: (returnTo?: HTMLElement | null) => void) {
  return (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "F2" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      start(event.currentTarget);
    }
  };
}

export interface RenameFieldProps {
  value: string;
  /** The box's accessible name, e.g. "Name of Session 14". */
  label: string;
  /** Called with the new name (trimmed, not empty, changed). */
  onSave: (name: string) => void;
  onDone: () => void;
  className?: string;
  placeholder?: string;
}

export function RenameField({ value, label, onSave, onDone, className, placeholder }: RenameFieldProps) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  // Enter and Esc finish before the box loses focus; the blur that follows must not save again.
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const name = text.trim();
    if (save && name && name !== value) onSave(name);
    onDone();
  };
  return (
    <input
      ref={input}
      className={className ?? "input"}
      type="text"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          // Esc cancels here only: it must not also close a sheet or reach the page's own keys.
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      // A click in the box must not reach the row (fold a scene, open a session).
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

/** How long a click on a name waits for a second click before it does its usual job (open, fold). */
export const DOUBLE_CLICK_MS = 300;
