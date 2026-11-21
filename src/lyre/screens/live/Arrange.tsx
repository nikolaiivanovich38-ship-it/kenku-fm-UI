/**
 * Arrange (round 10, Nik 18 Nov 03:14, answer 6; r9live.js §5): Arrange in Live's top bar turns on Arrange mode. Each
 * box, On air too, gets a row above it with a grip (drag it to another place; a line shows exactly where it lands) and
 * one Move… menu that does the same from the keyboard (WCAG 2.5.7): Up, Down, Column left, Column right, Taller,
 * Shorter, Fit, Narrower, Wider, and for On air Into column n or To the top. A box's bottom edge is dragged for its
 * height and the bar between two columns for their widths. The boxes cannot be used while arranging (inert). Done
 * keeps the layout for this window size; Put back the usual layout brings back 0.5.1's. The layout itself is
 * liveLayout.ts.
 */
import React, { useEffect, useRef, useState } from "react";

import { Icon } from "../../kit/Icon";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { cx } from "../../kit/cx";
import { focusLive } from "./focus";
import { arrange, BOX_NAMES, MAX_HEIGHT, MIN_HEIGHT, whereIs, type ArrangeAction, type ArrangeId, type Columns, type LiveLayout } from "./liveLayout";

export interface ArrangeProps {
  layout: LiveLayout;
  columns: Columns;
  /** A move: the new layout, and the words to read out. */
  change: (id: ArrangeId, action: ArrangeAction, focus?: boolean) => void;
}

/**
 * Review M7 (f-live): a pointer drag that always ends. `start(move, end)` follows the pointer until it is let go
 * (`end(true)`), cancelled by the system (Alt+Tab, a touch taken over: `end(false)`, nothing is saved), or the component
 * goes away mid-drag (Done, Esc, another screen: the listeners come off and `end` is not called, so nothing is saved
 * from a box that is gone).
 */
function usePointerDrag(): (move: (event: PointerEvent) => void, end: (committed: boolean) => void) => void {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return (move, end) => {
    stop.current?.();
    const finish = (committed: boolean) => {
      off();
      end(committed);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    function off() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      stop.current = null;
    }
    stop.current = off;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
  };
}

/** The bar over the boxes while arranging: what to do, Put back the usual layout and Done (Esc does the same as Done). */
export function ArrangeBar({ reset, done, dropTop }: { reset: () => void; done: () => void; dropTop: DropTarget }) {
  return (
    <div className={cx("lv-arrbar", dropTop.over && "lv-topover")} role="region" aria-label="Arrange" {...dropTop.handlers}>
      <span className="grow">
        <b>Arrange the boxes</b>{" "}
        <span className="faint">
          · Drag a box by its header to move it, or by its bottom edge to resize it. You can also use its Move… button. The layout is kept for this window size.
        </span>
      </span>
      <button type="button" className="btn s ghost" data-lv="arr-reset" onClick={reset}>
        <Icon name="restart" size="s" />
        Put back the usual layout
      </button>
      <button type="button" className="btn s primary" data-lv="arr-done" onClick={done}>
        Done
      </button>
    </div>
  );
}

/** What a drag of a box's grip carries (one at a time). */
let dragging: ArrangeId | null = null;

interface DropTarget {
  over: boolean;
  handlers: Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;
}

/** Dropping On air on the Arrange bar puts it back at the top, the whole width. */
export function useTopDrop(change: ArrangeProps["change"]): DropTarget {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (event) => {
        if (dragging !== "onair") return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event) => {
        setOver(false);
        if (dragging !== "onair") return;
        event.preventDefault();
        change("onair", { drop: "top" });
        dragging = null;
      },
    },
  };
}

/** One box while arranging: its row (grip and Move…), the box itself (inert), and its bottom edge. */
export function ArrangeBox({ id, col, at, props, children }: { id: ArrangeId; col: number; at: number; props: ArrangeProps; children: React.ReactNode }) {
  const { layout, columns, change } = props;
  const inner = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<"before" | "after" | null>(null);
  const [sizing, setSizing] = useState<number | null>(null);
  const drag = usePointerDrag();
  useEffect(() => inner.current?.setAttribute("inert", ""), []);
  const height = layout.heights[id];
  const shown = sizing ?? height;
  const items = (): PopMenuEntry[] => moveItems(layout, columns, id, () => inner.current?.getBoundingClientRect().height ?? 300, change);
  return (
    <div
      className={cx("lv-arrbox", col < 0 && "lv-arrtop", line === "before" && "lv-before", line === "after" && "lv-after", sizing !== null && "lv-sizing")}
      data-box={id}
      style={shown ? ({ ["--lv-h" as string]: `${shown}px` } as React.CSSProperties) : undefined}
      onDragOver={(event) => {
        if (!dragging || dragging === id || col < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const r = event.currentTarget.getBoundingClientRect();
        setLine(event.clientY > r.top + r.height / 2 ? "after" : "before");
      }}
      onDragLeave={() => setLine(null)}
      onDrop={(event) => {
        const was = line;
        setLine(null);
        if (!dragging || dragging === id || col < 0) return;
        event.preventDefault();
        event.stopPropagation();
        change(dragging, { drop: { col, at: was === "after" ? at + 1 : at } });
        dragging = null;
      }}
    >
      <div className="lv-arr" role="group" aria-label={`Arrange ${BOX_NAMES[id]}`}>
        <span
          className="lv-arr-grip"
          draggable
          title={`Drag to move ${BOX_NAMES[id]}`}
          aria-hidden="true"
          onDragStart={(event) => {
            dragging = id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
          }}
          onDragEnd={() => (dragging = null)}
        >
          <Icon name="drag" size="s" />
        </span>
        <span className="lv-arr-n ellipsis">{BOX_NAMES[id]}</span>
        <PopMenuButton label={`Move or resize ${BOX_NAMES[id]}`} className="btn s lv-arr-move" ariaLabel={`Move or resize: ${BOX_NAMES[id]}`} title={`Move or resize ${BOX_NAMES[id]} with the keyboard`} dataK={`arr-${id}`} items={items}>
          Move…
        </PopMenuButton>
      </div>
      <div className={cx("lv-arrin", shown && "lv-fixed")} ref={inner}>
        {children}
      </div>
      <span
        className="lv-edge-b"
        title={`Drag to make ${BOX_NAMES[id]} taller or shorter`}
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          const start = event.clientY;
          const h0 = inner.current?.getBoundingClientRect().height ?? 300;
          let now = h0;
          drag(
            (ev) => {
              now = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h0 + ev.clientY - start));
              setSizing(now);
            },
            (committed) => {
              setSizing(null);
              if (committed) change(id, { height: now }, false);
            },
          );
        }}
      />
    </div>
  );
}

/** The Move… menu of a box, as the prototype has it (r9live.js r10move). */
function moveItems(layout: LiveLayout, columns: Columns, id: ArrangeId, height: () => number, change: ArrangeProps["change"]): PopMenuEntry[] {
  const p = whereIs(layout, id);
  const col = p ? layout.cols[p.col] : null;
  const item = (key: string, label: string, icon: Parameters<typeof Icon>[0]["name"], action: ArrangeAction, disabled = false): PopMenuEntry => ({
    key,
    disabled,
    content: (
      <>
        <Icon name={icon} size="s" />
        {label}
      </>
    ),
    onSelect: () => change(id, action === "taller" || action === "shorter" ? (layout.heights[id] ? action : { height: height() + (action === "taller" ? 60 : -60) }) : action),
  });
  const out: PopMenuEntry[] = [];
  if (id === "onair" && !p) {
    const n = Math.max(1, Math.min(columns, layout.cols.length));
    for (let i = 0; i < n; i++) out.push(item(`into${i}`, `Into column ${i + 1}`, "right", { into: i }));
  } else {
    out.push(item("up", "Up", "chevup", "up", !p || p.at === 0), item("down", "Down", "chevdown", "down", !p || !col || p.at === col.length - 1));
    if (columns > 1) out.push(item("left", "Column left", "left", "left", !p || p.col === 0), item("right", "Column right", "right", "right", !p || p.col >= layout.cols.length - 1));
    if (id === "onair") out.push(item("top", "To the top, the whole width", "chevup", "top"));
  }
  out.push({ separator: true }, item("taller", "Taller", "plus", "taller"), item("shorter", "Shorter (it scrolls inside)", "minus", "shorter"), item("fit", "Fit to its contents", "restart", "fit", !layout.heights[id]));
  if (columns > 1 && p) out.push(item("narrower", "Narrower", "chevleft", "narrower", layout.cols.length < 2), item("wider", "Wider", "chevright", "wider", layout.cols.length < 2));
  return out;
}

/** The bar between two columns while arranging: dragged, it shares their width out again. */
export function ColumnSplit({ index, widths, change }: { index: number; widths: number[]; change: (widths: number[]) => void }) {
  const [dx, setDx] = useState(0);
  const drag = usePointerDrag();
  return (
    <div
      className={cx("lv-split", dx !== 0 && "on")}
      title="Drag to change the widths"
      aria-hidden="true"
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={(event) => {
        event.preventDefault();
        const grid = event.currentTarget.parentElement;
        const cols = grid ? Array.from(grid.querySelectorAll<HTMLElement>(":scope > .col")) : [];
        const a = cols[index]?.getBoundingClientRect().width ?? 0;
        const b = cols[index + 1]?.getBoundingClientRect().width ?? 0;
        const x0 = event.clientX;
        let moved = 0;
        drag(
          (ev) => {
            moved = Math.max(80 - a, Math.min(b - 80, ev.clientX - x0));
            setDx(moved);
          },
          (committed) => {
            setDx(0);
            if (committed) commit();
          },
        );
        function commit() {
          if (!a || !b || !moved) return;
          const total = widths[index] + widths[index + 1];
          const next = [...widths];
          next[index] = (total * (a + moved)) / (a + b);
          next[index + 1] = total - next[index];
          change(next);
        }
      }}
    >
      <span className="lv-split-bar" />
    </div>
  );
}

/** Dropping a box at the end of a column (below its last box, or in an empty one). */
export function columnDrop(col: number, length: number, change: ArrangeProps["change"]): Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDrop"> {
  return {
    onDragOver: (event) => {
      if (!dragging) return;
      event.preventDefault();
    },
    onDrop: (event) => {
      if (!dragging) return;
      event.preventDefault();
      change(dragging, { drop: { col, at: length } });
      dragging = null;
    },
  };
}

/** After a move from the menu, focus goes back to that box's Move… button (it may now be drawn somewhere else). */
export function focusMove(id: ArrangeId): void {
  // After the redraw: the button may now be a new one in another column, and the menu gives focus back first.
  setTimeout(() => focusLive(`arr-${id}`), 0);
}

export { arrange };
