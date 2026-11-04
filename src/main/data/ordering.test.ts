import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAP, positionBetween, positionFor, positionsFor, type OrderedList } from "./ordering";
import { makeTestStore } from "./test/testStore";

describe("positionBetween", () => {
  it("leaves a gap at the ends and splits the middle", () => {
    expect(positionBetween(null, null)).toBe(GAP);
    expect(positionBetween(2048, null)).toBe(2048 + GAP);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });

  it("says when two positions are too close to split", () => {
    expect(positionBetween(1, 1)).toBeNull();
    expect(positionBetween(1, 1 + Number.EPSILON)).toBeNull();
  });
});

describe("positionFor in a table", () => {
  let t: ReturnType<typeof makeTestStore>;
  const list: OrderedList = { table: "tag_groups", scope: "1 = 1", params: [] };
  const order = () =>
    t.store.all<{ id: string }>("SELECT id FROM tag_groups ORDER BY position").map((row) => row.id);
  const add = (id: string, position: number) =>
    t.store.run("INSERT INTO tag_groups (id, name, position) VALUES (?, ?, ?)", id, id, position);

  beforeEach(() => {
    t = makeTestStore();
    t.store.run("DELETE FROM tag_groups");
    add("a", 1024);
    add("b", 2048);
    add("c", 3072);
  });
  afterEach(() => t.close());

  it("places at the start, at the end, before and after a row", () => {
    expect(positionFor(t.store, list, "start")).toBe(0);
    expect(positionFor(t.store, list, "end")).toBe(3072 + GAP);
    expect(positionFor(t.store, list, { before: "b" })).toBe(1536);
    expect(positionFor(t.store, list, { after: "b" })).toBe(2560);
  });

  it("ignores the row being moved when finding neighbours", () => {
    // Moving c to just after a: between a and b.
    expect(positionFor(t.store, list, { after: "a" }, "c")).toBe(1536);
    // Moving a to the end: after c.
    expect(positionFor(t.store, list, "end", "a")).toBe(3072 + GAP);
  });

  it("renumbers only when a gap is used up, keeping the order", () => {
    // Keep adding rows just before b: the gap before b halves every time.
    for (let i = 0; i < 80; i++) {
      t.store.change("add", () => add(`x${i}`, positionFor(t.store, list, { before: "b" })));
    }
    const ids = order();
    expect(ids[0]).toBe("a");
    expect(ids.slice(1, 81)).toEqual(Array.from({ length: 80 }, (_, i) => `x${i}`));
    expect(ids.slice(81)).toEqual(["b", "c"]);
    const positions = t.store.all<{ position: number }>("SELECT position FROM tag_groups ORDER BY position");
    expect(new Set(positions.map((p) => p.position)).size).toBe(positions.length);
  });

  it("spreads many new rows evenly in one go", () => {
    const positions = positionsFor(t.store, list, { before: "b" }, 500);
    expect(positions).toHaveLength(500);
    expect(positions[0]).toBeGreaterThan(1024);
    expect(positions[499]).toBeLessThan(2048);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(positionsFor(t.store, list, "start", 2)).toEqual([1024 - 2 * GAP, 1024 - GAP]);
    expect(positionsFor(t.store, list, "end", 2)).toEqual([3072 + GAP, 3072 + 2 * GAP]);
  });

  it("refuses to place a row next to itself or next to a row in another list", () => {
    expect(() => positionFor(t.store, list, { before: "a" }, "a")).toThrow(/itself/);
    expect(() => positionFor(t.store, list, { before: "nope" })).toThrow(/No item in this list/);
  });
});
