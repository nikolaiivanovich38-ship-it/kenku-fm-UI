import { describe, expect, it } from "vitest";
import { DRAG_INSTRUCTIONS, dragAnnouncements } from "./dragAnnouncements";

const names: Record<string, string> = { a: "Tabletop Audio", b: "Syrinscape", c: "YouTube", "folder:f": "the Combat folder" };
const announce = dragAnnouncements({
  nameOf: (id) => names[id] ?? "an item",
  order: () => ["a", "b", "c"],
});

describe("drag announcements (UX finding 2)", () => {
  it("speaks in plain sentences with the item's name, never an internal id", () => {
    expect(announce.onDragStart("a")).toBe("Picked up Tabletop Audio. It is number 1 of 3.");
    // Over itself at first: "Picked up …" is left to be heard.
    expect(announce.onDragOver("a", "a")).toBeUndefined();
    expect(announce.onDragOver("a", "c")).toBe("Tabletop Audio is over YouTube, number 3 of 3.");
    expect(announce.onDragOver("a", "folder:f")).toBe("Tabletop Audio is over the Combat folder.");
    expect(announce.onDragOver("a", undefined)).toBe("Tabletop Audio is not over a place it can go.");
    expect(announce.onDragOver("a", "a")).toBe("Tabletop Audio is back where it was, number 1 of 3.");
    expect(announce.onDragOver("a", "c")).toBe("Tabletop Audio is over YouTube, number 3 of 3.");
    expect(announce.onDragEnd("a", "c")).toBe("Dropped Tabletop Audio. It is now number 3 of 3.");
    expect(announce.onDragEnd("a", "folder:f")).toBe("Moved Tabletop Audio into the Combat folder.");
    expect(announce.onDragEnd("a", undefined)).toBe("Tabletop Audio was put back where it was.");
    expect(announce.onDragCancel("a")).toBe("Stopped moving Tabletop Audio. It is back where it was.");
  });

  it("says where the item landed even if the list has already been reordered", () => {
    let order = ["a", "b", "c"];
    const live = dragAnnouncements({ nameOf: (id) => names[id], order: () => order });
    live.onDragStart("c");
    live.onDragOver("c", "a");
    order = ["c", "a", "b"];
    expect(live.onDragEnd("c", "a")).toBe("Dropped YouTube. It is now number 1 of 3.");
  });

  it("tells keyboard users how to move an item", () => {
    expect(DRAG_INSTRUCTIONS.draggable).toBe(
      "To move it, press Space, then the arrow keys. Press Space again to drop it, or Escape to cancel.",
    );
  });
});
