/**
 * Reordering a list by dragging a row's handle (the prototype's cp-handle drag and drop): only a drag that starts on
 * the handle moves the row; the row under the pointer shows a line before or after it, and dropping moves the row
 * there. Keyboard users move rows from the row's ⋯ menu.
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

const after = (event: React.DragEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
};

function undraggable() {
  document.querySelectorAll("[data-drag][draggable='true']").forEach((row) => row.removeAttribute("draggable"));
}

export function useDragReorder(list: string, onMove: (from: number, to: number) => void): DragReorder {
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

  const reset = () => {
    from.current = null;
    setDragging(null);
    setMark(null);
    undraggable();
  };

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
      },
      onDragOver: (event) => {
        if (from.current === null) return;
        event.preventDefault();
        setMark(index === from.current ? null : { index, after: after(event) });
      },
      onDrop: (event) => {
        if (from.current === null) return;
        event.preventDefault();
        const start = from.current;
        let to = index + (after(event) ? 1 : 0);
        if (to > start) to--;
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
