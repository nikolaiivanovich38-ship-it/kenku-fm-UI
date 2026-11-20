/**
 * Round 10 (design/prototype/ROUND10.md, "Nothing drawn on top of anything else", rows 37 and 38): side panels beside
 * the screen, not over it. The window (#work) holds, from left to right, Add music docked left, the menu and the
 * screen (#app), then Find's results, the queue, the Track panel, Add music docked right and Help. The screen narrows
 * and reflows (its layouts follow #app's width); it keeps 600 px, so the panel opened first closes; below 760 px of
 * window a panel takes the whole window until it is closed (sidePanelRoom.ts, styles/side-panels.css).
 *
 * The shell places a SidePanelProvider around the page and a SidePanelHost at each edge of #work. A screen opens a
 * panel in one of two ways:
 *   - `<SidePanel kind="find" onClosedByHost={…}>…</SidePanel>` while it should show: the content stays part of the
 *     screen (its state and its context), drawn in the host;
 *   - `useSidePanels().openSidePanel(kind, content)` and `closeSidePanel(kind)`: the content is drawn at the shell's
 *     level, so it sees the app's providers but not a screen's own.
 * Either way the content draws its own head, its × and Esc; the host gives it its place, its width and, at the right,
 * a strip as tall as the top bar above it, so the window's own buttons never cover its head.
 */
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { panelToGiveWay, placeInOrder, type SidePanelEdge, type SidePanelKind, type SidePanelRoom } from "./sidePanelRoom";
import { trackDetailsHref } from "./trackName";

export type { SidePanelEdge, SidePanelKind, SidePanelRoom } from "./sidePanelRoom";

export interface SidePanelOptions {
  /** Add music only: docked at the left (before the menu) or the right (the default). Other panels sit at the right. */
  edge?: SidePanelEdge;
  /** Add music docked: the width Nik gave it by its edge, in CSS pixels (else 36 % of the window, 360 to 560 px). */
  width?: number;
  /** Called when the host closes the panel to keep the screen's room (not when its owner closes it). */
  onClosedByHost?: () => void;
}

export interface SidePanelActions {
  /** Show `content` in the panel of this kind, opening it if it is closed. One panel of each kind: opening it again
   *  replaces what it shows and keeps its place in the opening order. */
  openSidePanel: (kind: SidePanelKind, content: React.ReactNode, options?: SidePanelOptions) => void;
  closeSidePanel: (kind: SidePanelKind) => void;
}

/**
 * Opens a track's details beside the screen: the Track panel (R60-GAPS.md, r10-tracks). `from` is the title pressed,
 * for focus to go back to when the panel closes. The shell passes the opener from screens/trackPanel/openTrackPanel.ts.
 */
export type OpenTrackPanel = (trackId: string, from: HTMLElement | null, panels: SidePanelActions) => void;

/** The stand-in until the Track panel is built: the Track library with the track's details shown (0.5.2). */
export const goToTrackLibrary: OpenTrackPanel = (trackId) => {
  window.location.hash = trackDetailsHref(trackId);
};

interface Entry {
  kind: SidePanelKind;
  edge: SidePanelEdge;
  width?: number;
  /** Drawn by the host (openSidePanel); undefined for a <SidePanel>, which draws its own content into the host. */
  content?: React.ReactNode;
  /** The <SidePanel> that shows it, so an older one unmounting does not close a newer one's panel. */
  owner?: object;
  onClosedByHost?: () => void;
}

interface Registry extends SidePanelActions {
  /** <SidePanel>: show its panel (owner: the component's own key). */
  show: (kind: SidePanelKind, owner: object, options: SidePanelOptions) => void;
  /** <SidePanel>: close its panel, unless another owner took the kind since. */
  hide: (kind: SidePanelKind, owner: object) => void;
  openTrackPanel: (trackId: string, from?: HTMLElement | null) => void;
}

interface Shown {
  /** Open panels, in the order they opened. */
  entries: readonly Entry[];
  /** Where each open panel's content goes. */
  slots: Partial<Record<SidePanelKind, HTMLElement>>;
  /** The host's ref for a panel's content box: one function per kind, so React does not call it on every render. */
  slotRef: (kind: SidePanelKind) => (element: HTMLElement | null) => void;
}

const NO_PANELS: SidePanelActions = { openSidePanel: () => undefined, closeSidePanel: () => undefined };
const RegistryContext = createContext<Registry | null>(null);
const ShownContext = createContext<Shown | null>(null);

/** The widths the room rule reads: #work (the window) and #app (the menu and the screen). */
function measureShellRoom(): SidePanelRoom {
  const width = (id: string) => document.getElementById(id)?.getBoundingClientRect().width ?? 0;
  return { window: width("work"), screen: width("app") };
}

const edgeOf = (kind: SidePanelKind, options?: SidePanelOptions): SidePanelEdge => (kind === "addMusic" && options?.edge === "left" ? "left" : "right");

export interface SidePanelProviderProps {
  children: React.ReactNode;
  /** What a track title opens (the shell gives screens/trackPanel/openTrackPanel.ts); the stand-in by default. */
  openTrackPanel?: OpenTrackPanel;
  /** Tests: the widths to apply the room rule to (the shell measures #work and #app). */
  measureRoom?: () => SidePanelRoom;
}

export function SidePanelProvider({ children, openTrackPanel = goToTrackLibrary, measureRoom = measureShellRoom }: SidePanelProviderProps) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [slots, setSlots] = useState<Shown["slots"]>({});
  const opener = useRef(openTrackPanel);
  opener.current = openTrackPanel;
  const measure = useRef(measureRoom);
  measure.current = measureRoom;

  const put = useCallback((entry: Entry) => {
    setEntries((current) => {
      const at = current.findIndex((e) => e.kind === entry.kind);
      if (at < 0) return [...current, entry];
      const next = current.slice();
      next[at] = entry;
      return next;
    });
  }, []);

  const registry = useMemo<Registry>(() => {
    const actions: SidePanelActions = {
      openSidePanel: (kind, content, options) => put({ kind, edge: edgeOf(kind, options), width: options?.width, content, onClosedByHost: options?.onClosedByHost }),
      closeSidePanel: (kind) => setEntries((current) => current.filter((e) => e.kind !== kind)),
    };
    return {
      ...actions,
      show: (kind, owner, options) => put({ kind, edge: edgeOf(kind, options), width: options.width, owner, onClosedByHost: options.onClosedByHost }),
      hide: (kind, owner) => setEntries((current) => current.filter((e) => e.kind !== kind || e.owner !== owner)),
      openTrackPanel: (trackId, from = null) => opener.current(trackId, from, actions),
    };
  }, [put]);

  const refs = useRef<Partial<Record<SidePanelKind, (element: HTMLElement | null) => void>>>({});
  const slotRef = useCallback((kind: SidePanelKind) => {
    refs.current[kind] ??= (element: HTMLElement | null) =>
      setSlots((current) => {
        if ((current[kind] ?? null) === element) return current;
        const next = { ...current };
        if (element) next[kind] = element;
        else delete next[kind];
        return next;
      });
    return refs.current[kind] as (element: HTMLElement | null) => void;
  }, []);

  // The screen keeps its room: after each change of panels (drawn, so the widths are the new ones) and each resize.
  const latest = useRef(entries);
  latest.current = entries;
  const keepRoom = useCallback(() => {
    const open = latest.current;
    const gives = panelToGiveWay(
      open.map((e) => e.kind),
      measure.current(),
    );
    if (!gives) return;
    const focused = document.activeElement;
    const closed = open.find((e) => e.kind === gives);
    setEntries((current) => current.filter((e) => e.kind !== gives));
    closed?.onClosedByHost?.();
    // Focus stays where Nik is working (the panel he just opened).
    if (focused instanceof HTMLElement && focused !== document.body && document.contains(focused)) focused.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(keepRoom, [entries, keepRoom]);
  useLayoutEffect(() => {
    window.addEventListener("resize", keepRoom);
    return () => window.removeEventListener("resize", keepRoom);
  }, [keepRoom]);

  const shown = useMemo<Shown>(() => ({ entries, slots, slotRef }), [entries, slots, slotRef]);
  return (
    <RegistryContext.Provider value={registry}>
      <ShownContext.Provider value={shown}>{children}</ShownContext.Provider>
    </RegistryContext.Provider>
  );
}

/** Where the panels of one edge of #work are drawn, in SIDE_PANEL_ORDER. */
export function SidePanelHost({ edge }: { edge: SidePanelEdge }) {
  const shown = useContext(ShownContext);
  const here = (shown?.entries ?? []).filter((e) => e.edge === edge).sort((a, b) => placeInOrder(a.kind, a.edge) - placeInOrder(b.kind, b.edge));
  return (
    <div className="side-panels" data-edge={edge}>
      {here.map((entry) => (
        <div
          key={entry.kind}
          className="side-panel"
          data-panel={entry.kind}
          data-edge={entry.edge}
          style={entry.width ? ({ "--dock-w": `${Math.round(entry.width)}px` } as React.CSSProperties) : undefined}
        >
          {/* As tall as the top bar: the window's own buttons sit over it, never over the panel's head. */}
          {entry.edge === "right" && <div className="side-panel-strip" aria-hidden="true" />}
          <div className="side-panel-body" ref={shown?.slotRef(entry.kind)}>
            {entry.content}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface SidePanelProps extends SidePanelOptions {
  kind: SidePanelKind;
  children: React.ReactNode;
}

/**
 * A screen's own side panel, shown while this is drawn. Its content stays part of the screen (state, context), drawn
 * in the host beside the screen. Without a host (a component test of one screen) it is drawn in place.
 */
export function SidePanel({ kind, edge, width, onClosedByHost, children }: SidePanelProps) {
  const registry = useContext(RegistryContext);
  const shown = useContext(ShownContext);
  const [owner] = useState(() => ({}));
  const closedByHost = useRef(onClosedByHost);
  closedByHost.current = onClosedByHost;
  useLayoutEffect(() => {
    if (!registry) return;
    registry.show(kind, owner, { edge, width, onClosedByHost: () => closedByHost.current?.() });
  }, [registry, kind, owner, edge, width]);
  useLayoutEffect(() => {
    if (!registry) return;
    return () => registry.hide(kind, owner);
  }, [registry, kind, owner]);
  if (!registry) {
    return (
      <div className="side-panel" data-panel={kind} data-edge={edgeOf(kind, { edge })}>
        {children}
      </div>
    );
  }
  const mine = shown?.entries.find((e) => e.kind === kind)?.owner === owner;
  const slot = shown?.slots[kind];
  return mine && slot ? createPortal(children, slot) : null;
}

/** Open and close panels by kind. Without a provider (a component test) nothing opens. */
export function useSidePanels(): SidePanelActions {
  return useContext(RegistryContext) ?? NO_PANELS;
}

/** Whether the panel of this kind is open. */
export function useSidePanelOpen(kind: SidePanelKind): boolean {
  return useContext(ShownContext)?.entries.some((e) => e.kind === kind) ?? false;
}

/** What a track title outside the Track library does: open the Track panel (the stand-in goes to the Track library). */
export function useOpenTrackPanel(): (trackId: string, from?: HTMLElement | null) => void {
  const registry = useContext(RegistryContext);
  return registry?.openTrackPanel ?? ((trackId: string, from: HTMLElement | null = null) => goToTrackLibrary(trackId, from, NO_PANELS));
}
