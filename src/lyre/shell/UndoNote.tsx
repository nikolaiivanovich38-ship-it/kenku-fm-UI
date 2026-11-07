/**
 * Undo for changes that remove or reset much at once (w3-ux 10): Reset to whole track, Delete board, Delete scene and
 * Tag… on many tracks. A screen calls `offer(text, undoLabel)` with the write's undoLabel; the message shows what
 * happened, with Undo and a close button, like the board's resize message, until another replaces it or it is closed.
 * Undo undoes the library's last step only while that step is still this change (its undoLabel), as the board does.
 *
 * Ctrl+Z undoes the library's last change from any prep screen (not while typing, not in a sheet, not on Live, which
 * has its own). The library's history comes from ShellData.history (AppProviders); without it nothing is offered.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isRefused } from "../../common/lyre/api";
import { Icon } from "../kit/Icon";
import { UNDO_SLOT_ID, useAnnounce } from "./Announcer";
import { useShellData } from "./ShellData";

interface Note {
  text: string;
  undoLabel: string;
}

interface UndoNoteApi {
  /** Show what happened with Undo; `undoLabel` is the write's (no message when it made no undo step). */
  offer: (text: string, undoLabel: string | null) => void;
}

const UndoNoteContext = createContext<{ api: UndoNoteApi; note: Note | null; undo: () => void; close: () => void }>({
  api: { offer: () => undefined },
  note: null,
  undo: () => undefined,
  close: () => undefined,
});

export function useUndoNote(): UndoNoteApi {
  return useContext(UndoNoteContext).api;
}

const STALE = "That cannot be undone here any more: something else changed since.";

function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>("#view h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function UndoNoteProvider({ live, children }: { live: boolean; children: React.ReactNode }) {
  const { history } = useShellData();
  const { toast } = useAnnounce();
  const [note, setNote] = useState<Note | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  const offer = useCallback(
    (text: string, undoLabel: string | null) => {
      if (history && undoLabel) setNote({ text, undoLabel });
    },
    [history],
  );

  /** Undo the library's last step; with `expected`, only while that step is still the one named. */
  const undoLast = useCallback(
    async (expected?: string) => {
      if (!history) return;
      const state = await history.state().catch((): null => null);
      if (expected !== undefined && state?.undoLabel !== expected) {
        toast(STALE);
        return;
      }
      if (!state?.canUndo) {
        toast("Nothing to undo.");
        return;
      }
      const result = await history.undo();
      if (isRefused(result)) toast(result.refusal.message);
      else toast(`Undone: ${result.value.undone}`);
    },
    [history, toast],
  );

  const undo = useCallback(() => {
    const current = noteRef.current;
    if (!current) return;
    setNote(null);
    focusHeading();
    void undoLast(current.undoLabel);
  }, [undoLast]);
  const close = useCallback(() => {
    setNote(null);
    focusHeading();
  }, []);

  useEffect(() => {
    if (!history || live) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return;
      if (event.defaultPrevented || isTyping(event.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      if (noteRef.current) undo();
      else void undoLast();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [history, live, undo, undoLast]);

  const value = useMemo(() => ({ api: { offer }, note, undo, close }), [offer, note, undo, close]);
  return <UndoNoteContext.Provider value={value}>{children}</UndoNoteContext.Provider>;
}

/**
 * The message itself, in the Saved pop-up's corner, lowest there (UX-19, round 6 part 6), or where it is put when
 * the page has no corner (a component test).
 */
export function UndoNoteBar() {
  const { note, undo, close } = useContext(UndoNoteContext);
  if (!note) return null;
  const slot = document.getElementById(UNDO_SLOT_ID);
  const bar = (
    <div className="undo-note" role="group" aria-label="Undo">
      <Icon name="check" size="s" />
      <span className="grow">{note.text}</span>
      <button type="button" className="btn s" onClick={undo}>
        Undo
      </button>
      <button type="button" className="closer" title="Dismiss" aria-label="Dismiss message" onClick={close}>
        <Icon name="close" />
      </button>
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}
