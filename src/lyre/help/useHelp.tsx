/**
 * FND-8: Help and the tour in the shell. The shell calls `useHelp` once and places what it gives: the Help button's
 * state for the rail, the panel inside #app (beside the screen) and the tour over the page.
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
import { TOUR_STEPS, Tour } from "./Tour";

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
  /** The side panel, or null while Help is closed. */
  panel: React.ReactNode;
  /** The tour's popover, or null. */
  tour: React.ReactNode;
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

  return {
    helpOpen,
    toggleHelp: () => (helpOpen ? closeHelp() : openHelp()),
    openHelp,
    panel: helpOpen ? <HelpPanel onClose={closeHelp} onTour={startTour} diagnostics={pageDiagnostics()} /> : null,
    tour:
      step < 0 ? null : (
        <Tour
          step={step}
          onBack={() => setStep((s) => Math.max(0, s - 1))}
          onNext={() => (step >= TOUR_STEPS.length - 1 ? endTour() : setStep(step + 1))}
          onSkip={endTour}
        />
      ),
  };
}
