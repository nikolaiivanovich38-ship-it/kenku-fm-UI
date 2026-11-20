/**
 * Round 9 (ROUND9.md §7, items 26 and 27): what the Track library keeps on this computer between visits: the columns
 * its list shows and the order of its filter chips. Kept in the page's storage beside the theme and the closed folders
 * (a later move of the page storage must list both keys, R60-GAPS.md §3 caveat 6); a storage that cannot be read
 * gives the usual columns and Tag list order.
 */
import { useSyncExternalStore } from "react";
import { inColumnOrder, USUAL_COLUMNS, type ColumnKey } from "./model";

export const COLUMNS_KEY = "lyre-library-columns";
export const FILTER_ORDER_KEY = "lyre-library-filter-order";

/** Tag list order, A to Z, Z to A, Most tracks first (the prototype's FORDERS). */
export type FilterOrder = "vocab" | "az" | "za" | "count";
export const FILTER_ORDERS: readonly (readonly [FilterOrder, string])[] = [
  ["vocab", "Tag list order"],
  ["az", "A to Z"],
  ["za", "Z to A"],
  ["count", "Most tracks first"],
];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable: the usual choice
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: kept for this visit only
  }
}

function readColumns(): readonly ColumnKey[] {
  try {
    const saved = JSON.parse(read(COLUMNS_KEY) ?? "null") as unknown;
    return Array.isArray(saved) ? inColumnOrder(saved.filter((x): x is string => typeof x === "string")) : USUAL_COLUMNS;
  } catch {
    return USUAL_COLUMNS;
  }
}
function readOrder(): FilterOrder {
  const saved = read(FILTER_ORDER_KEY);
  return FILTER_ORDERS.some(([k]) => k === saved) ? (saved as FilterOrder) : "vocab";
}

let columns = readColumns();
let order = readOrder();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setColumns(next: readonly string[]): void {
  columns = inColumnOrder(next);
  write(COLUMNS_KEY, JSON.stringify(columns));
  notify();
}
export function setFilterOrder(next: FilterOrder): void {
  order = next;
  write(FILTER_ORDER_KEY, next);
  notify();
}
export const useColumns = (): readonly ColumnKey[] => useSyncExternalStore(subscribe, () => columns);
export const useFilterOrder = (): FilterOrder => useSyncExternalStore(subscribe, () => order);

/** Back to what the page's storage says (tests, after changing it). */
export function rereadListPrefs(): void {
  columns = readColumns();
  order = readOrder();
  notify();
}

/** Chips in the chosen order; `values` start with [words, count], in tag list order. */
export function inFilterOrder<T extends readonly [string, number, ...unknown[]]>(values: readonly T[], how: FilterOrder): T[] {
  const words = (x: T) => x[0];
  if (how === "az") return [...values].sort((a, b) => words(a).localeCompare(words(b)));
  if (how === "za") return [...values].sort((a, b) => words(b).localeCompare(words(a)));
  if (how === "count") return [...values].sort((a, b) => b[1] - a[1] || words(a).localeCompare(words(b)));
  return [...values];
}
