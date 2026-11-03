/**
 * Pure state machine for the "drop files here" overlays (BUG-1).
 *
 * The overlay must open only for file drags and must always close again:
 * on drop, when the drag leaves the window or the drop target, on dragend,
 * on Escape and when the window loses focus. Keeping the rules here, free of
 * React and the DOM, lets them be unit tested and reused by the rebuilt
 * interface.
 */

/** What happened to the drag, as seen by a drop target. */
export type DragEventKind =
  /** A drag entered the target; `hasFiles` says whether it carries files. */
  | { type: "enter"; hasFiles: boolean }
  /** The drag left the target; `outside` is false when it only moved onto a child. */
  | { type: "leave"; outside: boolean }
  /** Files were dropped. */
  | { type: "drop" }
  /** The drag ended or was cancelled (dragend, Escape, window blur, left the window). */
  | { type: "cancel" };

/** Whether a file drag is over the target. */
export type DragState = { dragging: boolean };

export const initialDragState: DragState = { dragging: false };

/** Next overlay state after a drag event. */
export function dragReducer(state: DragState, event: DragEventKind): DragState {
  switch (event.type) {
    case "enter":
      return event.hasFiles ? { dragging: true } : state;
    case "leave":
      return event.outside ? { dragging: false } : state;
    case "drop":
    case "cancel":
      return { dragging: false };
  }
}

/**
 * True when the drag carries files from the operating system. Text, links
 * and in-app drags (such as reordering playlists) do not.
 */
export function dragHasFiles(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined
): boolean {
  if (!dataTransfer?.types) {
    return false;
  }
  return Array.from(dataTransfer.types).includes("Files");
}

/**
 * True when a dragleave on `target` means the pointer really left it:
 * either it left the window (`relatedTarget` is null) or it moved to an
 * element outside `target`.
 */
export function leftTarget(
  target: EventTarget | null,
  relatedTarget: EventTarget | null
): boolean {
  if (!relatedTarget) {
    return true;
  }
  if (target instanceof Node && relatedTarget instanceof Node) {
    return !target.contains(relatedTarget);
  }
  return true;
}
