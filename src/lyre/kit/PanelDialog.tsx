/**
 * Round 10 (design/prototype/ROUND10.md rows 12 and 37; the prototype's r9guide.js "floating panels"): a dialog that
 * does not block the page, for Add music. Nik (item 33): "I need to be able to drag the add music to scene dialoge
 * around and resize it so I can see what's behind it."
 *
 * - It opens docked at the right, as a side panel beside the screen (kit/SidePanel.tsx), so the screen narrows and
 *   nothing of it is under the panel. One **Dock** menu with words: Dock left (before the menu), Dock right, Float.
 * - Floating, it lies over the screen and stays inside the window: its title bar drags it, its corner sizes it, and its
 *   move button moves it with the arrow keys (Shift and the arrows size it; Home docks it at the right again).
 *   Docked, its inner edge and Shift with the arrows change its width; dragging its title or the arrows alone let it
 *   float.
 * - Its place is remembered on this computer (the shell settings, by `placeId`).
 * - It is a dialog named by its title but not modal: Tab leaves it, the page stays usable. Focus goes to its first
 *   field when it opens and back to what opened it when it closes; Esc closes it.
 *
 * Moving between docked and floating moves one box in the page instead of drawing the content again, so what the
 * content holds (ticks, a search typed) is kept.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { MenuButton } from "./Menu";
import { SidePanel, type SidePanelKind } from "./SidePanel";
import { MIN_SCREEN_PX } from "./sidePanelRoom";
import { useRememberedPlace } from "../shell/ShellSettings";
import { useAnnounce } from "../shell/Announcer";
import type { PanelPlace } from "../shell/settings";

export type { PanelPlace } from "../shell/settings";
type Floating = Extract<PanelPlace, { dock: "float" }>;

/** How far one press of an arrow key moves or sizes the panel. */
const STEP_PX = 20;
/** The smallest a panel can be, floating (width × height) and docked (width). */
const MIN_W = 320;
const MIN_H = 240;
/** The window's edge a floating panel keeps clear of. */
const MARGIN = 8;
/** A floating panel made from a docked one is at most this big at first. */
const FLOAT_W = 720;
const FLOAT_H = 560;

const DOCKED_RIGHT: PanelPlace = { dock: "right" };
const FIRST_IN_BODY = ".body input:not([disabled]), .body select:not([disabled]), .body textarea:not([disabled]), .body button:not([disabled])";

/** A floating panel's place kept inside the window: 8 px from each edge, at least 320 × 240, never bigger than it. */
export function clampFloat(place: Floating, window: { width: number; height: number }): Floating {
  const width = Math.round(Math.max(MIN_W, Math.min(place.width, window.width - 2 * MARGIN)));
  const height = Math.round(Math.max(MIN_H, Math.min(place.height, window.height - 2 * MARGIN)));
  const left = Math.round(Math.max(MARGIN, Math.min(place.left, window.width - width - MARGIN)));
  const top = Math.round(Math.max(MARGIN, Math.min(place.top, window.height - height - MARGIN)));
  return { dock: "float", left, top, width, height };
}

/** A docked panel's width: at least 320 px, and the screen keeps 600 px beside it. */
function clampDocked(width: number): number {
  const work = document.getElementById("work")?.getBoundingClientRect().width ?? 0;
  return Math.round(Math.max(MIN_W, Math.min(width, work - MIN_SCREEN_PX)));
}

const windowSize = () => ({ width: window.innerWidth, height: window.innerHeight });

export interface PanelDialogProps {
  open: boolean;
  title: string;
  /** Esc, the Close button, and the host closing it to keep the screen's room call this. */
  onClose: () => void;
  /** Where its place is remembered ("addMusic"). */
  placeId: string;
  /** The side panel it docks as. */
  kind?: SidePanelKind;
  footer?: React.ReactNode;
  /** How-to words read out with the dialog (its description) instead of shown. */
  description?: React.ReactNode;
  /** Enter in a one-line text field presses the footer's main button. */
  enterSubmits?: boolean;
  children: React.ReactNode;
}

export function PanelDialog({ open, ...props }: PanelDialogProps) {
  return open ? <OpenPanelDialog {...props} /> : null;
}

function OpenPanelDialog({ title, onClose, placeId, kind = "addMusic", footer, description, enterSubmits, children }: Omit<PanelDialogProps, "open">) {
  const titleId = useId();
  const descId = useId();
  const [remembered, remember] = useRememberedPlace(placeId, DOCKED_RIGHT);
  // The place shown; remembered as it changes (a drag is remembered when it ends).
  const [place, setPlace] = useState<PanelPlace>(() => (remembered.dock === "float" ? clampFloat(remembered, windowSize()) : remembered));
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { say } = useAnnounce();
  // The one box the content lives in, moved between the side panel and the page (see the file's comment).
  const [box] = useState(() => {
    const div = document.createElement("div");
    div.className = "panel-dialog-box";
    return div;
  });
  // What last had focus in the box: docking it elsewhere draws the side panel anew, which takes focus away.
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const note = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocus.current = event.target;
    };
    box.addEventListener("focusin", note);
    return () => box.removeEventListener("focusin", note);
  }, [box]);

  // Focus goes to the first field once the box is in the page, and back to the opener on closing.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const focusedFirst = useRef(false);
  const placeBox = useCallback(
    (into: HTMLElement) => {
      moveBox(box, into);
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && lastFocus.current && box.contains(lastFocus.current)) lastFocus.current.focus({ preventScroll: true });
      if (focusedFirst.current || !box.isConnected) return;
      focusedFirst.current = true;
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>(FIRST_IN_BODY) ?? panel?.querySelector<HTMLElement>("button:not([disabled])");
      first?.focus({ preventScroll: true });
    },
    [box],
  );
  useEffect(
    () => () => {
      box.remove();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    },
    [box, opener],
  );

  // A drag still going on when the panel closes ends without remembering anything.
  const endDrag = useRef<((keep: boolean) => void) | null>(null);
  useEffect(() => () => endDrag.current?.(false), []);

  // Floating, it stays inside the window when the window gets smaller (its remembered place is left as Nik put it).
  useEffect(() => {
    if (place.dock !== "float") return;
    const onResize = () => setPlace((now) => (now.dock === "float" ? clampFloat(now, windowSize()) : now));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place.dock]);

  // Floating, the box lies in the page itself.
  useLayoutEffect(() => {
    if (place.dock === "float") placeBox(document.body);
  }, [placeBox, place.dock]);

  // Where it is now: its own place while floating, else where the side panel put it.
  const current = (): Floating => {
    if (place.dock === "float") return place;
    const r = panelRef.current?.getBoundingClientRect();
    return { dock: "float", left: r?.left ?? 0, top: r?.top ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
  };
  const show = (next: PanelPlace, keep = true) => {
    const shown = next.dock === "float" ? clampFloat(next, windowSize()) : { ...next, ...(next.width !== undefined ? { width: clampDocked(next.width) } : {}) };
    setPlace(shown);
    if (keep) remember(shown);
    return shown;
  };

  const dockTo = (where: PanelPlace["dock"]) => {
    if (where === "float") {
      const now = current();
      show({ dock: "float", left: now.left - 40, top: now.top + 40, width: Math.min(now.width, FLOAT_W), height: Math.min(now.height, FLOAT_H) });
      say("The panel floats. Drag its title bar to move it.");
    } else {
      show({ dock: where, ...(place.dock !== "float" && place.width ? { width: place.width } : {}) });
      say(where === "left" ? "Docked on the left" : "Docked on the right");
    }
  };

  // Dragging: the title bar moves it (and lets a docked panel float); the grip sizes it (docked: its width only).
  const drag = (event: React.PointerEvent, what: "move" | "size") => {
    if (event.button !== 0) return;
    if (what === "move" && (event.target as Element).closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    const start = current();
    const side = place.dock === "float" ? null : place.dock;
    const x0 = event.clientX;
    const y0 = event.clientY;
    let last: PanelPlace = place;
    endDrag.current?.(false);
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (side && what === "size") last = show({ dock: side, width: start.width + (side === "left" ? dx : -dx) }, false);
      else if (what === "move") last = show({ ...start, left: start.left + dx, top: start.top + dy }, false);
      else last = show({ ...start, width: start.width + dx, height: start.height + dy }, false);
    };
    // Ends on the button's release, on a cancelled pointer (Alt+Tab, a touch the system takes over) and when the panel
    // closes mid-drag (Esc), so the panel never follows a pointer with no button held.
    const end = (keep: boolean) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      endDrag.current = null;
      if (keep) remember(last);
    };
    const onUp = () => end(true);
    endDrag.current = end;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  // The move button: arrows move it, Shift and the arrows size it, Home docks it at the right.
  const onMoveKey = (event: React.KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault();
      show(DOCKED_RIGHT);
      return;
    }
    const dx = event.key === "ArrowLeft" ? -STEP_PX : event.key === "ArrowRight" ? STEP_PX : 0;
    const dy = event.key === "ArrowUp" ? -STEP_PX : event.key === "ArrowDown" ? STEP_PX : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    const now = current();
    if (place.dock !== "float" && event.shiftKey) show({ dock: place.dock, width: now.width + (place.dock === "left" ? dx : -dx) });
    else if (event.shiftKey) show({ ...now, width: now.width + dx, height: now.height + dy });
    else show({ ...now, left: now.left + dx, top: now.top + dy });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (enterSubmits && event.key === "Enter" && !event.shiftKey && event.target instanceof HTMLInputElement && /^(text|search|)$/.test(event.target.type)) {
      const main = panelRef.current?.querySelector<HTMLButtonElement>("footer .btn.primary:not([disabled])");
      if (main) {
        event.preventDefault();
        main.click();
      }
    }
  };

  const floating = place.dock === "float";
  const frame = (
    <div
      ref={panelRef}
      className={floating ? "panel panel-dialog float" : "panel panel-dialog"}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      data-dock={place.dock}
      style={floating ? { left: place.left, top: place.top, width: place.width, height: place.height } : undefined}
      onKeyDown={onKeyDown}
    >
      <header onPointerDown={(e) => drag(e, "move")}>
        <h2 id={titleId}>{title}</h2>
        <span className="panel-dialog-tools" role="group" aria-label="Panel position">
          <MenuButton
            label="Dock"
            size="s"
            title="Dock it left or right, or let it float. Drag its title bar to move it, or its corner to change its size."
            items={[
              { label: "Dock left", checked: place.dock === "left", onSelect: () => dockTo("left") },
              { label: "Dock right", checked: place.dock === "right", onSelect: () => dockTo("right") },
              { label: "Float", checked: floating, onSelect: () => dockTo("float") },
            ]}
          >
            Dock
            <Icon name="chevdown" size="s" />
          </MenuButton>
          <IconButton
            icon="drag"
            size="s"
            label="Move or size with the arrow keys"
            hint="Move it with the arrow keys. Hold Shift and use the arrows to change its size."
            onKeyDown={onMoveKey}
          />
        </span>
        <IconButton icon="close" label="Close" quiet onClick={() => onCloseRef.current()} />
      </header>
      {description && (
        <p className="sr-only" id={descId}>
          {description}
        </p>
      )}
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
      <span className="panel-dialog-grip" aria-hidden="true" onPointerDown={(e) => drag(e, "size")} />
    </div>
  );

  return (
    <>
      {createPortal(frame, box)}
      {!floating && (
        <SidePanel kind={kind} edge={place.dock} width={place.width} onClosedByHost={() => onCloseRef.current()}>
          <DockedBox place={placeBox} />
        </SidePanel>
      )}
    </>
  );
}

/** Docked: the box goes into the side panel's place. */
function DockedBox({ place }: { place: (into: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) place(ref.current);
  });
  return <div ref={ref} className="panel-dialog-dock" />;
}

/** Puts the box in its new place, keeping focus where it was inside it (moving an element takes its focus away). */
function moveBox(box: HTMLElement, into: HTMLElement): void {
  if (box.parentElement === into) return;
  const focused = document.activeElement;
  into.appendChild(box);
  if (focused instanceof HTMLElement && box.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
}
