/**
 * UX-18 (round 6 parts 6 and 7): Back and the trail, the first things in every screen's top bar.
 *
 * Back is a ‹ in a box (Nik, 6 Nov 22:04), always in the same place, top left. Its name and hover say where it goes
 * ("Back to Session 14 (Alt+Left)"). It walks back through one history of places across the whole app (history.ts):
 * every change of address counts, from the menu, a link, a button or a typed address. Back, Alt+Left and the mouse's
 * back button each go one place back, as Nik left it: the scroll positions and the control he used to leave
 * (restore.ts). At the very start of the history Back stays where it is, greyed (aria-disabled, still reachable with
 * Tab), its hover saying why. A screen with nothing in the history may give a fallback (the Audio profile opened by
 * its address goes back to the scene it shows).
 *
 * The trail: the screen's parents as links, right after Back; the screen's own h1 follows as the last part, so its
 * title is not said twice. Long trails are cut in the middle with "…", the whole path on hover (ui.css).
 *
 * Every screen puts `<TopLead />` first in its `.viewhead` (Live in its top strip). The shell provides it
 * (`NavigationProvider`, used by Shell.tsx).
 */
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../kit/Icon";
import { useAnnounce } from "./Announcer";
import { PlaceHistory, placeExists, placeLabel, trailOf, type Crumb, type Place, type PlaceNames } from "./history";
import { controlKey, findControl, findScroller, scrollsOf } from "./restore";

/** Where Back goes when the history has nothing (the Audio profile opened by its address). */
export interface BackFallback {
  label: string;
  /** Goes there (the screen's own way, such as opening the scene in the planner). */
  go: () => void;
}

interface Navigation {
  /** Where Back goes now, or null at the very start of the history. */
  backTo: string | null;
  goBack: (fallback?: BackFallback) => boolean;
  trail: Crumb[];
}

const NavigationContext = createContext<Navigation | null>(null);

/** How long a place that is drawn again may take to show the control and the scroll height it had. */
const RESTORE_WAIT_MS = 5000;

function view(): HTMLElement | null {
  return document.getElementById("view");
}

/**
 * Keeps the history: before the address changes the shell's route (Shell.tsx calls `beforeRouteChange` first, in the
 * same hashchange), the place left goes on top, unless Back is what changed it.
 */
export function useNavigationState(path: string, names?: PlaceNames) {
  const history = useRef(new PlaceHistory());
  const namesRef = useRef(names);
  namesRef.current = names;
  const here = useRef(path);
  /** The place Back is going to: put back as it was once its screen is drawn. */
  const restoring = useRef<Place | null>(null);
  /** The control last used in the work area (its key), for a place left by the menu. */
  const lastControl = useRef("");
  const [, redraw] = useState(0);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const root = view();
      const target = event.target;
      if (root && target instanceof Element && root.contains(target) && target !== root) lastControl.current = controlKey(target, root);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  /** Called with the new address before the screen changes, while the place left is still drawn. */
  const beforeRouteChange = useCallback((to: string) => {
    const from = here.current;
    here.current = to;
    if (from === to) return;
    if (restoring.current?.path === to) return;
    restoring.current = null;
    const root = view();
    const active = document.activeElement;
    const focus = root && active instanceof Element && root.contains(active) && active !== root ? controlKey(active, root) : lastControl.current;
    history.current.leave({ path: from, label: placeLabel(from, namesRef.current), scrolls: root ? scrollsOf(root) : {}, focus }, to);
    lastControl.current = "";
    redraw((n) => n + 1);
  }, []);

  const exists = useCallback((p: string) => placeExists(p, namesRef.current), []);

  const goBack = useCallback(
    (fallback?: BackFallback) => {
      const place = history.current.back(here.current, exists);
      if (!place) {
        if (!fallback) return false;
        fallback.go();
        return true;
      }
      restoring.current = place;
      window.location.hash = `#/${place.path}`;
      redraw((n) => n + 1);
      return true;
    },
    [exists],
  );

  // Once Back's place is the route, put its scroll positions and its control back as they are drawn.
  useLayoutEffect(() => {
    const place = restoring.current;
    if (!place || place.path !== path) return;
    restoring.current = null;
    return restorePlace(place);
  }, [path]);

  const back = history.current.peek(path, exists);
  return { backTo: back ? back.label : null, goBack, beforeRouteChange, trail: trailOf(path, names) };
}

/**
 * Puts a place back as it was: each scrolling box at its position once it is tall enough again, and focus on the
 * control used to leave once it is there. Gives up after a few seconds (the place may have changed since).
 */
function restorePlace(place: Place): () => void {
  const scrolls = new Map(Object.entries(place.scrolls));
  let focusKey = place.focus;
  const step = () => {
    const root = view();
    if (!root) return;
    for (const [key, top] of Array.from(scrolls)) {
      const box = findScroller(key, root);
      if (box && box.scrollHeight - box.clientHeight >= top - 1) {
        box.scrollTop = top;
        scrolls.delete(key);
      }
    }
    if (focusKey) {
      const control = findControl(focusKey, root);
      if (control) {
        control.focus({ preventScroll: true });
        focusKey = "";
      }
    }
    if (scrolls.size === 0 && !focusKey) stop();
  };
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(step);
  const root = view();
  if (observer && root) observer.observe(root, { childList: true, subtree: true, attributes: true });
  const timer = setTimeout(() => stop(), RESTORE_WAIT_MS);
  function stop() {
    observer?.disconnect();
    clearTimeout(timer);
  }
  // After the shell has given the new heading the focus (Shell.tsx), so the control used to leave wins; the screen's
  // own data loads after its first drawing, which the observer catches.
  const frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    stop();
  };
}

export function NavigationProvider({ value, children }: { value: Navigation; children: React.ReactNode }) {
  const { backTo, goBack, trail } = value;
  const memo = useMemo(() => ({ backTo, goBack, trail }), [backTo, goBack, trail]);
  return <NavigationContext.Provider value={memo}>{children}</NavigationContext.Provider>;
}

/** The shell's navigation; outside a shell (a screen's own tests) Back has nowhere to go and the trail follows the address. */
export function useNavigation(): Navigation {
  return useContext(NavigationContext) ?? { backTo: null, goBack: () => false, trail: trailOf(window.location.hash.replace(/^#\/?/, "")) };
}

/** Alt+Left and the mouse's back button do what Back does (not while a menu or a dialog is open). */
export function useBackKeys(goBack: () => boolean): void {
  const go = useRef(goBack);
  go.current = goBack;
  useEffect(() => {
    const busy = () => !!document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]');
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.key !== "ArrowLeft" || event.ctrlKey || event.shiftKey || event.metaKey || event.defaultPrevented || busy()) return;
      if (go.current()) event.preventDefault();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3 && !busy() && go.current()) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}

const NOTHING_YET = "Nothing to go back to yet: this is the first screen since Lyre opened";

/**
 * Back and the trail, first in a screen's top bar. `fallback`: where Back goes while the history is empty. `trail`:
 * the screen's parents when the shell cannot work them out from the address (Live's campaign and session).
 */
export function TopLead({ fallback, trail: own }: { fallback?: BackFallback; trail?: Crumb[] }) {
  const { backTo, goBack, trail: fromRoute } = useNavigation();
  const { say } = useAnnounce();
  const trail = own ?? fromRoute;
  const to = backTo ?? fallback?.label ?? null;
  // Alt+Left uses this screen's fallback too.
  fallbackNow.current = fallback;
  return (
    <>
      {to === null ? (
        <button type="button" className="btn icon nav-back" aria-label="Back" aria-disabled="true" title={NOTHING_YET} onClick={() => say("Nothing to go back to yet")}>
          <Icon name="chevleft" />
        </button>
      ) : (
        <button
          type="button"
          className="btn icon nav-back"
          aria-label={`Back to ${to}`}
          aria-keyshortcuts="Alt+ArrowLeft"
          title={`Back to ${to} (Alt+Left)`}
          onClick={() => {
            if (goBack(fallback)) say(`Back to ${to}`);
          }}
        >
          <Icon name="chevleft" />
        </button>
      )}
      <Trail parents={trail} />
    </>
  );
}

/** The fallback of the screen showing now, for Alt+Left and the mouse's back button. */
export const fallbackNow: { current: BackFallback | undefined } = { current: undefined };

/** The screen's parents, then (after them, in the bar) its h1. The whole path is the hover text. */
function Trail({ parents }: { parents: Crumb[] }) {
  const ref = useRef<HTMLElement>(null);
  const [title, setTitle] = useState("");
  // The last part is the screen's h1, which comes after the trail and may arrive once the screen's data has loaded.
  useLayoutEffect(() => {
    const head = ref.current?.closest(".viewhead, .lv-top");
    if (!head) return;
    const read = () => setTitle(head.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "");
    read();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(read);
    observer.observe(head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [parents.length]);
  if (parents.length === 0) return null;
  const n = parents.length;
  const full = [...parents.map((p) => p.label), ...(title ? [title] : [])].join(" › ");
  const names = (list: Crumb[]) => list.map((p) => p.label).join(" › ");
  return (
    <nav className="crumbs" aria-label="Breadcrumb" title={full} ref={ref}>
      <ol>
        {parents.map((crumb, i) => {
          const last = i === n - 1;
          return (
            <React.Fragment key={crumb.href}>
              {last && n > 1 && (
                <li className={n > 2 ? "c-gap on" : "c-gap"} title={full}>
                  <span aria-hidden="true">…</span>
                  <span className="sr-only g-cut">{names(parents.slice(1, -1))}</span>
                  <span className="sr-only g-mid">{names(parents.slice(0, -1))}</span>
                  <span className="sep" aria-hidden="true">
                    ›
                  </span>
                </li>
              )}
              <li className={last ? "crumb" : n > 2 && i > 0 ? "crumb c-cut" : "crumb c-mid"}>
                <a href={crumb.href}>
                  <span className="ellipsis" title={crumb.label}>
                    {crumb.label}
                  </span>
                </a>
                <span className="sep" aria-hidden="true">
                  ›
                </span>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
