/**
 * Reordering a list by dragging a row's handle (the prototype's cp-handle drag and drop): only a drag that starts on
 * the handle moves the row (or, `rowsDraggable`, a drag anywhere on a row that is always draggable); the row under the
 * pointer shows a line before or after it, and dropping moves the row exactly there. Keyboard users move rows from the
 * row's ⋯ menu or with Alt+Up and Alt+Down, which each list wires itself.
 *
 * Between rows and below the last one (the rest of the box the list is in, its pane), the line shows at the nearest
 * place and a drop lands there: below the last row is the last place (Nik, 0.5.0: a scene or session could not be
 * dropped last, because only the rows took a drop). A full list leaves no room below its last row (its box ends right
 * under it), so the last row's lower half is the last place too, with the line after it.
 *
 * 0.5.2 (Nik's list, item 36: "Often dragging a thing puts it one too far down or one too far up. It needs to be
 * exact"): the line shows only where a drop would move the row. A row's upper half is the place before it and its lower
 * half the place after it, for every row alike (a playlist's dividers are rows too, so a drop lands on the side of a
 * divider the line is on). `zone: "list"` keeps a list inside another list's row (a scene's music in the scenes) to its
 * own box, so a drag over the rest of the pane is not taken for it.
 *
 * `grid: true` (0.5.1, the Campaigns screen's cards): the items are laid out in rows of cards, so a card's left half is
 * the place before it and its right half the place after it.
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface DragReorder {
  /** Spread on the handle (a decoration: the ⋯ menu and Alt+Up / Alt+Down are the keyboard's way). */
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

export interface DragReorderOptions {
  /** Cards in rows: left and right halves instead of upper and lower. */
  grid?: boolean;
  /** The box that takes drags between and below the rows: the pane's body (default), or the list's own element. */
  zone?: "pane" | "list";
  /** The rows are draggable all the time (they render draggable themselves); a drag anywhere on a row moves it. */
  rowsDraggable?: boolean;
}

const after = (event: { clientX: number; clientY: number; currentTarget: Element }, grid: boolean) => {
  const box = event.currentTarget.getBoundingClientRect();
  return grid ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
};

/** A handle makes its row draggable while it is pressed; this takes that back (rows drawn draggable keep it). */
function undraggable() {
  document.querySelectorAll("[data-drag][data-drag-armed]").forEach((row) => {
    row.removeAttribute("draggable");
    row.removeAttribute("data-drag-armed");
  });
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
export const indexFor = (start: number, slot: number): number => (slot > start ? slot - 1 : slot);

export function useDragReorder(list: string, onMove: (from: number, to: number) => void, { grid = false, zone = "pane", rowsDraggable = false }: DragReorderOptions = {}): DragReorder {
  const from = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [mark, setMark] = useState<{ index: number; after: boolean } | null>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const selector = `[data-drag="${CSS.escape(list)}"]`;

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
  const boxOf = (row: Element) => (zone === "list" ? row.parentElement : (row.closest(".pane-body") ?? row.parentElement));
  const rowsIn = (box: Element | null) => (box ? Array.from(box.querySelectorAll(selector)) : []);

  const reset = () => {
    from.current = null;
    setDragging(null);
    setMark(null);
    undraggable();
    stopZone.current?.();
    stopZone.current = null;
  };

  /** True when a drop at the place before `slot` would leave the dragged row where it is. */
  const stays = (slot: number) => from.current === null || indexFor(from.current, slot) === from.current;
  /** The line at the place before `slot` (0 to `count`), or none where the dragged row already is. */
  const markSlot = (slot: number, count: number) => setMark(stays(slot) ? null : slot < count ? { index: slot, after: false } : { index: count - 1, after: true });
  /** The line on the side of the row under the pointer, or none where the dragged row already is. */
  const markRow = (index: number, isAfter: boolean) => setMark(stays(index + (isAfter ? 1 : 0)) ? null : { index, after: isAfter });

  /** Listen on the box around the list for a drag over a gap or below the last row, until the drag ends. */
  const watchZone = (row: HTMLElement) => {
    stopZone.current?.();
    const box = boxOf(row);
    if (!box) return;
    const onRow = (event: Event) => event.target instanceof Element && event.target.closest(selector) !== null;
    const onOver = (event: DragEvent) => {
      // A row handles its own drags (its handler runs after this one, from React's root).
      if (from.current === null || onRow(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const all = rowsIn(box);
      markSlot(slotAt(all, event.clientX, event.clientY, grid), all.length);
    };
    const onDrop = (event: DragEvent) => {
      if (from.current === null || onRow(event)) return;
      event.preventDefault();
      const start = from.current;
      const to = indexFor(start, slotAt(rowsIn(box), event.clientX, event.clientY, grid));
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
      onPointerDown: (event) => {
        const row = event.currentTarget.closest(selector);
        if (!row || row.getAttribute("draggable") === "true") return;
        row.setAttribute("draggable", "true");
        row.setAttribute("data-drag-armed", "");
      },
    },
    rowProps: (index) => ({
      "data-drag": list,
      "data-idx": index,
      onDragStart: (event) => {
        const row = event.currentTarget;
        if (event.target !== row || row.getAttribute("draggable") !== "true") return;
        if (!rowsDraggable && !row.hasAttribute("data-drag-armed")) return;
        from.current = index;
        event.dataTransfer.effectAllowed = "move";
        try {
          event.dataTransfer.setData("text/plain", String(index));
        } catch {
          // Some browsers refuse data on a drag; the move works without it.
        }
        setDragging(index);
        watchZone(row);
      },
      onDragOver: (event) => {
        if (from.current === null) return;
        // Handled here: the page's drop guard (SEC-7) would otherwise refuse the drop.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        markRow(index, after(event, grid));
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
