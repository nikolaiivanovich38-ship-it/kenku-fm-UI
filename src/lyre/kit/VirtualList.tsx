import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cx } from "./cx";

export interface VirtualListProps {
  /** The list's name for screen readers, e.g. "Tracks". */
  label: string;
  itemCount: number;
  /** Every row is this tall, in pixels (30: the --row token). */
  rowHeight?: number;
  /** Draws one row's content. */
  renderRow: (index: number) => React.ReactNode;
  /** Rows drawn beyond the visible ones, so fast scrolling shows no gaps. */
  overscan?: number;
  /** The height to assume before the list has been measured (and in tests, where nothing is measured). */
  height?: number;
  /**
   * "list" (default): rows hold their own buttons and links. "listbox": one Tab stop; the arrow keys, Page Up/Down,
   * Home and End move the current row, Enter or Space acts on it (the Library's keyboard use of rows).
   */
  role?: "list" | "listbox";
  activeIndex?: number;
  onActiveChange?: (index: number) => void;
  onActivate?: (index: number) => void;
  /** Which rows are selected (listbox). */
  isSelected?: (index: number) => boolean;
  /** A stable key per row (defaults to its index). */
  rowKey?: (index: number) => string | number;
  className?: string;
}

/**
 * PERF-3: a long list (20,000 tracks) drawn a screenful at a time. Only the visible rows and a few either side are on
 * the page; the rest is empty space of the right height, so the scroll bar and Page Up/Down behave as for the whole
 * list. Each row tells screen readers its place in the whole list (aria-posinset of aria-setsize).
 */
export function VirtualList({
  label,
  itemCount,
  rowHeight = 30,
  renderRow,
  overscan = 8,
  height = 400,
  role = "list",
  activeIndex = 0,
  onActiveChange,
  onActivate,
  isSelected,
  rowKey,
  className,
}: VirtualListProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(height);
  const idPrefix = useId();
  const listbox = role === "listbox";

  // Measure the visible height, and again whenever the box is resized.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const measure = () => setViewHeight(box.clientHeight || height);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [height]);

  const pageRows = Math.max(1, Math.floor(viewHeight / rowHeight));
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(itemCount - 1, Math.floor((scrollTop + viewHeight) / rowHeight) + overscan);
  const current = Math.min(Math.max(0, activeIndex), Math.max(0, itemCount - 1));
  const rowId = (index: number) => `${idPrefix}-row-${index}`;

  // Keep the current row in sight when the keyboard moves it.
  const scrollToRow = (index: number) => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const top = index * rowHeight;
    let next = box.scrollTop;
    if (top < next) {
      next = top;
    } else if (top + rowHeight > next + viewHeight) {
      next = top + rowHeight - viewHeight;
    }
    if (next !== box.scrollTop) {
      box.scrollTop = next;
      setScrollTop(next);
    }
  };
  const pendingScroll = useRef<number | null>(null);
  useEffect(() => {
    if (pendingScroll.current !== null) {
      scrollToRow(pendingScroll.current);
      pendingScroll.current = null;
    }
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!listbox || itemCount === 0) {
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      PageDown: current + pageRows,
      PageUp: current - pageRows,
      Home: 0,
      End: itemCount - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      const next = Math.min(itemCount - 1, Math.max(0, moves[event.key]));
      pendingScroll.current = next;
      onActiveChange?.(next);
      scrollToRow(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate?.(current);
    }
  };

  const rows: React.ReactNode[] = [];
  for (let index = first; index <= last; index++) {
    rows.push(
      <div
        key={rowKey ? rowKey(index) : index}
        id={rowId(index)}
        className={cx("vrow", listbox && index === current && "active")}
        role={listbox ? "option" : "listitem"}
        aria-setsize={itemCount}
        aria-posinset={index + 1}
        aria-selected={listbox ? (isSelected?.(index) ?? false) : undefined}
        style={{ top: index * rowHeight, height: rowHeight }}
        onClick={listbox ? () => onActiveChange?.(index) : undefined}
      >
        {renderRow(index)}
      </div>,
    );
  }

  return (
    <div
      ref={boxRef}
      className={cx("vlist", className)}
      role={role}
      aria-label={label}
      tabIndex={listbox ? 0 : undefined}
      aria-activedescendant={listbox && itemCount > 0 && current >= first && current <= last ? rowId(current) : undefined}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div className="vlist-space" style={{ height: itemCount * rowHeight }} role="presentation">
        {rows}
      </div>
    </div>
  );
}
