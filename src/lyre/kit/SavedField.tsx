/**
 * UX-19 (round 6 part 5): a text field or text area that saves itself the way every field in Lyre does: on Enter
 * (a one-line field), on leaving it, or after a second without typing; never per key. It keeps what is typed while
 * the library saves it, so a reload never moves the cursor, and takes the library's value again when it is not
 * being edited. The screen's `onSave` writes through `useSave` (shell/useSave.ts), which shows the Saved pop-up.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

/** How long typing rests before the field is saved (one undo step and one pop-up per pause, not per letter). */
export const SAVE_AFTER_MS = 1000;

export type SavedFieldProps = {
  value: string;
  /** Saves the text (a LyreApi write); called after a pause in typing, on Enter, on leaving the field and when it goes away. */
  onSave: (value: string) => void;
  /** Called on every change, before saving (to show the new text elsewhere at once). */
  onDraft?: (value: string) => void;
  multiline?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "defaultValue">;

export const SavedField = React.forwardRef<HTMLInputElement & HTMLTextAreaElement, SavedFieldProps>(function SavedField(
  { value, onSave, onDraft, multiline, onBlur, onKeyDown, ...rest },
  ref,
) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const unsaved = useRef<string | null>(null);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (unsaved.current !== null) {
      const text = unsaved.current;
      unsaved.current = null;
      save.current(text);
    }
  }, []);
  useEffect(() => {
    if (!editing.current && unsaved.current === null) setDraft(value);
  }, [value]);
  useEffect(() => flush, [flush]);

  const props = {
    ...rest,
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      editing.current = true;
      setDraft(event.target.value);
      onDraft?.(event.target.value);
      unsaved.current = event.target.value;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !multiline && !event.nativeEvent.isComposing) flush();
      onKeyDown?.(event);
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      editing.current = false;
      flush();
      onBlur?.(event);
    },
  };
  return multiline ? <textarea ref={ref} {...props} /> : <input ref={ref} {...props} />;
});
