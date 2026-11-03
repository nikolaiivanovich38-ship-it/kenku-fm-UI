import { describe, expect, it } from "vitest";

import {
  DragEventKind,
  DragState,
  dragHasFiles,
  dragReducer,
  leftTarget,
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

  it("is true when leaving the window", () => {
    expect(leftTarget(outer, null)).toBe(true);
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
