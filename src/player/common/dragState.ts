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

/** Pointer position of a drag event, in viewport (client) coordinates. */
export type DragPoint = { clientX: number; clientY: number };

/**
 * True when a dragleave on `target` means the pointer really left it: it
 * moved to an element outside `target`, or, when Chromium gives no
 * `relatedTarget` (it may omit it even for moves inside the page), the
 * pointer is no longer within the target's box.
 */
export function leftTarget(
  target: EventTarget | null,
  relatedTarget: EventTarget | null,
  point?: DragPoint
): boolean {
  if (!relatedTarget) {
    if (!point || !(target instanceof Element)) {
      return true;
    }
    const box = target.getBoundingClientRect();
    return !(
      point.clientX >= box.left &&
      point.clientX < box.right &&
      point.clientY >= box.top &&
      point.clientY < box.bottom
    );
  }
  if (target instanceof Node && relatedTarget instanceof Node) {
    return !target.contains(relatedTarget);
  }
  return true;
}

/**
 * True when a drag event's position is on or beyond the window's edge, which
 * is how a window-level dragleave is recognised as "the drag left the window"
 * (BUG-1). `relatedTarget` cannot be used for this because Chromium may leave
 * it null for ordinary element-to-element moves.
 */
export function pointerOutsideWindow(
  point: DragPoint,
  viewport: Pick<Window, "innerWidth" | "innerHeight">
): boolean {
  return (
    point.clientX <= 0 ||
    point.clientY <= 0 ||
    point.clientX >= viewport.innerWidth ||
    point.clientY >= viewport.innerHeight
  );
}
