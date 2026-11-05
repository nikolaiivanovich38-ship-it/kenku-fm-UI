import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../kit/ErrorBoundary";
import { SCREENS, type ScreenComponent } from "../screens";
import { AnnouncerProvider, useAnnounce } from "./Announcer";
import { CampaignInHandContext } from "./CampaignInHand";
import { Rail } from "./Rail";
import { routeFromHash, sectionOf, type RouteName } from "./routes";
import { useShellData } from "./ShellData";
import { SoundMessages } from "./SoundMessages";
import { ShellSettingsProvider, useShellSettings } from "./ShellSettings";
import { themeFor } from "./themes";

/** Below this width the rail shows icons only, unless the user chose otherwise (prototype: 1100 px). */
const NARROW_APP_PX = 1100;

export interface ShellProps {
  /** The screen for each route; the app passes SCREENS. */
  screens?: Record<RouteName, ScreenComponent>;
}

/**
 * The new interface's frame (UX-3, UX-9): the rail, the screen for the page address, the theme, and the keyboard
 * and announcement rules every screen shares. Data and audio come from providers around it (AppProviders.tsx).
 */
export function Shell({ screens = SCREENS }: ShellProps) {
  return (
    <ShellSettingsProvider>
      <AnnouncerProvider>
        <SoundMessages />
        <ShellFrame screens={screens} />
      </AnnouncerProvider>
    </ShellSettingsProvider>
  );
}

function ShellFrame({ screens }: { screens: Record<RouteName, ScreenComponent> }) {
  const route = useHashRoute();
  const data = useShellData();
  const { settings, update } = useShellSettings();
  const { say } = useAnnounce();
  const appRef = useRef<HTMLDivElement>(null);

  // The campaign in hand: the last one opened. Shared screens (Library, Pad boards...) keep its theme.
  const campaignInHand = useRef<string | undefined>(undefined);
  if (route.params.cid) {
    campaignInHand.current = route.params.cid;
  }
  const theme = themeFor({
    choice: settings.theme,
    route,
    campaignInHand: campaignInHand.current,
    liveCampaign: data.liveCampaign,
    campaignTheme: data.campaignTheme ?? (() => undefined),
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // A11Y: after a route change, focus goes to the new screen's heading (no outline: ui.css), so screen readers read
  // where you are. Not when the page first opens.
  const firstPath = useRef(route.path);
  useLayoutEffect(() => {
    if (route.path === firstPath.current) {
      return;
    }
    firstPath.current = "";
    const heading = appRef.current?.querySelector<HTMLElement>("#view h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, [route.path]);

  // UX-12: F6 and Shift+F6 jump between the boxes' headers, so the keyboard reaches any box quickly.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F6" || document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) {
        return;
      }
      const heads = Array.from(appRef.current?.querySelectorAll<HTMLButtonElement>("#view .pane-toggle") ?? []).filter(
        (toggle) => !toggle.closest(".col.has-max > .pane:not(.maxed), [hidden]"),
      );
      if (heads.length === 0) {
        return;
      }
      event.preventDefault();
      const inPane = (document.activeElement as HTMLElement | null)?.closest(".pane");
      const at = heads.findIndex((toggle) => inPane?.contains(toggle));
      const next = heads[(at + (event.shiftKey ? -1 : 1) + heads.length) % heads.length];
      next.focus();
      next.scrollIntoView?.({ block: "nearest" });
      say(next.textContent?.trim() ?? "");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [say]);

  const narrow = useNarrow(appRef);
  const railMin = settings.rail === "min" || (settings.rail === "auto" && narrow);

  const Screen = screens[route.name];
  return (
    <div id="app" ref={appRef}>
      <Rail section={sectionOf(route)} min={railMin} onToggleMin={() => update({ rail: railMin ? "full" : "min" })} />
      <main id="view" className="view" data-view={route.name}>
        <ErrorBoundary key={route.path} where="this screen">
          <CampaignInHandContext.Provider value={campaignInHand.current}>
            <Screen route={route} />
          </CampaignInHandContext.Provider>
        </ErrorBoundary>
        {route.name !== "live" && data.onAirBar}
      </main>
    </div>
  );
}

/** The route in the page address, following its changes (links, Back, the e2e tests). */
function useHashRoute() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

/** True while the shell is narrower than NARROW_APP_PX. Unmeasured (0 px wide) counts as wide. */
function useNarrow(ref: React.RefObject<HTMLElement>) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      setNarrow(width > 0 && width < NARROW_APP_PX);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}
