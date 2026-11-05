import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface Announce {
  /** Tell screen-reader users something that happened (the polite live region, out of sight). */
  say: (text: string) => void;
  /** Show a short note at the bottom of the page for about two seconds (also read by screen readers). */
  toast: (text: string) => void;
}

const AnnouncerContext = createContext<Announce>({ say: () => undefined, toast: () => undefined });

/** How long a toast stays, as in the prototype. */
const TOAST_MS = 2200;
/** The live region is emptied first and filled a moment later, so the same words twice are read twice. */
const SAY_DELAY_MS = 30;

/** A11Y-3: the page's one polite live region and its toast (the prototype's L.say and L.toast). */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [spoken, setSpoken] = useState("");
  const [note, setNote] = useState("");
  const timers = useRef<{ say?: ReturnType<typeof setTimeout>; toast?: ReturnType<typeof setTimeout> }>({});

  const say = useCallback((text: string) => {
    setSpoken("");
    clearTimeout(timers.current.say);
    timers.current.say = setTimeout(() => setSpoken(text), SAY_DELAY_MS);
  }, []);
  const toast = useCallback((text: string) => {
    setNote(text);
    clearTimeout(timers.current.toast);
    timers.current.toast = setTimeout(() => setNote(""), TOAST_MS);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      clearTimeout(pending.say);
      clearTimeout(pending.toast);
    };
  }, []);

  const value = useMemo(() => ({ say, toast }), [say, toast]);
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div id="lyre-live" className="sr-only" aria-live="polite">
        {spoken}
      </div>
      <div id="lyre-toast" className="toast" role="status" hidden={note === ""}>
        {note}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}
