import { describe, expect, it } from "vitest";

import {
  DragEventKind,
  DragState,
  dragHasFiles,
  dragReducer,
  leftTarget,
  pointerOutsideWindow,
} from "./dragState";

const idle: DragState = { dragging: false };
const active: DragState = { dragging: true };

describe("dragReducer (BUG-1)", () => {
  it.each<[string, DragState, DragEventKind, boolean]>([
    ["file drag enters", idle, { type: "enter", hasFiles: true }, true],
    ["text drag enters", idle, { type: "enter", hasFiles: false }, false],
    ["text drag enters during a file drag", active, { type: "enter", hasFiles: false }, true],
    ["moves onto a child", active, { type: "leave", outside: false }, true],
    ["leaves the target", active, { type: "leave", outside: true }, false],
    ["drops", active, { type: "drop" }, false],
    ["is cancelled", active, { type: "cancel" }, false],
    ["is cancelled when idle", idle, { type: "cancel" }, false],
  ])("%s", (_, state, event, expected) => {
    expect(dragReducer(state, event).dragging).toBe(expected);
  });
});

describe("dragHasFiles", () => {
  it.each<[string, { types: string[] } | null, boolean]>([
    ["files", { types: ["Files"] }, true],
    ["files and text", { types: ["text/uri-list", "Files"] }, true],
    ["text only", { types: ["text/plain"] }, false],
    ["no types", { types: [] }, false],
    ["no data transfer", null, false],
  ])("%s", (_, dataTransfer, expected) => {
    expect(dragHasFiles(dataTransfer)).toBe(expected);
  });
});

describe("leftTarget", () => {
  const outer = document.createElement("div");
  const inner = document.createElement("span");
  const sibling = document.createElement("div");
  outer.appendChild(inner);

  it("is true when relatedTarget is unknown and no position is given", () => {
    expect(leftTarget(outer, null)).toBe(true);
  });

  describe("with relatedTarget null (Chromium may omit it inside the page)", () => {
    const rect = { left: 10, top: 10, right: 110, bottom: 60 };
    const withRect = document.createElement("div");
    withRect.getBoundingClientRect = () => rect as DOMRect;

    it("is false while the pointer is still inside the target", () => {
      expect(leftTarget(withRect, null, { clientX: 50, clientY: 30 })).toBe(false);
    });

    it("is true once the pointer is outside the target", () => {
      expect(leftTarget(withRect, null, { clientX: 200, clientY: 30 })).toBe(true);
    });
  });

  it("is false when moving onto a child", () => {
    expect(leftTarget(outer, inner)).toBe(false);
  });

  it("is false when moving onto the target itself", () => {
    expect(leftTarget(outer, outer)).toBe(false);
  });

  it("is true when moving onto another element", () => {
    expect(leftTarget(outer, sibling)).toBe(true);
  });
});

describe("pointerOutsideWindow (BUG-1)", () => {
  const viewport = { innerWidth: 800, innerHeight: 600 };
  it.each<[string, number, number, boolean]>([
    ["inside", 400, 300, false],
    ["left edge", 0, 300, true],
    ["top edge", 400, 0, true],
    ["right edge", 800, 300, true],
    ["bottom edge", 400, 600, true],
    ["beyond left", -5, 300, true],
  ])("%s", (_, clientX, clientY, expected) => {
    expect(pointerOutsideWindow({ clientX, clientY }, viewport)).toBe(expected);
  });
});
