/**
 * Dragging a row of a list by its handle in a screen test (jsdom has no layout, so rows are laid out by hand): rows 40
 * px high, 6 px apart, from 100 px down, in a box (the list's pane body, or the list itself) that ends right under the
 * last row, as a full list does. 0.5.2 (Nik's item 36): every list that reorders by dragging is checked with it, above
 * and below its first, a middle and its last row (and a divider).
 */
import { fireEvent } from "@testing-library/react";

export type Half = "upper" | "lower";

const ROW_TOP = 100;
const ROW_STEP = 46;
const ROW_HEIGHT = 40;

function box(y: number, height: number, x = 0, width = 600): DOMRect {
  return { top: y, bottom: y + height, height, left: x, right: x + width, width, x, y, toJSON: () => ({}) } as DOMRect;
}

export interface DragOptions {
  /** Runs after the dragover, before the drop (to look at the line). */
  between?: () => void;
  /** The element pressed to start the drag (default: the row's "Drag to…" handle; null: the row itself). */
  handle?: (row: HTMLElement) => HTMLElement | null;
  /** Cards two to a row, 300 px wide: "upper" is the card's left half, "lower" its right half. */
  grid?: boolean;
}

/** The row's drag handle: the element whose hover text starts "Drag to". */
export const dragHandle = (row: HTMLElement): HTMLElement | null => row.querySelector<HTMLElement>("[title^='Drag to']");

/** Drag `rows[from]` and drop it on the upper or lower half of `rows[onto]`, with the pointer over the row's contents. */
export function dragRow(rows: readonly HTMLElement[], from: number, onto: number, half: Half, { between = () => undefined, handle = dragHandle, grid = false }: DragOptions = {}): void {
  const top = (i: number) => (grid ? ROW_TOP + Math.floor(i / 2) * 132 : ROW_TOP + i * ROW_STEP);
  const left = (i: number) => (grid ? (i % 2) * 312 : 0);
  const last = rows.length - 1;
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const i = rows.indexOf(this as HTMLElement);
    if (i >= 0) return grid ? box(top(i), 120, left(i), 300) : box(top(i), ROW_HEIGHT);
    if (this.classList.contains("pane-body") || this === rows[0]?.parentElement) return box(ROW_TOP - 10, top(last) + ROW_HEIGHT - (ROW_TOP - 10));
    return original.call(this);
  };
  try {
    const data = { effectAllowed: "", dropEffect: "", types: ["text/plain"], files: [] as File[], setData: (): void => undefined };
    const pressed = handle(rows[from]);
    if (pressed) fireEvent.pointerDown(pressed);
    fireEvent.dragStart(rows[from], { dataTransfer: data });
    const at = (type: string) => {
      const event = grid
        ? new MouseEvent(type, { bubbles: true, cancelable: true, clientX: left(onto) + (half === "upper" ? 40 : 260), clientY: top(onto) + 60 })
        : new MouseEvent(type, { bubbles: true, cancelable: true, clientY: top(onto) + (half === "upper" ? 8 : 32) });
      Object.defineProperty(event, "dataTransfer", { value: data });
      fireEvent(rows[onto].firstElementChild ?? rows[onto], event);
    };
    at("dragover");
    between();
    at("drop");
    fireEvent.dragEnd(rows[from]);
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

/** The order a list has once `from` is dropped on that half of `onto`, worked out from the names alone. */
export function orderAfterDrop<T>(items: readonly T[], from: number, onto: number, half: Half): T[] {
  const slot = onto + (half === "lower" ? 1 : 0);
  const moved = items[from];
  const out = items.slice(0, slot).concat([moved], items.slice(slot));
  out.splice(slot <= from ? from + 1 : from, 1);
  return out;
}

/** Above and below the first, a middle and the last row: [onto, half] for a list of `count` rows. */
export function dropPlaces(count: number): [number, Half][] {
  const middle = Math.floor((count - 1) / 2);
  return [
    [0, "upper"],
    [0, "lower"],
    [middle, "upper"],
    [middle, "lower"],
    [count - 1, "upper"],
    [count - 1, "lower"],
  ];
}
