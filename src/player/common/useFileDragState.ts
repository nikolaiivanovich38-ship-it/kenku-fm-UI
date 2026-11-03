import React, { useCallback, useEffect, useReducer } from "react";

import {
  dragHasFiles,
  dragReducer,
  initialDragState,
  leftTarget,
  pointerOutsideWindow,
} from "./dragState";

/**
 * React wiring for the drag-overlay state machine (BUG-1), shared by
 * useFolderDrop and useFileDrop.
 *
 * Opens only for file drags. While open it also listens on the window, so
 * the overlay closes when the drag leaves the window, on dragend, on Escape,
 * on a drop anywhere and when the window loses focus. Every handler calls
 * preventDefault and stopPropagation, so drops keep working when a
 * document-level guard prevents navigation on stray drops.
 */
export function useFileDragState() {
  const [{ dragging }, send] = useReducer(dragReducer, initialDragState);

  // Non-file drags (text, links) are left alone so inputs keep their
  // default drop behaviour and outer handlers still see them.
  const onDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!dragHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    send({ type: "enter", hasFiles: true });
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    send({
      type: "leave",
      outside: leftTarget(event.currentTarget, event.relatedTarget, event),
    });
  }, []);

  // dragover repeats while the pointer is over the target, so it also
  // reopens the overlay if a stray dragleave closed it mid-drag.
  const onDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!dragHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    send({ type: "enter", hasFiles: true });
  }, []);

  /** Closes the overlay; call at the start of a drop handler. */
  const endDrag = useCallback(() => send({ type: "drop" }), []);

  const cancel = useCallback(() => send({ type: "cancel" }), []);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    // relatedTarget is unreliable here (Chromium may leave it null inside
    // the page), so "left the window" is judged from the pointer position.
    function handleWindowDragLeave(event: DragEvent) {
      if (pointerOutsideWindow(event, window)) {
        cancel();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        cancel();
      }
    }
    // Capture phase: drop targets stop propagation of their own events.
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("dragend", cancel);
    window.addEventListener("drop", cancel, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("dragleave", handleWindowDragLeave, true);
      window.removeEventListener("dragend", cancel);
      window.removeEventListener("drop", cancel, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dragging, cancel]);

  return { dragging, onDragEnter, onDragLeave, onDragOver, endDrag, cancel };
}
