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

/*
 * 0.5.1: the Campaigns screen's cards, in a grid (Nik, 11 Nov: "drag and drop to rearrange the order campaigns are
 * displayed in"). Cards are 300 px wide and 120 px high, two to a row, 12 px apart: a card's left half is before it,
 * its right half after it; below the last card is the last place.
 */
describe("dragging a card in a grid", () => {
  const CARDS = ["Crown", "Masks", "Sixth"];
  const at = (i: number) => ({ left: (i % 2) * 312, top: 100 + Math.floor(i / 2) * 132 });
  function Grid({ onMove }: { onMove: (from: number, to: number) => void }) {
    const drag = useDragReorder("campaigns", onMove, { grid: true });
    return (
      <div data-testid="grid">
        {CARDS.map((name, i) => (
          <article key={name} aria-label={name} className={drag.rowClass(i)} {...drag.rowProps(i)}>
            <span title="Drag to reorder" {...drag.handleProps} />
            {name}
          </article>
        ))}
      </div>
    );
  }
  beforeEach(() => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const i = CARDS.indexOf(this.getAttribute("aria-label") ?? "");
      if (i >= 0) {
        const { left, top } = at(i);
        return { top, bottom: top + 120, height: 120, left, right: left + 300, width: 300, x: left, y: top, toJSON: () => ({}) } as DOMRect;
      }
      if (this.getAttribute("data-testid") === "grid") return { top: 100, bottom: 600, height: 500, left: 0, right: 612, width: 612, x: 0, y: 100, toJSON: () => ({}) } as DOMRect;
      return original.call(this);
    };
    const restoreRows = restore;
    restore = () => {
      Element.prototype.getBoundingClientRect = original;
      restoreRows();
    };
  });
  const card = (name: string) => screen.getByRole("article", { name });
  function dragXY(target: Element, type: "dragover" | "drop", clientX: number, clientY: number) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer() });
    return fireEvent(target, event);
  }
  function pick(name: string) {
    fireEvent.pointerDown(card(name).querySelector<HTMLElement>("[title='Drag to reorder']")!);
    fireEvent.dragStart(card(name), { dataTransfer: dataTransfer() });
  }

  it("dropped on the right half of the card beside it, it goes after that card, and the mark is after it", () => {
    const onMove = vi.fn();
    render(<Grid onMove={onMove} />);
    pick("Crown");
    dragXY(card("Masks"), "dragover", 312 + 250, 150);
    expect(card("Masks")).toHaveClass("cp-drop-after");
    dragXY(card("Masks"), "drop", 312 + 250, 150);
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it("dropped on the left half of a card, it goes before it", () => {
    const onMove = vi.fn();
    render(<Grid onMove={onMove} />);
    pick("Sixth");
    dragXY(card("Masks"), "dragover", 312 + 40, 150);
    expect(card("Masks")).toHaveClass("cp-drop-before");
    dragXY(card("Masks"), "drop", 312 + 40, 150);
    expect(onMove).toHaveBeenCalledWith(2, 1);
  });

  it("dropped in the empty place after the last card, it goes last", () => {
    const onMove = vi.fn();
    render(<Grid onMove={onMove} />);
    pick("Crown");
    dragXY(screen.getByTestId("grid"), "dragover", 312 + 150, 250);
    dragXY(screen.getByTestId("grid"), "drop", 312 + 150, 250);
    expect(onMove).toHaveBeenCalledWith(0, 2);
  });
});
