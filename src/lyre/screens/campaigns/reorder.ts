/**
 * Reordering a list by dragging a row's handle (the prototype's cp-handle drag and drop): only a drag that starts on
 * the handle moves the row; the row under the pointer shows a line before or after it, and dropping moves the row
 * there. Keyboard users move rows from the row's ⋯ menu.
 *
 * Between rows and below the last one (the rest of the box the list is in, its pane), the line shows at the nearest
 * place and a drop lands there: below the last row is the last place (Nik, 0.5.0: a scene or session could not be
 * dropped last, because only the rows took a drop).
 *
 * `grid: true` (0.5.1, the Campaigns screen's cards): the items are laid out in rows of cards, so a card's left half is
 * the place before it and its right half the place after it.
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface DragReorder {
  /** Spread on the handle (a decoration: the ⋯ menu is the keyboard's way). */
  handleProps: { onPointerDown: (event: React.PointerEvent<HTMLElement>) => void };
  /** Spread on each row. */
  rowProps: (index: number) => {
    "data-drag": string;
    "data-idx": number;
    onDragStart: (event: React.DragEvent<HTMLElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLElement>) => void;
    onDrop: (event: React.DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  /** Class names for a row: being dragged, or showing where the drop lands. */
  rowClass: (index: number) => string;
  /** True while a row of this list is being dragged (other drops, such as files, leave it alone). */
  isDragging: () => boolean;
}

const after = (event: React.DragEvent<HTMLElement>, grid: boolean) => {
  const box = event.currentTarget.getBoundingClientRect();
  return grid ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
};

function undraggable() {
  document.querySelectorAll("[data-drag][draggable='true']").forEach((row) => row.removeAttribute("draggable"));
}

/**
 * Where in the list a drop at a point lands: before the first row whose middle is below it, else after the last. In a
 * grid: before the first card the point is above, or level with and left of its middle.
 */
function slotAt(rows: readonly Element[], clientX: number, clientY: number, grid: boolean): number {
  const i = rows.findIndex((row) => {
    const box = row.getBoundingClientRect();
    if (grid) return clientY < box.top || (clientY <= box.bottom && clientX < box.left + box.width / 2);
    return clientY < box.top + box.height / 2;
  });
  return i < 0 ? rows.length : i;
}

/** The row's new index once it leaves `start` for the place before `slot` (0 to the number of rows). */
const indexFor = (start: number, slot: number) => (slot > start ? slot - 1 : slot);

export function useDragReorder(list: string, onMove: (from: number, to: number) => void, { grid = false }: { grid?: boolean } = {}): DragReorder {
  const from = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [mark, setMark] = useState<{ index: number; after: boolean } | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  // A press on a handle that does not become a drag leaves the row as it was.
  useEffect(() => {
    const onPointerUp = () => {
      if (from.current === null) undraggable();
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, []);

  // The box around the list (its pane's body) while a row is dragged: it takes the drags that miss every row.
  const stopZone = useRef<(() => void) | null>(null);

  const reset = () => {
    from.current = null;
    setDragging(null);
    setMark(null);
    undraggable();
    stopZone.current?.();
    stopZone.current = null;
  };

  /** Listen on the box around the list for a drag over a gap or below the last row, until the drag ends. */
  const watchZone = (row: HTMLElement) => {
    stopZone.current?.();
    const box = row.closest(".pane-body") ?? row.parentElement;
    if (!box) return;
    const rows = () => Array.from(box.querySelectorAll(`[data-drag="${list}"]`));
    const onRow = (event: Event) => event.target instanceof Element && event.target.closest(`[data-drag="${list}"]`) !== null;
    const onOver = (event: DragEvent) => {
      // A row handles its own drags (its handler runs after this one, from React's root).
      if (from.current === null || onRow(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const all = rows();
      const slot = slotAt(all, event.clientX, event.clientY, grid);
      if (indexFor(from.current, slot) === from.current) setMark(null);
      else setMark(slot < all.length ? { index: slot, after: false } : { index: all.length - 1, after: true });
    };
    const onDrop = (event: DragEvent) => {
      if (from.current === null || onRow(event)) return;
      event.preventDefault();
      const start = from.current;
      const to = indexFor(start, slotAt(rows(), event.clientX, event.clientY, grid));
      reset();
      if (to !== start) move.current(start, to);
    };
    box.addEventListener("dragover", onOver as EventListener);
    box.addEventListener("drop", onDrop as EventListener);
    stopZone.current = () => {
      box.removeEventListener("dragover", onOver as EventListener);
      box.removeEventListener("drop", onDrop as EventListener);
    };
  };
  // A list taken off the screen mid-drag lets go of its box.
  useEffect(() => () => stopZone.current?.(), []);

  return {
    handleProps: {
      onPointerDown: (event) => event.currentTarget.closest(`[data-drag="${list}"]`)?.setAttribute("draggable", "true"),
    },
    rowProps: (index) => ({
      "data-drag": list,
      "data-idx": index,
      onDragStart: (event) => {
        if (event.target !== event.currentTarget || event.currentTarget.getAttribute("draggable") !== "true") return;
        from.current = index;
        event.dataTransfer.effectAllowed = "move";
        try {
          event.dataTransfer.setData("text/plain", String(index));
        } catch {
          // Some browsers refuse data on a drag; the move works without it.
        }
        setDragging(index);
        watchZone(event.currentTarget);
      },
      onDragOver: (event) => {
        if (from.current === null) return;
        // Handled here: the page's drop guard (SEC-7) would otherwise refuse the drop.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setMark(index === from.current ? null : { index, after: after(event, grid) });
      },
      onDrop: (event) => {
        if (from.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        const start = from.current;
        const to = indexFor(start, index + (after(event, grid) ? 1 : 0));
        reset();
        if (to !== start) move.current(start, to);
      },
      onDragEnd: reset,
    }),
    rowClass: (index) =>
      [dragging === index && "cp-dragging", mark?.index === index && (mark.after ? "cp-drop-after" : "cp-drop-before")].filter(Boolean).join(" "),
    isDragging: () => from.current !== null,
  };
}
