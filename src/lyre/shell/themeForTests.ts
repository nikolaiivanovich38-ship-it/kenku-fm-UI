/**
 * Round 10 (R10-FIX §3, the sweeps "nothing drawn on top" and "every menu opens inside the window"): the specs show
 * the screen as it is open now in each of the five themes, without opening it again, so a panel or menu that is open
 * stays open (e2e/specs/support/target.ts `showTheme`). The theme asked for wins over Look and feel's and over a
 * campaign's own, until the page is opened again; nothing is saved.
 *
 * Test builds only: packages made with CUE_DESK_E2E_BUILD=1 (the __CUE_DESK_TEST_BUILD__ define,
 * webpack.renderer.config.js) put `window.__lyreShellTest` on the page. A release build compiles the branch out, so
 * its page has no such hook.
 */
import { useEffect, useState } from "react";
import { isThemeId, type ThemeId } from "./themes";

declare const __CUE_DESK_TEST_BUILD__: boolean;

declare global {
  interface Window {
    /** Test builds only (see above). */
    __lyreShellTest?: { showTheme(theme: string): void };
  }
}

/** The theme a spec asked the page to show, or null (always null outside a test build). */
export function useThemeShownByTests(): ThemeId | null {
  const [shown, setShown] = useState<ThemeId | null>(null);
  useEffect(() => {
    if (typeof __CUE_DESK_TEST_BUILD__ === "undefined" || !__CUE_DESK_TEST_BUILD__) return;
    window.__lyreShellTest = {
      showTheme: (theme) => {
        if (isThemeId(theme)) setShown(theme);
      },
    };
    return () => {
      delete window.__lyreShellTest;
    };
  }, []);
  return shown;
}
