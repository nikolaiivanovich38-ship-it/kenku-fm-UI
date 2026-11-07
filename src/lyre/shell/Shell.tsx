import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../kit/ErrorBoundary";
import { SCREENS, type ScreenComponent } from "../screens";
import { AnnouncerProvider, useAnnounce } from "./Announcer";
import { CampaignInHandContext } from "./CampaignInHand";
import { Rail } from "./Rail";
import { routeFromHash, sectionOf, type RouteName } from "./routes";
import { useShellData } from "./ShellData";
import { ScreenSound } from "./ScreenSound";
import { SoundMessages } from "./SoundMessages";
import { UndoNoteBar, UndoNoteProvider } from "./UndoNote";
import { ShellSettingsProvider, useShellSettings } from "./ShellSettings";
import { themeFor } from "./themes";
import { useHelp } from "../help/useHelp";
import { fallbackNow, NavigationProvider, useBackKeys, useNavigationState } from "./TopBar";

/** How long the shell waits for a new screen's heading (it appears once the screen's data has loaded). */
const HEADING_WAIT_MS = 5000;

/** Below this width the rail shows icons only, unless the user chose otherwise (prototype: 1100 px). */
const NARROW_APP_PX = 1100;

export interface ShellProps {
  /** The screen for each route; the app passes SCREENS. */
  screens?: Record<RouteName, ScreenComponent>;
  /** FND-8: show the first-run tour if it was not seen yet (the app's page root asks for it). */
  firstRunTour?: boolean;
}

/**
 * The new interface's frame (UX-3, UX-9): the rail, the screen for the page address, the theme, and the keyboard
 * and announcement rules every screen shares. Data and audio come from providers around it (AppProviders.tsx).
 */
export function Shell({ screens = SCREENS, firstRunTour = false }: ShellProps) {
  return (
    <ShellSettingsProvider>
      <AnnouncerProvider>
        <SoundMessages />
        <ShellFrame screens={screens} firstRunTour={firstRunTour} />
      </AnnouncerProvider>
    </ShellSettingsProvider>
  );
}

function ShellFrame({ screens, firstRunTour }: { screens: Record<RouteName, ScreenComponent>; firstRunTour: boolean }) {
  const data = useShellData();
  // UX-18: one history of places for Back. The place left is recorded before the route changes, while it is drawn.
  const before = useRef<(path: string) => void>(() => undefined);
  const route = useHashRoute((path) => before.current(path));
  const navigation = useNavigationState(route.path, data.placeNames);
  before.current = navigation.beforeRouteChange;
  useBackKeys(() => navigation.goBack(fallbackNow.current));
  const { settings, update } = useShellSettings();
  const { say } = useAnnounce();
  const appRef = useRef<HTMLDivElement>(null);
  // FND-8: Help (the rail's button, F1, the side panel) and the first-run tour.
  const help = useHelp({ firstRunTour });

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
    // w3-ux 5: screens show a loading heading, or none, until their data has loaded, then their own. For a few
    // seconds the shell follows: the screen's heading gets focus when it appears, as long as focus is still where the
    // route change left it (the link pressed), on a heading it gave, or nowhere (the heading it gave was replaced).
    const view = appRef.current?.querySelector<HTMLElement>("#view");
    if (!view) return;
    const leftAt = document.activeElement;
    let given: HTMLElement | null = null;
    const place = () => {
      const heading = view.querySelector<HTMLElement>("h1");
      if (!heading || heading === given) return;
      const active = document.activeElement;
      if (active !== leftAt && active !== given && active !== document.body && active !== null) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      given = heading;
    };
    place();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(place);
    observer.observe(view, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), HEADING_WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
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
      <Rail
        section={sectionOf(route)}
        min={railMin}
        onToggleMin={() => update({ rail: railMin ? "full" : "min" })}
        helpOpen={help.helpOpen}
        onHelp={help.toggleHelp}
      />
      <main id="view" className="view" data-view={route.name}>
        <NavigationProvider value={navigation}>
          <UndoNoteProvider live={route.name === "live"}>
            <ErrorBoundary key={route.path} where="this screen">
              <CampaignInHandContext.Provider value={campaignInHand.current}>
                <ScreenSound route={route.name}>
                  <Screen route={route} />
                </ScreenSound>
              </CampaignInHandContext.Provider>
            </ErrorBoundary>
            {route.name !== "live" && <UndoNoteBar />}
          </UndoNoteProvider>
        </NavigationProvider>
        {data.NowPlayingBar && <data.NowPlayingBar previewOnly={!!Screen.showsOnAir} />}
      </main>
      {help.panel}
      {help.tour}
      {data.FindAndPlay && <data.FindAndPlay />}
    </div>
  );
}

/**
 * The route in the page address, following its changes (links, Back, the e2e tests). `beforeChange` hears the new
 * path first, while the screen left is still drawn.
 */
function useHashRoute(beforeChange: (path: string) => void) {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const hear = useRef(beforeChange);
  hear.current = beforeChange;
  useEffect(() => {
    const onHashChange = () => {
      const next = routeFromHash(window.location.hash);
      hear.current(next.path);
      setRoute(next);
    };
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
