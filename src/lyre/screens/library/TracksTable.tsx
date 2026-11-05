/**
 * The Library's track list (library.js tracksBody): one line per track in a grid the keyboard and screen readers
 * know, drawn a screenful at a time (PERF-3).
 *
 * Why not the kit's VirtualList: the design is a grid of rows with a selection box, title, tag, energy, length and
 * buttons (role grid, rows named "Select <title> …", aria-rowcount and aria-rowindex), and VirtualList draws a list
 * or listbox. The same idea is used here: only the rows in sight, plus a few either side, are on the page; two
 * empty rows of the right height stand for the rest, so the scroll bar behaves as for the whole list.
 *
 * Keys (the list is one Tab stop): Up, Down, Home, End move; Shift+Up/Down extends the selection; Space selects;
 * Enter opens the details; P previews; A plays on air.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LibraryTrack } from "../../../common/lyre/api";
import { EnergyMeter } from "../../kit/Pills";
import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { fmt, kindMark, shownTitle } from "./model";
import { PlayOnAirButton, PopMenuButton, PreviewButton, type PopMenuEntry } from "./shared";

/** Rows drawn beyond the visible ones, so fast scrolling shows no gaps. */
const OVERSCAN = 10;
/** Up to this many rows are all drawn (cheap, and every row is there for find-in-page and screen-reader browsing). */
const DRAW_ALL_UP_TO = 400;
/** The height to assume before the list is measured (and in tests, where nothing is). */
const UNMEASURED_HEIGHT = 900;
const ROW_HEIGHT = 30;

export interface TracksTableProps {
  list: LibraryTrack[];
  groupNames: Record<string, string>;
  openId: string | undefined;
  sel: ReadonlySet<string>;
  cursor: string | null;
  onAir: ReadonlySet<string>;
  emptyText: React.ReactNode;
  onOpen: (id: string) => void;
  onToggle: (id: string, range: boolean) => void;
  onToggleAll: () => void;
  onCursor: (id: string) => void;
  onExtend: (from: string, to: string) => void;
  onPreview: (id: string) => void;
  onPlay: (id: string) => void;
  rowMenu: (t: LibraryTrack) => readonly PopMenuEntry[];
  sort: string;
}

export function TracksTable(props: TracksTableProps) {
  const { list, sel, cursor, sort } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(UNMEASURED_HEIGHT);
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  const [headHeight, setHeadHeight] = useState(26);
  const focusAfter = useRef<string | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setViewHeight(box.clientHeight || UNMEASURED_HEIGHT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const n = list.length;
  const all = n <= DRAW_ALL_UP_TO;
  const first = all ? 0 : Math.max(0, Math.floor(Math.max(0, scrollTop - headHeight) / rowHeight) - OVERSCAN);
  const last = all ? n - 1 : Math.min(n - 1, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN);
  const cursorIndex = cursor ? list.findIndex((t) => t.id === cursor) : -1;
  const tabRow = cursorIndex >= 0 ? cursor : list[0]?.id;

  // Rows are as tall as the theme makes them: measure one, and the header, once drawn.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const row = box?.querySelector<HTMLElement>("tbody tr[data-tid]");
    const head = box?.querySelector<HTMLElement>("thead");
    if (row && row.offsetHeight > 0 && row.offsetHeight !== rowHeight) setRowHeight(row.offsetHeight);
    if (head && head.offsetHeight > 0 && head.offsetHeight !== headHeight) setHeadHeight(head.offsetHeight);
  }, [rowHeight, headHeight, list]);

  // After the keyboard moves the current row, focus it once it is drawn.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    const row = boxRef.current?.querySelector<HTMLElement>(`tr[data-tid="${id}"]`);
    if (row) {
      focusAfter.current = null;
      row.focus({ preventScroll: true });
      row.scrollIntoView?.({ block: "nearest" });
    }
  });

  /** Scrolls so row `index` is in sight below the sticky header. */
  const bringIntoView = useCallback(
    (index: number) => {
      const box = boxRef.current;
      if (!box) return;
      const top = index * rowHeight;
      const visible = box.clientHeight - headHeight;
      let next = box.scrollTop;
      if (top < next) next = top;
      else if (top + rowHeight > next + visible) next = top + rowHeight - visible;
      if (next !== box.scrollTop) {
        box.scrollTop = next;
        setScrollTop(next);
      }
    },
    [rowHeight, headHeight],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("tr[data-tid]");
    if (!row || event.target !== row) return;
    const id = row.dataset.tid as string;
    const at = list.findIndex((t) => t.id === id);
    const key = event.key;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      const to = key === "Home" ? 0 : key === "End" ? n - 1 : Math.max(0, Math.min(n - 1, at + (key === "ArrowDown" ? 1 : -1)));
      const target = list[to].id;
      focusAfter.current = target;
      bringIntoView(to);
      props.onCursor(target);
      if (event.shiftKey && (key === "ArrowDown" || key === "ArrowUp")) props.onExtend(id, target);
    } else if (key === "Enter") {
      event.preventDefault();
      props.onOpen(id);
    } else if (key === " ") {
      event.preventDefault();
      props.onToggle(id, event.shiftKey);
    } else if ((key === "p" || key === "P") && plain) {
      event.preventDefault();
      props.onPreview(id);
    } else if ((key === "a" || key === "A") && plain) {
      event.preventDefault();
      props.onPlay(id);
    }
  };

  const shownSel = sel.size ? list.reduce((k, t) => k + (sel.has(t.id) ? 1 : 0), 0) : 0;
  const allOn = n > 0 && shownSel === n;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = shownSel > 0 && !allOn;
  });

  const rows: React.ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const t = list[i];
    rows.push(
      <TrackRow
        key={t.id}
        t={t}
        index={i}
        groupNames={props.groupNames}
        selected={sel.has(t.id)}
        open={t.id === props.openId}
        tabbable={t.id === tabRow}
        onAir={props.onAir.has(t.id)}
        onOpen={props.onOpen}
        onToggle={props.onToggle}
        rowMenu={props.rowMenu}
      />,
    );
  }

  return (
    <div className="lb-scroll" ref={boxRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <table className="grid lb-table" role="grid" aria-multiselectable="true" aria-label="Tracks" aria-rowcount={n + 1}>
        <thead>
          <tr aria-rowindex={1}>
            <th className="lb-c-ck">
              <label className="lb-ckl">
                <input ref={allRef} type="checkbox" aria-label={`Select all ${n} shown`} checked={allOn} onChange={props.onToggleAll} />
              </label>
            </th>
            <th className="lb-c-title" aria-sort={sort === "title" ? "ascending" : undefined}>
              Title
            </th>
            <th className="lb-c-tags">Tag</th>
            <th className="lb-c-en">Energy</th>
            <th className="lb-c-dur" aria-sort={sort === "short" ? "ascending" : sort === "long" ? "descending" : undefined}>
              Length
            </th>
            <th className="lb-c-pv">
              <span className="sr-only">Preview, play on air, more</span>
            </th>
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>
          {n === 0 && (
            <tr className="lb-emptyrow">
              <td colSpan={6}>
                <div className="empty">{props.emptyText}</div>
              </td>
            </tr>
          )}
          {first > 0 && <Spacer height={first * rowHeight} />}
          {rows}
          {last < n - 1 && <Spacer height={(n - 1 - last) * rowHeight} />}
        </tbody>
      </table>
    </div>
  );
}

/** Stands for rows not drawn; hidden from screen readers (the rows' aria-rowindex says where each drawn row is). */
function Spacer({ height }: { height: number }) {
  return (
    <tr className="lb-spacer" aria-hidden="true">
      <td colSpan={6} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

interface TrackRowProps {
  t: LibraryTrack;
  index: number;
  groupNames: Record<string, string>;
  selected: boolean;
  open: boolean;
  tabbable: boolean;
  onAir: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, range: boolean) => void;
  rowMenu: (t: LibraryTrack) => readonly PopMenuEntry[];
}

/** One track's line: drawn again only when that track, its selection or its state changes. */
const TrackRow = memo(function TrackRow({ t, index, groupNames, selected, open, tabbable, onAir, onOpen, onToggle, rowMenu }: TrackRowProps) {
  const own = t.title;
  const meta = t.metaTitle;
  const shown = shownTitle(t);
  const tip = `${own ? "" : "No title of your own yet. "}${meta && meta !== own ? `In the file: ${meta}. ` : ""}${t.artist}${t.album ? `, ${t.album}` : ""}`;
  const mark = kindMark(t);
  const chips = Object.entries(t.tags).flatMap(([g, values]) => values.map((v) => [g, v] as const));
  return (
    <tr
      data-tid={t.id}
      data-focus={`row-${t.id}`}
      tabIndex={tabbable ? 0 : -1}
      aria-rowindex={index + 2}
      aria-selected={selected}
      aria-current={open ? "true" : undefined}
      className={cx(open && "lb-open")}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input, label")) return;
        onOpen(t.id);
      }}
    >
      <td
        className="lb-c-ck"
        onClick={(event) => {
          event.stopPropagation();
          // A click on the box itself is handled by the box (below); this is a click beside it in the cell.
          if ((event.target as HTMLElement).tagName === "INPUT") return;
          onToggle(t.id, event.shiftKey);
          (event.currentTarget.parentElement as HTMLElement).focus({ preventScroll: true });
        }}
      >
        <span className="lb-ckl">
          <input
            type="checkbox"
            tabIndex={-1}
            aria-label={`Select ${shown}`}
            checked={selected}
            // The box toggles itself and the selection follows, so the two always agree (cancelling the click
            // would let the browser undo React's update afterwards).
            onChange={() => undefined}
            onClick={(event) => {
              onToggle(t.id, event.shiftKey);
              (event.currentTarget.closest("tr") as HTMLElement).focus({ preventScroll: true });
            }}
          />
        </span>
      </td>
      <td className="lb-c-title" title={`${shown} — ${tip}`}>
        <div className="lb-tl">
          {mark && (
            <span className={cx("lb-km", mark.lane)} title={mark.title}>
              <span className={cx("lane-dot", mark.lane)} />
              {mark.text}
            </span>
          )}
          <span className={cx("lb-t1", !own && "untitled")}>{shown}</span>
          {own && meta && meta !== own && <span className="lb-t2">{meta}</span>}
          {onAir && <span className="badge onair lb-air">On air</span>}
          {t.isNew && <span className="badge lb-newb">New</span>}
        </div>
      </td>
      <td className="lb-c-tags">
        {chips.length ? (
          <>
            <span className="chip lb-chip" title={groupNames[chips[0][0]] ?? chips[0][0]}>
              <span className="ellipsis">{chips[0][1]}</span>
            </span>
            {chips.length > 1 && (
              <span className="lb-more" title={chips.slice(1).map((c) => c[1]).join(", ")}>
                +{chips.length - 1}
              </span>
            )}
          </>
        ) : (
          <span className="lb-none">No tags yet</span>
        )}
      </td>
      <td className="lb-c-en">
        {t.energy ? (
          <EnergyMeter value={t.energy} />
        ) : (
          <span className="lb-none" role="img" aria-label="No energy yet">
            –
          </span>
        )}
      </td>
      <td className="lb-c-dur num">{fmt(t.durationMs)}</td>
      <td className="lb-c-pv">
        <div className="lb-rowbtns">
          <PreviewButton kind="track" id={t.id} name={shown} tabIndex={-1} />
          <PlayOnAirButton kind="track" id={t.id} name={shown} tabIndex={-1} />
          <PopMenuButton label={`More for ${shown}`} ariaLabel={`More for ${shown}`} title="More" className="btn s icon ghost" tabIndex={-1} items={() => rowMenu(t)}>
            <Icon name="more" size="s" />
          </PopMenuButton>
        </div>
      </td>
    </tr>
  );
});
