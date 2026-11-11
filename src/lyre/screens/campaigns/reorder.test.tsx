/**
 * Dragging a row by its handle (useDragReorder): the session planner's scenes and a campaign's sessions. Nik, 0.5.0:
 * "Dragging and dropping a scene (a session) into last position doesn't work." Rows are laid out by hand here (jsdom
 * has no layout): four rows 34 px high with 6 px between them, in a box that goes on below the last one.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDragReorder } from "./reorder";

const NAMES = ["Arrival", "Market", "Ambush", "Aftermath"];
const ROW_TOP = 100;
const ROW_HEIGHT = 34;
const ROW_STEP = 40;
/** The box the list is in: from just above the first row to well below the last (the rest of the pane). */
const BOX = { top: 90, bottom: 500 };

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, height: bottom - top, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function List({ onMove }: { onMove: (from: number, to: number) => void }) {
  const drag = useDragReorder("scenes", onMove);
  return (
    <div className="pane-body" data-testid="box">
      <ol>
        {NAMES.map((name, i) => (
          <li key={name} aria-label={name} className={drag.rowClass(i)} {...drag.rowProps(i)}>
            <span title="Drag to reorder" {...drag.handleProps} />
            {name}
          </li>
        ))}
      </ol>
    </div>
  );
}

let restore: () => void;
beforeEach(() => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const name = this.getAttribute("aria-label");
    const i = name ? NAMES.indexOf(name) : -1;
    if (i >= 0) return rect(ROW_TOP + i * ROW_STEP, ROW_TOP + i * ROW_STEP + ROW_HEIGHT);
    if (this.getAttribute("data-testid") === "box") return rect(BOX.top, BOX.bottom);
    return original.call(this);
  };
  restore = () => (Element.prototype.getBoundingClientRect = original);
});
afterEach(() => restore());

const row = (name: string) => screen.getByRole("listitem", { name });
const dataTransfer = () => ({ effectAllowed: "", dropEffect: "", types: ["text/plain"], files: [] as File[], setData: (): void => undefined });

/** A drag event at a height on the page (jsdom has no DragEvent, so a mouse event with a dataTransfer). */
function dragAt(target: Element, type: "dragover" | "drop", clientY: number, data: object = dataTransfer()): boolean {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, "dataTransfer", { value: data });
  return fireEvent(target, event);
}

/** Press the handle of `name` and start dragging its row. */
function pickUp(name: string) {
  const handle = row(name).querySelector<HTMLElement>("[title='Drag to reorder']")!;
  fireEvent.pointerDown(handle);
  fireEvent.dragStart(row(name), { dataTransfer: dataTransfer() });
}

function show() {
  const onMove = vi.fn();
  render(<List onMove={onMove} />);
  return onMove;
}

describe("dragging a row into the last place", () => {
  it("dropped on the lower half of the last row, it goes last", () => {
    const onMove = show();
    pickUp("Arrival");
    dragAt(row("Aftermath"), "dragover", ROW_TOP + 3 * ROW_STEP + 30);
    dragAt(row("Aftermath"), "drop", ROW_TOP + 3 * ROW_STEP + 30);
    expect(onMove).toHaveBeenCalledWith(0, 3);
  });

  it("dropped below the last row, in the rest of its box, it goes last, and the line shows there first (Nik, 0.5.0)", () => {
    const onMove = show();
    pickUp("Arrival");
    const below = ROW_TOP + 3 * ROW_STEP + ROW_HEIGHT + 40;
    dragAt(screen.getByTestId("box"), "dragover", below);
    expect(row("Aftermath")).toHaveClass("cp-drop-after");
    dragAt(screen.getByTestId("box"), "drop", below);
    expect(onMove).toHaveBeenCalledWith(0, 3);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(row("Aftermath")).not.toHaveClass("cp-drop-after");
  });

  it("dropped in the gap between two rows, it goes between them", () => {
    const onMove = show();
    pickUp("Arrival");
    const gap = ROW_TOP + 2 * ROW_STEP - 3;
    dragAt(screen.getByTestId("box"), "dragover", gap);
    expect(row("Ambush")).toHaveClass("cp-drop-before");
    dragAt(screen.getByTestId("box"), "drop", gap);
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it("the last row dropped below itself stays where it is", () => {
    const onMove = show();
    pickUp("Aftermath");
    const below = ROW_TOP + 3 * ROW_STEP + ROW_HEIGHT + 40;
    dragAt(screen.getByTestId("box"), "dragover", below);
    expect(row("Aftermath")).not.toHaveClass("cp-drop-after");
    dragAt(screen.getByTestId("box"), "drop", below);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("files dropped on the box are left alone when no row is being dragged", () => {
    const onMove = show();
    const files = { types: ["Files"], files: [] as File[], dropEffect: "" };
    expect(dragAt(screen.getByTestId("box"), "dragover", 450, files)).toBe(true);
    dragAt(screen.getByTestId("box"), "drop", 450, files);
    expect(onMove).not.toHaveBeenCalled();
  });
});
