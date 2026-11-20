/**
 * The Library's track list (library.js tracksBody): one line per track in a grid the keyboard and screen readers
 * know, drawn a screenful at a time (PERF-3).
 *
 * Why not the kit's VirtualList: the design is a grid of rows with a selection box, title, tag, energy, length and
 * buttons (role grid, rows named "Select <title> …", aria-rowcount and aria-rowindex), and VirtualList draws a list
 * or listbox. The same idea is used here: only the rows in sight, plus a few either side, are on the page; two
 * empty rows of the right height stand for the rest, so the scroll bar behaves as for the whole list.
 *
 * Each row says where its sound goes (UX-16: On air, Only you), its shape beside its first tag (DAT-13) and Missing
 * when Lyre cannot find its file (DAT-8).
 *
 * Keys (the list is one Tab stop): Up, Down, Home, End move; Shift+Up/Down extends the selection; Space selects;
 * Enter opens the details; P previews; A plays on air.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LibraryTrack } from "../../../common/lyre/api";
import type { PreviewNowPlaying } from "../../audio";
import { DestTag } from "../../kit/DestTag";
import { ShapeTag } from "../../kit/ShapeGlyph";
import { EnergyMeter } from "../../kit/Pills";
import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { addedText, columnSort, COLUMNS, fmt, KIND_NAMES, kindMark, playedMs, shortPath, shownTitle, USUAL_COLUMNS, type ColumnKey, type SortColumn, type SortKey } from "./model";
import { USE_WORDS } from "./trackEnd";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { PlayOnAirButton, PreviewButton } from "../../kit/SoundButtons";

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
  /** Tracks on air whose lanes are all paused. */
  airPaused: ReadonlySet<string>;
  /** What plays in the game master's headphones. */
  preview: PreviewNowPlaying | null;
  /** Tracks whose files Lyre cannot find. */
  missing: ReadonlySet<string>;
  emptyText: React.ReactNode;
  onOpen: (id: string) => void;
  onToggle: (id: string, range: boolean) => void;
  onToggleAll: () => void;
  onCursor: (id: string) => void;
  onExtend: (from: string, to: string) => void;
  onPreview: (id: string) => void;
  onPlay: (id: string) => void;
  rowMenu: (t: LibraryTrack) => readonly PopMenuEntry[];
  /** Item 6: Preview or Play on air was pressed on this track's row (the Library opens its details). */
  onPlayed?: (id: string) => void;
  /** Item 35: where the list starts scrolled, and where it is scrolled to (kept while the screen is drawn afresh). */
  initialScroll?: number;
  onScrolled?: (top: number) => void;
  sort: SortKey;
  /** Item 25: a click on a column header sorts by it (ascending, then descending). */
  onSort?: (sort: SortKey) => void;
  /** Round 6: the id of the key legend under the list, read out with it. */
  describedBy?: string;
  /** Round 10 fixes (R10-FIX §1): Delete on a row (Remove from library, asking first). */
  onDelete?: (id: string) => void;
  /** Round 9 (item 26): the columns shown beside Title, in the list's order (Columns beside Sort). */
  columns?: readonly ColumnKey[];
}

export function TracksTable(props: TracksTableProps) {
  const { list, sel, cursor, sort, describedBy } = props;
  const columns = props.columns ?? USUAL_COLUMNS;
  /** The selection box, Title, the chosen columns and the buttons. */
  const span = columns.length + 3;
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(props.initialScroll ?? 0);
  const [viewHeight, setViewHeight] = useState(UNMEASURED_HEIGHT);
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  const [headHeight, setHeadHeight] = useState(26);
  const focusAfter = useRef<string | null>(null);

  // Item 35: back where it was before the screen was drawn afresh (opening a track is a new address). Round 8
  // click-through #5: an open track reached from elsewhere (a playlist's track title) is then scrolled into view.
  const revealed = useRef(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && props.initialScroll) box.scrollTop = props.initialScroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list is first drawn
  }, []);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (revealed.current || !box || !props.openId || list.length === 0) return;
    revealed.current = true;
    const index = list.findIndex((t) => t.id === props.openId);
    if (index < 0) return;
    // The rows as the theme draws them, measured here: this runs before the measuring below has updated rowHeight,
    // and a row is taller than the 30 px first guess (round 8 #5 landed far above the row).
    const drawnRow = box.querySelector<HTMLElement>("tbody tr[data-tid]")?.offsetHeight || rowHeight;
    const head = box.querySelector<HTMLElement>("thead")?.offsetHeight || headHeight;
    const top = index * drawnRow;
    const visible = (box.clientHeight || UNMEASURED_HEIGHT) - head;
    if (top >= box.scrollTop && top + drawnRow <= box.scrollTop + visible) return;
    // In the middle of the list's height, so the rows around it show too.
    const next = Math.max(0, top - Math.max(0, (visible - drawnRow) / 2));
    box.scrollTop = next;
    setScrollTop(next);
  }, [props.openId, list, rowHeight, headHeight]);

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
    } else if (key === "Delete" && plain && !event.shiftKey && props.onDelete) {
      // Round 10 fixes (R10-FIX §1): Delete on a row asks as its ⋯'s Remove from library does.
      event.preventDefault();
      props.onDelete(id);
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
        onAir={props.onAir.has(t.id) ? (props.airPaused.has(t.id) ? "paused" : "playing") : null}
        previewing={props.preview?.key === t.id ? (props.preview.paused ? "paused" : "playing") : null}
        missing={props.missing.has(t.id)}
        columns={columns}
        onOpen={props.onOpen}
        onToggle={props.onToggle}
        onPlayed={props.onPlayed}
        rowMenu={props.rowMenu}
      />,
    );
  }

  return (
    <div
      className="lb-scroll"
      ref={boxRef}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        props.onScrolled?.(e.currentTarget.scrollTop);
      }}
    >
      <table className="grid lb-table" role="grid" aria-multiselectable="true" aria-label="Tracks" aria-describedby={describedBy} aria-rowcount={n + 1}>
        <thead>
          <tr aria-rowindex={1}>
            <th className="lb-c-ck">
              <label className="lb-ckl">
                <input ref={allRef} type="checkbox" aria-label={`Select all ${n} shown`} checked={allOn} onChange={props.onToggleAll} />
              </label>
            </th>
            <SortHeader column="title" className="lb-c-title" label="Title" sort={sort} onSort={props.onSort} />
            {columns.map((c) => (
              <SortHeader key={c} column={c} className={COLUMN_CLASS[c]} label={COLUMN_LABEL[c]} sort={sort} onSort={props.onSort} />
            ))}
            <th className="lb-c-pv">
              <span className="sr-only">Preview, play on air, more</span>
            </th>
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>
          {n === 0 && (
            <tr className="lb-emptyrow">
              <td colSpan={span}>
                <div className="empty">{props.emptyText}</div>
              </td>
            </tr>
          )}
          {first > 0 && <Spacer height={first * rowHeight} span={span} />}
          {rows}
          {last < n - 1 && <Spacer height={(n - 1 - last) * rowHeight} span={span} />}
        </tbody>
      </table>
    </div>
  );
}

/** Stands for rows not drawn; hidden from screen readers (the rows' aria-rowindex says where each drawn row is). */
function Spacer({ height, span }: { height: number; span: number }) {
  return (
    <tr className="lb-spacer" aria-hidden="true">
      <td colSpan={span} style={{ height, padding: 0, border: 0 }} />
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
  onAir: "playing" | "paused" | null;
  previewing: "playing" | "paused" | null;
  missing: boolean;
  columns: readonly ColumnKey[];
  onOpen: (id: string) => void;
  onToggle: (id: string, range: boolean) => void;
  onPlayed?: (id: string) => void;
  rowMenu: (t: LibraryTrack) => readonly PopMenuEntry[];
}

/** One track's line: drawn again only when that track, its selection or its state changes. */
const TrackRow = memo(function TrackRow({ t, index, groupNames, selected, open, tabbable, onAir, previewing, missing, columns, onOpen, onToggle, onPlayed, rowMenu }: TrackRowProps) {
  const own = t.title;
  const meta = t.metaTitle;
  const shown = shownTitle(t);
  const tip = `${own ? "" : "No title of your own yet. "}${meta && meta !== own ? `In the file: ${meta}. ` : ""}${t.artist}${t.album ? `, ${t.album}` : ""}`;
  const mark = kindMark(t);
  return (
    <tr
      data-tid={t.id}
      data-focus={`row-${t.id}`}
      // ORG-5: a row is dragged to another list; with ticked rows, all of them go (the Library's DropTray).
      draggable
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
          {onAir && <DestTag to="air" paused={onAir === "paused"} />}
          {previewing && <DestTag to="you" paused={previewing === "paused"} />}
          {t.isNew && <span className="badge lb-newb">New</span>}
          {missing && (
            <span className="badge warn lb-miss" title={`Lyre cannot find this file at ${t.folder}`}>
              <Icon name="warn" size="s" />
              Missing
            </span>
          )}
        </div>
      </td>
      {columns.map((c) => (
        <ColumnCell key={c} column={c} t={t} groupNames={groupNames} columns={columns} />
      ))}
      <td className="lb-c-pv">
        <div className="lb-rowbtns">
          {/* Item 6: a click on either play button also opens the track (before the button plays it). */}
          <span className="lb-play" onClickCapture={() => onPlayed?.(t.id)}>
            <PreviewButton target={{ kind: "track", id: t.id }} name={shown} tabIndex={-1} />
            <PlayOnAirButton target={{ kind: "track", id: t.id }} name={shown} tabIndex={-1} />
          </span>
          <PopMenuButton label={`More for ${shown}`} ariaLabel={`More for ${shown}`} title="More" className="btn s icon ghost" tabIndex={-1} items={() => rowMenu(t)}>
            <Icon name="more" size="s" />
          </PopMenuButton>
        </div>
      </td>
    </tr>
  );
});

const COLUMN_LABEL = Object.fromEntries(COLUMNS) as Record<ColumnKey, string>;
/** The usual three keep their 0.5.2 classes (widths and narrow-pane rules in library.css). */
const COLUMN_CLASS: Record<ColumnKey, string> = {
  artist: "lb-c-artist",
  album: "lb-c-album",
  type: "lb-c-type",
  use: "lb-c-use",
  tags: "lb-c-tags",
  shape: "lb-c-shape",
  energy: "lb-c-en",
  length: "lb-c-dur",
  plays: "lb-c-plays",
  added: "lb-c-added",
  folder: "lb-c-folder",
};

/** Round 9 (item 26): one cell of a chosen column (library.js cellOf). */
function ColumnCell({ column, t, groupNames, columns }: { column: ColumnKey; t: LibraryTrack; groupNames: Record<string, string>; columns: readonly ColumnKey[] }) {
  const cls = COLUMN_CLASS[column];
  switch (column) {
    case "tags": {
      const chips = Object.entries(t.tags).flatMap(([g, values]) => values.map((v) => [g, v] as const));
      return (
        <td className={cls}>
          <span className="lb-tagcell">
            {/* With the Shape column shown, the shape is not repeated here. */}
            {!columns.includes("shape") && <ShapeTag track={t} iconOnly />}
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
          </span>
        </td>
      );
    }
    case "energy":
      return (
        <td className={cls}>
          {t.energy ? (
            <EnergyMeter value={t.energy} />
          ) : (
            <span className="lb-none" role="img" aria-label="No energy yet">
              –
            </span>
          )}
        </td>
      );
    case "length":
      return (
        <td className={`${cls} num`}>
          {/* Item 7's second line says what the Plays for column says, so it goes while that column shows. */}
          {columns.includes("plays") ? fmt(t.durationMs) : <LengthCell t={t} />}
        </td>
      );
    case "plays": {
      const played = fmt(playedMs(t));
      const file = fmt(t.durationMs);
      return (
        <td className={`${cls} num`} title={played !== file ? `Plays ${played} of the file's ${file} (its Audio profile)` : undefined}>
          {played !== file ? <b>{played}</b> : played}
        </td>
      );
    }
    case "artist":
    case "album":
      return (
        <td className={cls}>
          <span className="ellipsis">{t[column]}</span>
        </td>
      );
    case "type":
      return <td className={cls}>{KIND_NAMES[t.kind]}</td>;
    case "use":
      return <td className={cls}>{t.role ? USE_WORDS[t.role] : ""}</td>;
    case "shape":
      return (
        <td className={cls}>
          <span className="lb-tagcell">
            <ShapeTag track={t} />
          </span>
        </td>
      );
    case "added":
      return <td className={cls}>{addedText(t.addedAt)}</td>;
    case "folder":
      return (
        <td className={cls}>
          <span className="ellipsis" title={t.folder}>
            {shortPath(t.folder)}
          </span>
        </td>
      );
  }
}

/**
 * Item 7: the file's length, and under it the length its own Audio profile plays (Start to End) when the two differ
 * as the list writes them. Item 51: both by the one helper (fmt).
 */
function LengthCell({ t }: { t: LibraryTrack }) {
  const file = fmt(t.durationMs);
  const played = fmt(playedMs(t));
  if (played === file) return <>{file}</>;
  return (
    <span className="lb-len">
      <span>{file}</span>
      <span className="lb-played" title={`Plays ${played} with its Audio profile (file ${file})`}>
        <span className="sr-only">, plays </span>
        {played}
      </span>
    </span>
  );
}

/**
 * Item 25: a column header that sorts. Its button sorts by the column, ascending, then descending on a second click;
 * the header's aria-sort says which. Without onSort it is a plain header with its aria-sort.
 */
function SortHeader({ column, className, label, sort, onSort }: { column: SortColumn; className: string; label: string; sort: SortKey; onSort?: (sort: SortKey) => void }) {
  const { aria, next } = columnSort(column, sort);
  return (
    <th className={className} aria-sort={aria}>
      {onSort ? (
        // Out of the Tab order, so the list stays one Tab stop: the Sort box above it has the same sorts for the keys.
        <button type="button" className="lb-sortbtn" tabIndex={-1} title={aria === "ascending" ? `Sort by ${label.toLowerCase()}, descending` : `Sort by ${label.toLowerCase()}`} onClick={() => onSort(next)}>
          <span className="ellipsis">{label}</span>
          {aria && <Icon name={aria === "ascending" ? "chevup" : "chevdown"} size="s" />}
        </button>
      ) : (
        label
      )}
    </th>
  );
}
