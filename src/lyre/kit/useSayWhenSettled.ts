import { useEffect, useRef } from "react";
import { useAnnounce } from "../shell/Announcer";

/** How long typing must pause before a count is read out. */
export const SETTLE_MS = 500;

/**
 * UX-R7: a result count that changes on every key press (Add tracks, Find) is shown at once but read out only once
 * typing pauses, through the page's live region. The first value (the box just opened) is not read out; nor is
 * null (nothing to say).
 */
export function useSayWhenSettled(text: string | null, ms = SETTLE_MS): void {
  const { say } = useAnnounce();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!text) return;
    const timer = setTimeout(() => say(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms, say]);
}
