import type { KeyboardCoordinateGetter } from "@dnd-kit/core";

/**
 * UX finding 2: moving a picked-up tab or bookmark with the arrow keys.
 * dnd-kit's `sortableKeyboardCoordinates` compares layout offsets, which did
 * not find the neighbouring tab in the scrolling tab strip, so the arrow keys
 * did nothing. This moves the item onto the nearest one before or after it
 * as drawn on screen: Left/Right for a row (`"x"`), Up/Down for a column.
 */
export function listKeyboardCoordinates(axis: "x" | "y"): KeyboardCoordinateGetter {
  const [back, forward] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  return (event, { active, context, currentCoordinates }) => {
    const step = event.code === back ? -1 : event.code === forward ? 1 : 0;
    if (step === 0) {
      return undefined;
    }
    event.preventDefault();
    const size = (axis === "x" ? context.translatedRect?.width : context.translatedRect?.height) ?? 0;
    const centre = currentCoordinates[axis] + size / 2;
    const middleOf = (rect: DOMRect) => (axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2);
    let best: number | undefined;
    for (const [id, container] of Object.entries(context.droppableContainers)) {
      const node = container?.node.current;
      if (!node || container?.disabled || id === active) {
        continue;
      }
      const middle = middleOf(node.getBoundingClientRect());
      const ahead = step < 0 ? middle < centre - 1 : middle > centre + 1;
      if (ahead && (best === undefined || Math.abs(middle - centre) < Math.abs(best - centre))) {
        best = middle;
      }
    }
    if (best === undefined) {
      return undefined;
    }
    return axis === "x"
      ? { x: best - size / 2, y: currentCoordinates.y }
      : { x: currentCoordinates.x, y: best - size / 2 };
  };
}
