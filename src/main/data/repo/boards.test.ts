/**
 * Pad boards (DAT-11, design round 4): a grid of 1 to 8 columns and rows,
 * pads in its cells, and spare pads off the grid. Shrinking the grid moves
 * pads to Spare pads; nothing is deleted. Matches design/prototype/src/views/boards.js.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { UndoHistory } from "../undo";
import { createTracks, deleteTracks } from "./tracks";
import { createTag, deleteTag, listTagGroups } from "./tags";
import {
  addPad,
  createBoard,
  deleteBoard,
  deletePads,
  duplicatePad,
  getBoard,
  getBoardLayout,
  getPad,
  listBoards,
  listPads,
  movePad,
  putPadBack,
  resizeBoard,
  takePadHotkey,
  updateBoard,
  updatePad,
} from "./boards";

let t: ReturnType<typeof makeTestStore>;
let history: UndoHistory;
beforeEach(() => {
  t = makeTestStore();
  history = new UndoHistory(t.store);
});
afterEach(() => t.close());

const labels = (boardId: string) => {
  const layout = getBoardLayout(t.store, boardId);
  return { slots: layout.slots.map((p) => (p ? p.label : null)), spare: layout.spare.map((p) => p.label) };
};

/** A 3 x 2 board with pads A to E and one empty cell at the end. */
function sampleBoard() {
  const board = createBoard(t.store, { title: "Combat", cols: 3, rows: 2 });
  for (const label of ["A", "B", "C", "D", "E"]) addPad(t.store, board.id, { label });
  return board;
}

describe("pad boards", () => {
  it("creates a board with a grid of 4 x 3 by default, and checks sizes from 1 to 8", async () => {
    const board = createBoard(t.store, { title: "Weather" });
    expect(board).toMatchObject({ title: "Weather", cols: 4, rows: 3, background: "" });
    expect(getBoardLayout(t.store, board.id)).toMatchObject({ slots: Array(12).fill(null), spare: [] });
    expect(() => createBoard(t.store, { title: "Big", cols: 9, rows: 2 })).toThrow(ValidationError);
    expect(() => createBoard(t.store, { title: "None", cols: 2, rows: 0 })).toThrow(ValidationError);
    updateBoard(t.store, board.id, { title: "Weather and places" });
    expect(getBoard(t.store, board.id)!.title).toBe("Weather and places");
    expect(listBoards(t.store).map((b) => b.title)).toEqual(["Weather and places"]);
  });

  it("adds pads to the first empty cell, then to Spare pads when the grid is full", async () => {
    const board = createBoard(t.store, { title: "Tiny", cols: 2, rows: 1 });
    const a = addPad(t.store, board.id, { label: "A" });
    addPad(t.store, board.id, { label: "B" });
    const c = addPad(t.store, board.id, { label: "C" });
    expect(a.cell).toEqual({ row: 0, col: 0 });
    expect(c.cell).toBeNull();
    expect(labels(board.id)).toEqual({ slots: ["A", "B"], spare: ["C"] });
    const d = addPad(t.store, board.id, { label: "D", at: "spare" });
    expect(d.cell).toBeNull();
    expect(() => addPad(t.store, board.id, { label: "E", at: { row: 0, col: 0 } })).toThrow(/already/);
    expect(() => addPad(t.store, board.id, { label: "E", at: { row: 1, col: 0 } })).toThrow(/outside/);
  });

  it("gives a new pad the prototype's defaults and keeps every setting", async () => {
    const board = createBoard(t.store, { title: "Fx" });
    const pad = addPad(t.store, board.id, {});
    expect(pad).toMatchObject({
      label: "New pad",
      icon: "star",
      color: "gold",
      hotkey: null,
      mode: "oneshot",
      sound: { kind: "single", trackIds: [], order: "random", tagId: null },
      volume: 0.8,
      fadeMs: 1500,
      fadeInMs: 0,
    });
    const [s1, s2] = createTracks(t.store, [
      { kind: "fx", title: "Sword 1", file: { path: "/fx/sword_1.wav" } },
      { kind: "fx", title: "Sword 2", file: { path: "/fx/sword_2.wav" } },
    ]);
    const changed = updatePad(t.store, pad.id, {
      label: "Sword clash",
      icon: "swords",
      color: "steel",
      hotkey: "Q",
      mode: "retrigger",
      sound: { kind: "variants", trackIds: [s2.id, s1.id], order: "in_turn" },
      volume: 0.5,
      fadeMs: 0,
    });
    expect(changed).toMatchObject({
      label: "Sword clash",
      icon: "swords",
      color: "steel",
      hotkey: "q",
      mode: "retrigger",
      sound: { kind: "variants", trackIds: [s2.id, s1.id], order: "in_turn", tagId: null },
      volume: 0.5,
      fadeMs: 0,
    });
    // A function key works too (F1 to F12), as in the prototype; it is stored in lower case like any key.
    expect(updatePad(t.store, pad.id, { hotkey: "F5" }).hotkey).toBe("f5");
    expect(updatePad(t.store, pad.id, { hotkey: "Q" }).hotkey).toBe("q");
    // Switching to one file keeps the list, so switching back loses nothing.
    expect(updatePad(t.store, pad.id, { sound: { kind: "single" } }).sound).toMatchObject({ kind: "single", trackIds: [s2.id, s1.id] });
    for (const bad of [
      { color: "pink" },
      { mode: "loop" },
      { volume: 2 },
      { hotkey: "too long for a key" },
      { hotkey: "ab" },
      { hotkey: "F13" },
      { sound: { kind: "tag", tagId: "missing" } },
      { sound: { trackIds: ["missing"] } },
      { icon: "<script>" },
    ]) {
      expect(() => updatePad(t.store, pad.id, bad as never), JSON.stringify(bad)).toThrow();
    }
  });

  it("plays any effect with a tag; a deleted tag or track leaves the pad in place", async () => {
    const board = createBoard(t.store, { title: "Fx" });
    const group = listTagGroups(t.store)[0];
    const door = createTag(t.store, { groupId: group.id, name: "Door" });
    const [slam] = createTracks(t.store, [{ kind: "fx", title: "Slam", file: { path: "/fx/slam.wav" } }]);
    const tagPad = addPad(t.store, board.id, { label: "Doors", sound: { kind: "tag", tagId: door.id } });
    const filePad = addPad(t.store, board.id, { label: "Slam", sound: { kind: "single", trackIds: [slam.id] } });
    await deleteTag(t.store, door.id);
    await deleteTracks(t.store, [slam.id]);
    expect(getPad(t.store, tagPad.id)!.sound).toMatchObject({ kind: "tag", tagId: null });
    expect(getPad(t.store, filePad.id)!.sound.trackIds).toEqual([]);
  });

  it("packs pads left to right, top to bottom when the grid changes; only pads that do not fit go to Spare pads (SFX-11)", async () => {
    const board = sampleBoard();
    expect(labels(board.id)).toEqual({ slots: ["A", "B", "C", "D", "E", null], spare: [] });
    const result = resizeBoard(t.store, board.id, { cols: 2, rows: 2 });
    expect(result.movedToSpare.map((id) => getPad(t.store, id)!.label)).toEqual(["E"]);
    expect(labels(board.id)).toEqual({ slots: ["A", "B", "C", "D"], spare: ["E"] });
    resizeBoard(t.store, board.id, { cols: 1, rows: 1 });
    expect(labels(board.id)).toEqual({ slots: ["A"], spare: ["B", "C", "D", "E"] });
    // Growing brings the pads a resize moved back, in their order.
    expect(resizeBoard(t.store, board.id, { cols: 3, rows: 2 }).cameBack.map((id) => getPad(t.store, id)!.label)).toEqual(["B", "C", "D", "E"]);
    expect(labels(board.id)).toEqual({ slots: ["A", "B", "C", "D", "E", null], spare: [] });
    expect(() => resizeBoard(t.store, board.id, { cols: 9, rows: 1 })).toThrow(ValidationError);
    expect(listPads(t.store, board.id)).toHaveLength(5);
  });

  it("undoes a resize as one step, bringing the pads back to their cells", async () => {
    const board = sampleBoard();
    resizeBoard(t.store, board.id, { cols: 1, rows: 2 });
    expect(labels(board.id)).toEqual({ slots: ["A", "B"], spare: ["C", "D", "E"] });
    expect(await history.undo()).toBe('Resize "Combat" to 1 × 2');
    expect(labels(board.id)).toEqual({ slots: ["A", "B", "C", "D", "E", null], spare: [] });
    await history.redo();
    expect(labels(board.id)).toEqual({ slots: ["A", "B"], spare: ["C", "D", "E"] });
  });

  it("moves pads between cells and Spare pads, swapping with a pad already there", async () => {
    const board = sampleBoard();
    const pads = Object.fromEntries(listPads(t.store, board.id).map((p) => [p.label, p.id]));
    movePad(t.store, pads.A, { row: 1, col: 2 });
    expect(labels(board.id).slots).toEqual([null, "B", "C", "D", "E", "A"]);
    movePad(t.store, pads.A, { row: 0, col: 1 }); // onto B: swap
    expect(labels(board.id).slots).toEqual([null, "A", "C", "D", "E", "B"]);
    movePad(t.store, pads.C, "spare");
    movePad(t.store, pads.D, "spare");
    expect(labels(board.id)).toEqual({ slots: [null, "A", null, null, "E", "B"], spare: ["C", "D"] });
    // A spare pad dropped onto a pad: that pad takes its place among the spare pads.
    movePad(t.store, pads.C, { row: 1, col: 1 });
    expect(labels(board.id)).toEqual({ slots: [null, "A", null, null, "C", "B"], spare: ["E", "D"] });
    putPadBack(t.store, pads.D);
    expect(labels(board.id)).toEqual({ slots: ["D", "A", null, null, "C", "B"], spare: ["E"] });
    expect(() => movePad(t.store, pads.A, { row: 2, col: 0 })).toThrow(/outside/);
    resizeBoard(t.store, board.id, { cols: 1, rows: 1 });
    expect(() => putPadBack(t.store, pads.E)).toThrow(/No empty slot/);
  });

  it("duplicates a pad without its hotkey, and takes a hotkey from another pad", async () => {
    const board = sampleBoard();
    const [a, b] = listPads(t.store, board.id);
    updatePad(t.store, a.id, { hotkey: "1", color: "ember" });
    const copy = duplicatePad(t.store, a.id);
    expect(copy).toMatchObject({ label: "A (copy)", hotkey: null, color: "ember", cell: { row: 1, col: 2 } });
    // Two pads may share a key for a moment (the screen warns); taking it clears the other.
    updatePad(t.store, b.id, { hotkey: "1" });
    takePadHotkey(t.store, b.id, "1");
    expect(getPad(t.store, a.id)!.hotkey).toBeNull();
    expect(getPad(t.store, b.id)!.hotkey).toBe("1");
  });

  it("deletes pads, and a board with all its pads; the sound files stay in the library", async () => {
    const board = sampleBoard();
    const [track] = createTracks(t.store, [{ kind: "fx", title: "Bell", file: { path: "/fx/bell.wav" } }]);
    const [a, b] = listPads(t.store, board.id);
    updatePad(t.store, a.id, { sound: { kind: "single", trackIds: [track.id] } });
    deletePads(t.store, [b.id]);
    expect(labels(board.id).slots).toEqual(["A", null, "C", "D", "E", null]);
    deleteBoard(t.store, board.id);
    expect(getPad(t.store, a.id)).toBeNull();
    expect(t.store.get("SELECT count(*) AS n FROM tracks")).toEqual({ n: 1 });
  });
});
