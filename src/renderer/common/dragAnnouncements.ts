import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core";

/**
 * UX finding 2: what screen readers hear while a tab or bookmark is moved
 * with the keyboard. dnd-kit's defaults read out internal ids ("Draggable
 * item 74e2078c-… was moved over droppable area …").
 */
export const DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "To move it, press Space, then the arrow keys. Press Space again to drop it, or Escape to cancel.",
};

type ListInfo = {
  /** The name to say for an id, e.g. a bookmark's title or "the Combat folder". */
  nameOf: (id: string) => string;
  /** The ids of the items that can be reordered, in their current order. */
  order: () => string[];
};

export function dragAnnouncements({ nameOf, order }: ListInfo): Announcements {
  const position = (id: string) => {
    const ids = order();
    const index = ids.indexOf(id);
    return index === -1 ? undefined : `number ${index + 1} of ${ids.length}`;
  };
  // dnd-kit reports the item over itself right after it is picked up; saying
  // so would cut off "Picked up …", so only a change of place is announced.
  let lastOver: string | undefined;
  // Where the item will land, worked out while it hovers: by the time the
  // drop is announced the list may already show its new order.
  let landing: string | undefined;
  return {
    onDragStart(id) {
      lastOver = id;
      landing = position(id);
      const where = position(id);
      return `Picked up ${nameOf(id)}.${where ? ` It is ${where}.` : ""}`;
    },
    onDragOver(id, overId) {
      if (overId === lastOver) {
        return undefined;
      }
      lastOver = overId;
      if (overId === undefined) {
        landing = undefined;
        return `${nameOf(id)} is not over a place it can go.`;
      }
      const where = position(overId);
      landing = where;
      if (overId === id) {
        return `${nameOf(id)} is back where it was${where ? `, ${where}` : ""}.`;
      }
      return `${nameOf(id)} is over ${nameOf(overId)}${where ? `, ${where}` : ""}.`;
    },
    onDragEnd(id, overId) {
      if (overId === undefined) {
        return `${nameOf(id)} was put back where it was.`;
      }
      const where = position(overId) === undefined ? undefined : landing;
      return where ? `Dropped ${nameOf(id)}. It is now ${where}.` : `Moved ${nameOf(id)} into ${nameOf(overId)}.`;
    },
    onDragCancel(id) {
      return `Stopped moving ${nameOf(id)}. It is back where it was.`;
    },
  };
}
