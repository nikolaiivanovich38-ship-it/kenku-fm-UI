import { describe, expect, it } from "vitest";
import { prototypeSeed } from "../../../common/lyre/seed";
import {
  findPad,
  keyOwner,
  moveMessage,
  neighbour,
  padKeyFrom,
  padTileName,
  place,
  resizeMessage,
  sizeText,
  usesOfBoard,
} from "./boardModel";

const seed = prototypeSeed();
const board = (id: string) => seed.boards.find((b) => b.id === id)!;

describe("pad board words and rules (boards.js helpers)", () => {
  it("says a board's size, pads, empty slots and spare pads", () => {
    expect(sizeText(board("combat"))).toBe("4 × 3, 11 pads, 1 empty");
    expect(sizeText(board("weather"))).toBe("4 × 2, 8 pads, 1 spare");
  });

  it("names a slot by row and column", () => {
    expect(place(4, 0)).toBe("row 1, column 1");
    expect(place(4, 11)).toBe("row 3, column 4");
  });

  it("finds a pad on the grid or among the spare pads", () => {
    expect(findPad(board("weather"), "owl")).toMatchObject({ where: "slot", index: 2 });
    expect(findPad(board("weather"), "mugs")).toMatchObject({ where: "spare", index: 0 });
    expect(findPad(board("weather"), "nope")).toBeNull();
  });

  it("finds another pad with the same key, ignoring case", () => {
    expect(keyOwner(board("combat"), "Q", "sword")?.label).toBe("Fireball");
    expect(keyOwner(board("combat"), "q", "fireball")).toBeNull();
    expect(keyOwner(board("combat"), "", "sword")).toBeNull();
  });

  it("takes letters, digits and F1 to F12 as pad keys, and nothing else", () => {
    expect(padKeyFrom("Q")).toBe("q");
    expect(padKeyFrom("7")).toBe("7");
    expect(padKeyFrom("F12")).toBe("F12");
    expect(padKeyFrom("F13")).toBeNull();
    expect(padKeyFrom(" ")).toBeNull();
    expect(padKeyFrom("ArrowLeft")).toBeNull();
  });

  it("moves between slots with the arrows and stops at the edges", () => {
    expect(neighbour(4, 3, 0, "ArrowRight")).toBe(1);
    expect(neighbour(4, 3, 0, "ArrowDown")).toBe(4);
    expect(neighbour(4, 3, 0, "ArrowLeft")).toBe(-1);
    expect(neighbour(4, 3, 11, "ArrowDown")).toBe(-1);
  });

  it("lists where a board is used: campaigns, sessions and scenes", () => {
    const uses = usesOfBoard(seed.campaigns, "weather");
    expect(uses).toHaveLength(8);
    expect(uses[0]).toMatchObject({ level: "campaign", label: "The Sunken Crown (whole campaign)", href: "#/campaign/crown" });
    expect(uses.some((u) => u.level === "scene" && u.label === "The Sunken Crown › Session 12 › The harbour at night")).toBe(true);
  });

  it("SFX-11: explains a resize: the grid full and the pads moved to spare, empty slots to fill, or the new size", () => {
    const b = board("weather");
    expect(resizeMessage({ ...b, cols: 4, rows: 1 }, ["Storm", "Owl"])).toBe("Grid is now 4 × 1 and full. 2 pads moved to Spare pads: Storm, Owl. Nothing was deleted.");
    const notAside = b.spare.map((p) => ({ ...p, aside: false }));
    expect(resizeMessage({ ...b, slots: [...b.slots.slice(0, 4), null, null, null, null], spare: notAside }, [])).toBe("Grid is now 4 × 2: 4 empty slots to fill.");
    expect(resizeMessage({ ...b, spare: [] }, [])).toBe("Grid is now 4 × 2. Pads fill it left to right, top to bottom.");
  });

  it("SFX-11: says which spare pads came back, and that a pad put aside by hand stays (round 5)", () => {
    const b = board("weather");
    expect(resizeMessage(b, [], ["Storm", "Owl"])).toBe("Grid is now 4 × 2. 2 spare pads came back onto it: Storm, Owl.");
    const roomy = { ...b, cols: 6, rows: 4, slots: [...b.slots, ...Array<null>(16).fill(null)] };
    expect(resizeMessage(roomy, [])).toBe("Grid is now 6 × 4: 16 empty slots to fill. Mugs clink stays in Spare pads, where you put it.");
    // A full grid has nowhere to put it, so there is nothing to say about it.
    expect(resizeMessage(b, [])).toBe("Grid is now 4 × 2. Pads fill it left to right, top to bottom.");
  });

  it("says where a pad went and what it swapped with", () => {
    const b = board("weather");
    const [thunder, wolf] = b.slots;
    expect(moveMessage(b, thunder!, 1, wolf, false)).toBe("Thunder crack moved to row 1, column 2, swapped with Wolf howl");
    expect(moveMessage(b, b.spare[0], 0, thunder, true)).toBe("Mugs clink moved to row 1, column 1, swapped with Thunder crack, which went to Spare pads");
    expect(moveMessage(b, thunder!, "spare", null, false)).toBe("Thunder crack moved to Spare pads");
  });

  it("names a pad tile with its visible label and key first", () => {
    const thunder = board("weather").slots[0]!;
    expect(padTileName(thunder, 4, 0, null)).toBe("Thunder crack 1: One-shot, row 1, column 1");
    expect(padTileName({ ...thunder, key: "" }, 4, 0, "previewing")).toBe("Thunder crack: One-shot, row 1, column 1, previewing");
  });
});
