import React, { createContext, useContext, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { Icon, type IconName } from "./Icon";
import { StatusPill, type StatusTone } from "./Pills";
import { cx } from "./cx";
import { useRememberedOpen } from "../shell/ShellSettings";

/** Which box fills its column, if any (the prototype's "maxed" pane). */
interface ColumnValue {
  maxed: string | null;
  setMaxed: (id: string | null) => void;
}

const ColumnContext = createContext<ColumnValue | null>(null);

/** A column of boxes (ui.css .col): open boxes share its height; one box can fill it. */
export function Column({ className, children }: { className?: string; children: React.ReactNode }) {
  const [maxed, setMaxed] = useState<string | null>(null);
  return (
    <ColumnContext.Provider value={{ maxed, setMaxed }}>
      <div className={cx("col", maxed !== null && "has-max", className)}>{children}</div>
    </ColumnContext.Provider>
  );
}

export type PaneKind = "onair" | "music" | "scenes" | "search" | "fx" | "plain";

export interface PaneProps {
  /** Remembers the box's open or closed state across visits; unique on the page. */
  id: string;
  /** What the box is for, in plain words; also the region's name and its heading. */
  title: string;
  icon?: IconName;
  /** One line beside the title, e.g. "5 scenes". */
  summary?: React.ReactNode;
  /** Buttons in the header, shown while the box is open. */
  actions?: React.ReactNode;
  /** Gives the box its coloured top edge: onair (red: the players hear it), music, scenes, search, fx. */
  kind?: PaneKind;
  /** The one status pill: what the box is doing now. */
  status?: { text: string; tone?: StatusTone };
  /** Closed by default (the design says which boxes start closed). */
  collapsed?: boolean;
  /** Controlled open state, for a screen that opens the box itself; uncontrolled boxes are remembered by id. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** No padding inside (lists and tables that reach the edges). */
  flush?: boolean;
  /** "auto": as tall as its content instead of sharing the column. */
  size?: "auto";
  /** No "Fill the column" button. */
  noMax?: boolean;
  /** A room box that is silent loses its red edge. */
  silent?: boolean;
  /** w6-rooms (the prototype's o.describe, round 6): what the box is for, read out with its name, not shown. */
  describe?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A box (ui.css .pane, round 4): a coloured top edge for its kind, an icon and a plain title, and one status pill.
 * It collapses to its header and can fill its column; F6 and Shift+F6 jump between box headers (shell). Its content
 * sits inside an error boundary, so a fault shows a message in the box and nowhere else (BUG-9).
 */
export function Pane({
  id,
  title,
  icon,
  summary,
  actions,
  kind,
  status,
  collapsed = false,
  open: controlledOpen,
  onOpenChange,
  flush,
  size,
  noMax,
  silent,
  describe,
  className,
  children,
}: PaneProps) {
  const [rememberedOpen, setRememberedOpen] = useRememberedOpen(id, !collapsed);
  const open = controlledOpen ?? rememberedOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setRememberedOpen(next);
    }
    onOpenChange?.(next);
  };
  const column = useContext(ColumnContext);
  const maxed = column?.maxed === id;
  const canMax = column !== null && !noMax;

  const toggle = () => {
    if (open && maxed) {
      column?.setMaxed(null);
    }
    setOpen(!open);
  };
  const toggleMax = () => {
    if (maxed) {
      column?.setMaxed(null);
    } else {
      column?.setMaxed(id);
      if (!open) {
        setOpen(true);
      }
    }
  };

  const maxLabel = maxed ? "Back to all panes" : `Fill the column with ${title}`;
  return (
    <section
      className={cx("pane", !open && "collapsed", maxed && "maxed", kind && `k-${kind}`, silent && "is-silent", className)}
      data-pane={id}
      data-size={size}
      aria-label={title}
      aria-describedby={describe ? `pd-${id}` : undefined}
    >
      {describe && (
        <p className="sr-only" id={`pd-${id}`}>
          {describe}
        </p>
      )}
      <header>
        <h2 className="pane-h">
          <button
            type="button"
            className="pane-toggle"
            aria-expanded={open}
            title={`${open ? "Collapse" : "Expand"} ${title}`}
            onClick={toggle}
          >
            <Icon name="chevdown" size="s" className="chev" />
            {icon && <Icon name={icon} size="s" />}
            <span className="pane-title">{title}</span>
          </button>
        </h2>
        <div className="pane-summary">{summary}</div>
        {status && <StatusPill text={status.text} tone={status.tone} />}
        <div className="pane-actions">
          {open && actions}
          {canMax && (
            <button type="button" className="closer" aria-label={maxLabel} title={maxLabel} aria-pressed={maxed} onClick={toggleMax}>
              <Icon name={maxed ? "shrink" : "expand"} />
            </button>
          )}
        </div>
      </header>
      <div className={cx("pane-body", flush && "flush")}>
        {open && <ErrorBoundary where={title}>{children}</ErrorBoundary>}
      </div>
    </section>
  );
}
