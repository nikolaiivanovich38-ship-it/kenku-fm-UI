/**
 * Gap ordering for lists the game master arranges by hand (playlist entries,
 * board entries, folders, tags …).
 *
 * Each row has a REAL `position`. New rows go GAP apart; a row moved between
 * two others takes the midpoint, so no other row changes. After about fifty
 * moves into the same gap the two neighbours are too close to split; only
 * then is that one list renumbered (in the same undo step as the move).
 *
 * Positions are unique within a list (a UNIQUE index per ordered table, see
 * schema/v002-design.ts), so rows that change place together go through
 * temporary positions first (assignPositions): no two rows ever share one,
 * even for a moment, and undo replays the same steps backwards.
 */
import type { SQLInputValue } from "./sqlite";
import type { Placement } from "./types";
import type { Store } from "./store";
import { NotFoundError, ValidationError } from "./errors";

export const GAP = 1024;

/**
 * A position strictly between `before` and `after` (either may be null for
 * "nothing there"), or null when the two are too close to split.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return GAP;
  if (before === null) return (after as number) - GAP;
  if (after === null) return before + GAP;
  const middle = before + (after - before) / 2;
  return middle > before && middle < after ? middle : null;
}

/** One ordered list: the rows of `table` matching `scope` (SQL with ? placeholders). */
export type OrderedList = {
  table: string;
  scope: string;
  params: SQLInputValue[];
  /**
   * The column naming a row within the list (default "id"). Membership lists
   * such as a campaign's playlists name rows by what they hold ("playlist_id").
   */
  idColumn?: string;
};

const idOf = (list: OrderedList) => list.idColumn ?? "id";

/** Far below any position a list reaches by gap ordering; used only inside one change. */
const TEMPORARY_BASE = -1e12;

/**
 * Gives `ids` (rows of `list`) the `positions`, in two passes through
 * temporary positions, so the list's UNIQUE position index never sees two rows
 * on one position. Call inside a store change.
 */
export function assignPositions(store: Store, list: OrderedList, ids: readonly string[], positions: readonly number[]) {
  const id = idOf(list);
  const set = `UPDATE ${list.table} SET position = ? WHERE ${id} = ? AND ${list.scope}`;
  if (ids.length > 1) ids.forEach((row, index) => store.run(set, TEMPORARY_BASE - index, row, ...list.params));
  ids.forEach((row, index) => store.run(set, positions[index], row, ...list.params));
}

function rebalance(store: Store, list: OrderedList) {
  const rows = store.all<{ id: string }>(
    `SELECT ${idOf(list)} AS id FROM ${list.table} WHERE ${list.scope} ORDER BY position`,
    ...list.params,
  );
  assignPositions(
    store,
    list,
    rows.map((row) => row.id),
    rows.map((_, index) => (index + 1) * GAP),
  );
}

function neighbours(
  store: Store,
  list: OrderedList,
  placement: Placement,
  moving: readonly string[],
): [number | null, number | null] {
  const id = idOf(list);
  const exclude = moving.length === 0 ? "" : ` AND ${id} NOT IN (${moving.map(() => "?").join(", ")})`;
  const edge = (direction: "ASC" | "DESC") =>
    store.get<{ position: number }>(
      `SELECT position FROM ${list.table} WHERE ${list.scope}${exclude} ORDER BY position ${direction} LIMIT 1`,
      ...list.params,
      ...moving,
    )?.position ?? null;
  if (placement === "start") return [null, edge("ASC")];
  if (placement === "end") return [edge("DESC"), null];

  const anchorId = "before" in placement ? placement.before : placement.after;
  if (moving.includes(anchorId)) throw new ValidationError("placement", "An item cannot be placed next to itself.");
  const anchor = store.get<{ position: number }>(
    `SELECT position FROM ${list.table} WHERE ${id} = ? AND ${list.scope}`,
    anchorId,
    ...list.params,
  );
  if (!anchor) throw new NotFoundError("item in this list", anchorId);
  if ("before" in placement) {
    const previous = store.get<{ position: number }>(
      `SELECT position FROM ${list.table} WHERE ${list.scope}${exclude} AND position < ? ORDER BY position DESC LIMIT 1`,
      ...list.params,
      ...moving,
      anchor.position,
    );
    return [previous?.position ?? null, anchor.position];
  }
  const next = store.get<{ position: number }>(
    `SELECT position FROM ${list.table} WHERE ${list.scope}${exclude} AND position > ? ORDER BY position ASC LIMIT 1`,
    ...list.params,
    ...moving,
    anchor.position,
  );
  return [anchor.position, next?.position ?? null];
}

const asList = (moving: string | readonly string[] | null): readonly string[] =>
  moving === null ? [] : typeof moving === "string" ? [moving] : moving;

/**
 * The position for a row placed in `list`. `moving` is the row (or rows) being
 * moved, left out of the neighbours; null for a new row. Call inside a store change.
 */
export function positionFor(
  store: Store,
  list: OrderedList,
  placement: Placement,
  moving: string | readonly string[] | null = null,
): number {
  const [before, after] = neighbours(store, list, placement, asList(moving));
  const position = positionBetween(before, after);
  if (position !== null) return position;
  rebalance(store, list);
  const [before2, after2] = neighbours(store, list, placement, asList(moving));
  const retry = positionBetween(before2, after2);
  if (retry === null) throw new Error("Could not find room in the list after renumbering it.");
  return retry;
}

/**
 * Positions for `count` rows placed together, in order: new rows, or the rows
 * in `moving`. Rows are spread evenly across the gap, so adding 500 tracks at
 * once never runs out of room.
 */
export function positionsFor(
  store: Store,
  list: OrderedList,
  placement: Placement,
  count: number,
  moving: readonly string[] = [],
): number[] {
  if (count === 0) return [];
  let [before, after] = neighbours(store, list, placement, moving);
  const span = () => {
    if (before === null && after === null) return { start: 0, step: GAP };
    if (before === null) return { start: (after as number) - (count + 1) * GAP, step: GAP };
    if (after === null) return { start: before, step: GAP };
    return { start: before, step: (after - before) / (count + 1) };
  };
  let { start, step } = span();
  const fits = () => {
    const last = start + count * step;
    return start + step > start && (after === null || last < after) && step > 0;
  };
  if (!fits() || (before !== null && after !== null && step < 1e-6)) {
    rebalance(store, list);
    [before, after] = neighbours(store, list, placement, moving);
    ({ start, step } = span());
  }
  return Array.from({ length: count }, (_, index) => start + (index + 1) * step);
}
