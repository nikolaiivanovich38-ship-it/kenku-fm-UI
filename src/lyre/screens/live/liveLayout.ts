/**
 * Arrange (round 10, Nik 18 Nov 03:14, answer 6; r9live.js §5): how Live's boxes are laid out, one layout per window
 * size ("dynamic": a narrow window, half a screen, a whole window), each box movable and resizable, On air too (at the
 * top, the whole width, by default).
 *
 * A layout is columns of box ids, top to bottom; On air is either at the top (in no column) or in a column. Widths are
 * the columns' shares (fr), heights a box's fixed height in pixels (none: it fits its contents). Moves come from the
 * box's Move… menu, a drag by its grip, its bottom edge or the bar between two columns; every move goes through
 * `arrange`, so the keyboard and the pointer do the same. Layouts are kept on this computer (`loadLayouts`), per
 * window size.
 */
export type BoxId = "scenes" | "current" | "ssp" | "ssd" | "cpp" | "cpd";
export type ArrangeId = BoxId | "onair";
export type Columns = 1 | 2 | 3;

export const BOX_IDS: readonly BoxId[] = ["scenes", "current", "ssp", "ssd", "cpp", "cpd"];
export const BOX_NAMES: Record<ArrangeId, string> = {
  onair: "On air",
  scenes: "Scenes",
  current: "Current scene",
  ssp: "Session playlists",
  ssd: "Session pads",
  cpp: "Campaign playlists",
  cpd: "Campaign pads",
};

/**
 * On air is above, the whole width (round 6 part 6); under it Scenes and Current scene where the eye starts, then the
 * session's things, then the campaign's.
 */
export const USUAL_LAYOUT: Record<Columns, ArrangeId[][]> = {
  1: [["scenes", "current", "ssp", "ssd", "cpp", "cpd"]],
  2: [
    ["scenes", "ssp", "ssd", "cpp", "cpd"],
    ["current"],
  ],
  3: [["scenes"], ["current"], ["ssp", "ssd", "cpp", "cpd"]],
};
/** The usual widths of the columns (fr), as 0.5.1 had them. */
const USUAL_WIDTHS: Record<Columns, number[]> = { 1: [1], 2: [38, 62], 3: [27, 43, 30] };

export interface LiveLayout {
  cols: ArrangeId[][];
  /** Each column's share of the width; null: the usual. */
  widths: number[] | null;
  /** A box's fixed height in pixels; missing: it fits its contents. */
  heights: Partial<Record<ArrangeId, number>>;
}

/** The three window sizes a layout is kept for. */
export const SIZE_NAMES: Record<Columns, string> = { 1: "narrow", 2: "half", 3: "wide" };
/** How the Arrange bar names each window size. */
export const SIZE_WORDS: Record<Columns, string> = { 1: "a narrow window", 2: "half a screen", 3: "a whole window" };

export type SavedLayouts = Partial<Record<"narrow" | "half" | "wide", LiveLayout>>;

export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 1200;
const HEIGHT_STEP = 60;
const WIDTH_STEP = 4;
const MIN_WIDTH = 12;

function usual(columns: Columns): LiveLayout {
  return { cols: USUAL_LAYOUT[columns].map((c) => [...c]), widths: null, heights: {} };
}

/**
 * The layout for a window size: the one kept, made whole (a box missing goes at the end of the last column, an unknown
 * id is dropped, empty columns go), else the usual one.
 */
export function layoutFor(columns: Columns, saved: SavedLayouts): LiveLayout {
  const kept = saved[SIZE_NAMES[columns] as keyof SavedLayouts];
  if (!kept || !Array.isArray(kept.cols)) return usual(columns);
  const known = new Set<ArrangeId>([...BOX_IDS, "onair"]);
  const seen = new Set<ArrangeId>();
  const cols = kept.cols.map((c) =>
    (Array.isArray(c) ? c : []).filter((id): id is ArrangeId => {
      if (!known.has(id as ArrangeId) || seen.has(id as ArrangeId)) return false;
      seen.add(id as ArrangeId);
      return true;
    }),
  );
  const out = cols.filter((c) => c.length > 0).slice(0, columns);
  if (!out.length) out.push([]);
  for (const id of BOX_IDS) if (!out.some((c) => c.includes(id))) out[out.length - 1].push(id);
  const heights: LiveLayout["heights"] = {};
  for (const [id, h] of Object.entries(kept.heights ?? {})) if (known.has(id as ArrangeId) && typeof h === "number" && h >= MIN_HEIGHT && h <= MAX_HEIGHT) heights[id as ArrangeId] = h;
  const widths = Array.isArray(kept.widths) && kept.widths.length === out.length && kept.widths.every((w) => typeof w === "number" && w > 0) ? kept.widths : null;
  return { cols: out, widths, heights };
}

/** Where a box is: its column and its place in it; null for On air at the top. */
export function whereIs(layout: LiveLayout, id: ArrangeId): { col: number; at: number } | null {
  for (let col = 0; col < layout.cols.length; col++) {
    const at = layout.cols[col].indexOf(id);
    if (at > -1) return { col, at };
  }
  return null;
}

/** The boxes in reading order (On air first when it is at the top): the order of F6 and Alt+1 to 7. */
export function readingOrder(layout: LiveLayout): ArrangeId[] {
  const inCols = layout.cols.flat();
  return inCols.includes("onair") ? inCols : ["onair", ...inCols];
}

/**
 * Review M3: the order of F6 and Alt+1 to 7 for a window size: the reading order once Arrange has moved a box there;
 * null (the usual order) while every box is where it usually is, however tall or wide.
 */
export function arrangedKeyOrder(columns: Columns, saved: SavedLayouts): ArrangeId[] | null {
  if (!saved[SIZE_NAMES[columns] as keyof SavedLayouts]) return null;
  const layout = layoutFor(columns, saved);
  const usualCols = USUAL_LAYOUT[columns];
  const same = layout.cols.length === usualCols.length && layout.cols.every((c, i) => c.length === usualCols[i].length && c.every((id, j) => id === usualCols[i][j]));
  return same ? null : readingOrder(layout);
}

export type ArrangeAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "top"
  | { into: number }
  | "taller"
  | "shorter"
  | "fit"
  | "narrower"
  | "wider"
  | { height: number }
  | { widths: number[] }
  | { drop: { col: number; at: number } | "top" };

/** The widths in use (the kept ones, else the usual), one per column. */
export function widthsOf(layout: LiveLayout, columns: Columns): number[] {
  const n = layout.cols.length;
  const base = layout.widths ?? USUAL_WIDTHS[columns];
  return Array.from({ length: n }, (_, i) => base[i] ?? 30);
}

/**
 * One move or size change. `height` is the box's height on screen now, for Taller and Shorter on a box that fits its
 * contents. Answers a new layout (the old one is never changed).
 */
export function arrange(layout: LiveLayout, columns: Columns, id: ArrangeId, action: ArrangeAction, height = 300): LiveLayout {
  const next: LiveLayout = { cols: layout.cols.map((c) => [...c]), widths: layout.widths ? [...layout.widths] : null, heights: { ...layout.heights } };
  const p = whereIs(next, id);
  const col = p ? next.cols[p.col] : null;
  const take = () => {
    if (p && col) col.splice(p.at, 1);
  };
  if (action === "up" && p && col && p.at > 0) {
    take();
    col.splice(p.at - 1, 0, id);
  } else if (action === "down" && p && col && p.at < col.length - 1) {
    take();
    col.splice(p.at + 1, 0, id);
  } else if ((action === "left" && p && p.col > 0) || (action === "right" && p && p.col < next.cols.length - 1)) {
    take();
    next.cols[p.col + (action === "left" ? -1 : 1)].push(id);
  } else if (action === "top" && id === "onair") {
    take();
  } else if (typeof action === "object" && "into" in action && id === "onair") {
    take();
    while (next.cols.length <= action.into && next.cols.length < columns) next.cols.push([]);
    next.cols[Math.min(action.into, next.cols.length - 1)].unshift(id);
  } else if (action === "taller" || action === "shorter") {
    const now = next.heights[id] ?? height;
    next.heights[id] = clampHeight(now + (action === "taller" ? HEIGHT_STEP : -HEIGHT_STEP));
  } else if (action === "fit") {
    delete next.heights[id];
  } else if (typeof action === "object" && "height" in action) {
    next.heights[id] = clampHeight(action.height);
  } else if ((action === "narrower" || action === "wider") && p && next.cols.length > 1) {
    const widths = widthsOf(next, columns);
    const other = p.col < widths.length - 1 ? p.col + 1 : p.col - 1;
    const step = action === "wider" ? WIDTH_STEP : -WIDTH_STEP;
    if (widths[p.col] + step >= MIN_WIDTH && widths[other] - step >= MIN_WIDTH) {
      widths[p.col] += step;
      widths[other] -= step;
      next.widths = widths;
    }
  } else if (typeof action === "object" && "widths" in action && action.widths.length >= next.cols.length) {
    // Review M4: while arranging, an empty column to drop into may be drawn after the real ones; its width is left out.
    next.widths = action.widths.slice(0, next.cols.length).map((w) => Math.round(w * 10) / 10);
  } else if (typeof action === "object" && "drop" in action) {
    take();
    if (action.drop !== "top") {
      const { col: to } = action.drop;
      while (next.cols.length <= to && next.cols.length < columns) next.cols.push([]);
      const target = next.cols[Math.min(to, next.cols.length - 1)];
      // Dropped below itself in the same column: the place counts without it.
      const at = p && p.col === to && p.at < action.drop.at ? action.drop.at - 1 : action.drop.at;
      target.splice(Math.max(0, Math.min(at, target.length)), 0, id);
    } else if (id !== "onair") {
      return layout;
    }
  }
  // An empty column goes, with its width.
  const kept = next.cols.map((c, i) => ({ c, w: next.widths?.[i] })).filter((x) => x.c.length > 0);
  next.cols = kept.length ? kept.map((x) => x.c) : [[]];
  if (next.widths) next.widths = kept.length === next.widths.length ? next.widths : kept.map((x) => x.w ?? 30);
  return next;
}

function clampHeight(h: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h / 10) * 10));
}

/** The words read out after a move. */
export function movedWords(id: ArrangeId, action: ArrangeAction, after: LiveLayout): string {
  const name = BOX_NAMES[id];
  if (action === "top") return "On air is at the top again";
  if (typeof action === "object" && "into" in action) return `On air moved into column ${action.into + 1}`;
  if (action === "fit") return `${name} now fits its contents`;
  if (action === "taller" || action === "shorter" || (typeof action === "object" && "height" in action)) return `${name} ${after.heights[id] ?? ""} pixels high`;
  if (action === "narrower" || action === "wider") return `${name} ${action}`;
  return `${name} moved`;
}

const STORE_KEY = "lyre-live-layouts";

/** The layouts kept on this computer (this page's storage; nothing when storage is not there). */
export function loadLayouts(): SavedLayouts {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as SavedLayouts) : {};
  } catch {
    return {};
  }
}

export function saveLayouts(layouts: SavedLayouts): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(layouts));
  } catch {
    /* storage unavailable: the layout lasts for this visit */
  }
}

/** The kept layouts with this window size's one changed (null: back to the usual one). */
export function withLayout(saved: SavedLayouts, columns: Columns, layout: LiveLayout | null): SavedLayouts {
  const key = SIZE_NAMES[columns] as keyof SavedLayouts;
  const next = { ...saved };
  if (layout) next[key] = layout;
  else delete next[key];
  return next;
}
