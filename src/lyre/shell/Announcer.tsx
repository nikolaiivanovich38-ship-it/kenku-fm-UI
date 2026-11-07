import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { NOT_SAVED } from "../../common/lyre/api";
import { Icon } from "../kit/Icon";
import { NoteRules, noteDuration, savedText } from "./savedModel";

export interface SavedOptions {
  /** What was saved, when two saves of the same thing word it differently (a field's id); the words by default. */
  key?: string;
  /** More after " · ": what a drop brought in. */
  detail?: string;
}

interface Announce {
  /** Tell screen-reader users something that happened (the polite live region, out of sight). */
  say: (text: string) => void;
  /** Show a short note in the corner for about three seconds (also read by screen readers): Undone, a warning. */
  toast: (text: string, options?: { key?: string }) => void;
  /** UX-19: something was saved. "Saved: <what>" in the one pop-up (see the provider). */
  saved: (what: string, options?: SavedOptions) => void;
  /** UX-19: a save failed. A card that stays, with Try again (which calls `retry`) and Dismiss. */
  saveFailed: (what: string, retry: () => void) => void;
}

const AnnouncerContext = createContext<Announce>({ say: () => undefined, toast: () => undefined, saved: () => undefined, saveFailed: () => undefined });

/** The live region is emptied first and filled a moment later, so the same words twice are read twice. */
const SAY_DELAY_MS = 30;
/** After a note that is not read out, the pop-up is read out again from this long on. */
const QUIET_FOR_MS = 150;
/** The pop-up's distance from the work area's right edge and from its bottom (or from the Now playing bar). */
const CORNER_PX = 12;

/** Where the Undo note goes: the lowest place in the pop-up's corner (shell/UndoNote.tsx). */
export const UNDO_SLOT_ID = "lyre-undo-slot";

interface Note {
  text: string;
  saved: boolean;
  /** Counts refreshes of the same save, so the tick pulses once each time. */
  pulse: number;
}

/**
 * A11Y-3: the page's one polite live region, and (UX-19, round 6 parts 5 and 6, ROUND6.md "The standard") the one
 * pop-up for every save and short note, the prototype's L.say, L.toast, L.saved and L.saveFailed.
 *
 * The pop-up sits at the bottom right of the work area, 12 px in and 12 px up, or 12 px above the Now playing bar;
 * above a field in use that it would cover. The Undo note sits lowest in the same corner, then a failed save, then
 * the pop-up. It is a status that is always in the page and empty when nothing shows, so screen readers read it once
 * when it fills; the same save again within 2 s refreshes it without a second reading. A failed save is an alert
 * that stays until Try again or Dismiss. Nothing here takes focus; Try again and Dismiss put it back where it was.
 */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [spoken, setSpoken] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [readOut, setReadOut] = useState(true);
  const [fail, setFail] = useState<{ what: string; retry: () => void } | null>(null);
  const failRef = useRef(fail);
  failRef.current = fail;
  const rules = useRef(new NoteRules());
  const timers = useRef<{ say?: ReturnType<typeof setTimeout>; note?: ReturnType<typeof setTimeout>; quiet?: ReturnType<typeof setTimeout> }>({});
  const box = useRef<HTMLDivElement>(null);
  /** The control in use before Tab reached Try again or Dismiss. */
  const beforeCard = useRef<HTMLElement | null>(null);

  const say = useCallback((text: string) => {
    rules.current.said(Date.now());
    setSpoken("");
    clearTimeout(timers.current.say);
    timers.current.say = setTimeout(() => setSpoken(text), SAY_DELAY_MS);
  }, []);

  const show = useCallback((text: string, key: string, saved: boolean) => {
    const rule = rules.current.show(key, Date.now());
    setNote((was) => ({ text, saved, pulse: rule.refresh && was ? was.pulse + 1 : 0 }));
    setReadOut(rule.readOut);
    clearTimeout(timers.current.quiet);
    if (!rule.readOut) timers.current.quiet = setTimeout(() => setReadOut(true), QUIET_FOR_MS);
    clearTimeout(timers.current.note);
    timers.current.note = setTimeout(() => {
      rules.current.hidden();
      setNote(null);
    }, noteDuration(text));
  }, []);

  const toast = useCallback((text: string, options?: { key?: string }) => show(text, options?.key ?? text, false), [show]);
  const saved = useCallback(
    (what: string, options: SavedOptions = {}) => {
      // The same thing saved after all: its failure card goes.
      if (failRef.current?.what === what) setFail(null);
      show(savedText(what, options.detail), `saved:${options.key ?? what}`, true);
    },
    [show],
  );
  const saveFailed = useCallback((what: string, retry: () => void) => setFail({ what, retry }), []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      clearTimeout(pending.say);
      clearTimeout(pending.note);
      clearTimeout(pending.quiet);
    };
  }, []);

  // Remember the control in use (outside the corner), so focus can go back there from Try again or Dismiss.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !box.current?.contains(event.target)) beforeCard.current = event.target;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const backToWork = () => {
    const back = beforeCard.current;
    const active = document.activeElement;
    if ((!active || active === document.body || box.current?.contains(active)) && back && document.contains(back)) back.focus();
  };

  // The corner: measured from the work area and the Now playing bar each time something shows, and on resize.
  useLayoutEffect(() => {
    const place = () => placeCorner(box.current);
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [note, fail]);

  const value = useMemo(() => ({ say, toast, saved, saveFailed }), [say, toast, saved, saveFailed]);
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div id="lyre-live" className="sr-only" aria-live="polite">
        {spoken}
      </div>
      <div id="lyre-toasts" className="toasts" ref={box}>
        <div id="lyre-toast" className={note?.saved ? "toast t-saved" : "toast"} role="status" aria-live={readOut ? "polite" : "off"} aria-atomic="true">
          {note && (
            <>
              {note.saved && (
                // A new key restarts the pulse on each refresh (no pulse with reduced motion: ui.css).
                <span key={note.pulse} className={note.pulse ? "t-tick t-again" : "t-tick"} aria-hidden="true">
                  <Icon name="check" size="s" />
                </span>
              )}
              <span>
                {note.saved ? (
                  <>
                    <b>Saved:</b> {note.text.replace(/^Saved: /, "")}
                  </>
                ) : (
                  note.text
                )}
              </span>
            </>
          )}
        </div>
        <div id="lyre-fail" className={fail ? "toast t-fail" : "toast"} role="alert">
          {fail && (
            <>
              <Icon name="warn" size="s" />
              <div className="grow">
                <b>Not saved: {fail.what}</b> <span>{NOT_SAVED}</span>
              </div>
              <button
                type="button"
                className="btn s"
                onClick={() => {
                  setFail(null);
                  backToWork();
                  fail.retry();
                }}
              >
                Try again
              </button>
              <button
                type="button"
                className="closer"
                aria-label={`Dismiss: not saved: ${fail.what}`}
                title="Dismiss"
                onClick={() => {
                  setFail(null);
                  backToWork();
                }}
              >
                <Icon name="close" />
              </button>
            </>
          )}
        </div>
        <div id={UNDO_SLOT_ID} className="undo-slot" />
      </div>
    </AnnouncerContext.Provider>
  );
}

/**
 * Puts the corner at the bottom right of the work area (#view), above the Now playing bar when it shows, and just
 * above the field or button in use if it would cover it. Outside a shell (a component test) it stays where ui.css
 * puts it.
 */
function placeCorner(box: HTMLElement | null): void {
  const view = document.getElementById("view");
  if (!box || !view) return;
  const area = view.getBoundingClientRect();
  if (area.width === 0) return;
  const bar = view.querySelector<HTMLElement>(".onairbar");
  const floor = bar && bar.offsetParent ? bar.getBoundingClientRect().top : area.bottom;
  box.style.right = `${Math.round(window.innerWidth - area.right + CORNER_PX)}px`;
  box.style.maxWidth = `${Math.max(160, Math.min(400, area.width - 2 * CORNER_PX))}px`;
  box.style.bottom = `${Math.round(window.innerHeight - floor + CORNER_PX)}px`;
  const active = document.activeElement;
  const shown = box.getBoundingClientRect();
  if (active instanceof HTMLElement && active !== document.body && !box.contains(active) && view.contains(active) && shown.height > 0) {
    const at = active.getBoundingClientRect();
    if (at.left < shown.right && at.right > shown.left && at.top < shown.bottom && at.bottom > shown.top) {
      box.style.bottom = `${Math.round(window.innerHeight - at.top + 8)}px`;
    }
  }
}

export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}
