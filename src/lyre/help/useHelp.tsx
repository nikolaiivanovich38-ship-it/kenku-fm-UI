/**
 * FND-8: Help and the tour in the shell. The shell calls `useHelp` once and places what it gives: the Help button's
 * state for the rail, the panel on the side-panel host (beside the screen, round 10) and the tour over the page.
 *
 * - F1 opens Help from any screen. It is listened for on the window, so it runs after every screen's own key
 *   handlers (on the document): a Live pad on F1 takes the key and plays instead.
 * - Opening Help puts focus in its search box; closing it gives focus back to where it was (or the Help button).
 * - The tour shows on the first start of the Lyre tab when the page asks for it (`firstRunTour`: the app's page
 *   root does, tests of other parts do not), once: finished or skipped, it is remembered in the shell settings
 *   (`tour: "done"`). Help › Take the tour plays it again.
 */
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShellSettings } from "../shell/ShellSettings";
import type { DiagnosticsBridge } from "../../common/lyreDiagnostics";
import { HelpPanel } from "./HelpPanel";
import { TOUR_STEPS, Tour, type TourStep } from "./Tour";
import { stepsOnScreen, TOURS, type TourKey, type TourPlaces } from "./tours";

/** How long a screen's tour waits for its screen's controls after going there. */
const TOUR_WAIT_MS = 1500;

/** The rail's Help button, for focus to come back to. */
export const HELP_BUTTON_ID = "rail-help";

/** Opens Help's panel from a screen (Live's Keys has Help at its foot, R6 review Should 12). The shell provides it. */
export const OpenHelpContext = createContext<(() => void) | null>(null);
export function useOpenHelp(): (() => void) | null {
  return useContext(OpenHelpContext);
}

export interface HelpInShell {
  helpOpen: boolean;
  toggleHelp: () => void;
  openHelp: () => void;
  /** The side panel's content, or null while Help is closed. The shell shows it on the side-panel host. */
  panel: React.ReactNode;
  /** Round 10: the host closed Help to keep the screen's room (another panel opened): focus stays where it is. */
  closedByHost: () => void;
  /** The tour's popover, or null. */
  tour: React.ReactNode;
  /** Round 10: start a screen's tour (Help's Tour of this screen, Set up Lyre's Show me). */
  startScreenTour: (key: TourKey, places: TourPlaces | "here") => void;
}

/** The page's Save diagnostics, when it runs in Lyre (src/lyre/preload.ts). */
function pageDiagnostics(): DiagnosticsBridge | null {
  return (typeof window !== "undefined" && (window as { lyre?: { diagnostics?: DiagnosticsBridge } }).lyre?.diagnostics) || null;
}

export function useHelp({ firstRunTour = false }: { firstRunTour?: boolean } = {}): HelpInShell {
  const { settings, update } = useShellSettings();
  const [helpOpen, setHelpOpen] = useState(false);
  const [step, setStep] = useState(() => (firstRunTour && settings.tour !== "done" ? 0 : -1));
  const replay = useRef(false);
  const returnTo = useRef<Element | null>(null);
  /** Focus to give once the next render is on screen. */
  const focusAfter = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const give = focusAfter.current;
    focusAfter.current = null;
    give?.();
  });

  const openHelp = useCallback(() => {
    if (helpOpen) {
      document.querySelector<HTMLInputElement>("#lyre-help input[type=search]")?.focus();
      return;
    }
    returnTo.current = document.activeElement;
    setHelpOpen(true);
  }, [helpOpen]);

  const closeHelp = useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    focusAfter.current = () => {
      if (back instanceof HTMLElement && back !== document.body && document.contains(back)) back.focus();
      else document.getElementById(HELP_BUTTON_ID)?.focus();
    };
    setHelpOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1" || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      openHelp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openHelp]);

  // Round 10: a screen's tour: its name and the steps whose controls are on screen.
  const [guide, setGuide] = useState<{ name: string; steps: TourStep[]; step: number } | null>(null);
  const startScreenTour = useCallback((key: TourKey, places: TourPlaces | "here") => {
    const def = TOURS[key];
    returnTo.current = null;
    setHelpOpen(false);
    // "here": Tour of this screen stays on the screen Help was opened from.
    const to = places === "here" ? "" : def.route(places);
    if (to && window.location.hash !== to) window.location.hash = to;
    // The screen draws its controls once its data has loaded: wait for them, then point at those that are there.
    const started = Date.now();
    const look = () => {
      const steps = stepsOnScreen(def);
      if (steps.length === def.steps.length || (steps.length > 0 && Date.now() - started > TOUR_WAIT_MS)) setGuide({ name: def.name, steps, step: 0 });
      else if (Date.now() - started <= TOUR_WAIT_MS) setTimeout(look, 100);
    };
    setTimeout(look, 60);
  }, []);
  const endGuide = useCallback(() => {
    focusAfter.current = () => document.getElementById(HELP_BUTTON_ID)?.focus();
    setGuide(null);
  }, []);

  const startTour = useCallback(() => {
    replay.current = true;
    returnTo.current = null;
    setHelpOpen(false);
    setStep(0);
  }, []);

  const endTour = useCallback(() => {
    const replayed = replay.current;
    replay.current = false;
    focusAfter.current = () => {
      if (replayed) {
        document.getElementById(HELP_BUTTON_ID)?.focus();
        return;
      }
      const heading = document.querySelector<HTMLElement>("#view h1");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
    };
    setStep(-1);
    if (settings.tour !== "done") update({ tour: "done" });
  }, [settings.tour, update]);
  // Round 10 (Nik, 18 Nov 03:14, answer 5b): the first start's tour ends in Help, at Set up Lyre.
  const finishTour = useCallback(() => {
    const first = !replay.current && settings.tour !== "done";
    endTour();
    if (first) {
      focusAfter.current = null;
      returnTo.current = document.getElementById(HELP_BUTTON_ID);
      setHelpOpen(true);
    }
  }, [endTour, settings.tour]);

  return {
    helpOpen,
    toggleHelp: () => (helpOpen ? closeHelp() : openHelp()),
    openHelp,
    closedByHost: () => {
      returnTo.current = null;
      setHelpOpen(false);
    },
    panel: helpOpen ? <HelpPanel onClose={closeHelp} onTour={startTour} onScreenTour={startScreenTour} diagnostics={pageDiagnostics()} /> : null,
    startScreenTour,
    tour: guide ? (
      <Tour
        step={guide.step}
        steps={guide.steps}
        name={guide.name}
        onBack={() => setGuide({ ...guide, step: Math.max(0, guide.step - 1) })}
        onNext={() => (guide.step >= guide.steps.length - 1 ? endGuide() : setGuide({ ...guide, step: guide.step + 1 }))}
        onSkip={endGuide}
      />
    ) : step < 0 ? null : (
      <Tour
        step={step}
        onBack={() => setStep((s) => Math.max(0, s - 1))}
        onNext={() => (step >= TOUR_STEPS.length - 1 ? finishTour() : setStep(step + 1))}
        onSkip={endTour}
      />
    ),
  };
}
