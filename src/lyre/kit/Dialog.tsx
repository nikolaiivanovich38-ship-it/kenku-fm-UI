import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";

export interface DialogProps {
  open: boolean;
  title: string;
  /** Escape, the Close button and a click outside call this; the dialog closes when `open` turns false. */
  onClose: () => void;
  footer?: React.ReactNode;
  /** 900 px wide instead of 640 (pickers with long rows). */
  wide?: boolean;
  /** Round 6: how-to words read out with the dialog (its description) instead of shown above its content. */
  description?: React.ReactNode;
  /** UX-R20: Enter in a one-line text field presses the footer's main button (Rename, Add tag…). */
  enterSubmits?: boolean;
  children: React.ReactNode;
}

const FIRST_IN_BODY = ".body input:not([disabled]), .body select:not([disabled]), .body textarea:not([disabled]), .body button:not([disabled])";
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet (ui.css .sheet) for prep screens only: the live view never covers its controls. Focus goes to its
 * first field (or first button), Tab stays inside, and focus returns to what opened it when it closes.
 */
export function Dialog({ open, title, onClose, footer, wide, description, enterSubmits, children }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // UX-R1: the first control that can take focus; a greyed one (the first step's Move up) is skipped.
    const first = panel?.querySelector<HTMLElement>(FIRST_IN_BODY) ?? panel?.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus();
    return () => {
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (enterSubmits && event.key === "Enter" && !event.shiftKey && event.target instanceof HTMLInputElement && /^(text|search|)$/.test(event.target.type)) {
      const main = panelRef.current?.querySelector<HTMLButtonElement>("footer .btn.primary:not([disabled])");
      if (main) {
        event.preventDefault();
        main.click();
      }
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="sheet"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        style={wide ? { width: "min(900px, 100%)" } : undefined}
        onKeyDown={onKeyDown}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" label="Close" quiet onClick={() => onCloseRef.current()} />
        </header>
        {description && (
          <p className="sr-only" id={descId}>
            {description}
          </p>
        )}
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
