/**
 * Review M7 (R60-CODE-REVIEW, f-live's half): a drag in Arrange (a box's bottom edge, the bar between columns) stops
 * when the pointer is cancelled (Alt+Tab, a touch taken over) and when the box goes away mid-drag (Done, Esc, another
 * screen): nothing follows the mouse afterwards and nothing is saved from a box that has gone.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArrangeBox, ColumnSplit } from "./Arrange";
import { USUAL_LAYOUT, type LiveLayout } from "./liveLayout";

const layout: LiveLayout = { cols: USUAL_LAYOUT[2].map((c) => [...c]), widths: null, heights: {} };

function box(change = vi.fn()) {
  const view = render(
    <ArrangeBox id="scenes" col={0} at={0} props={{ layout, columns: 2, change }}>
      <p>Scenes</p>
    </ArrangeBox>,
  );
  const edge = view.container.querySelector(".lv-edge-b") as HTMLElement;
  return { view, edge, change };
}

const on = (type: string) => act(() => void document.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 300, clientY: 400 })));

describe("Arrange: a drag that is cut short (review M7)", () => {
  it("a box's edge stops following the pointer when the pointer is cancelled, and saves nothing", () => {
    const { edge, change } = box();
    fireEvent.pointerDown(edge, { clientY: 100 });
    on("pointercancel");
    on("pointermove");
    on("pointerup");
    expect(change).not.toHaveBeenCalled();
    expect(edge.parentElement?.classList.contains("lv-sizing")).toBe(false);
  });

  it("a box that goes away mid-drag leaves no listener behind and saves nothing", () => {
    const { view, edge, change } = box();
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    fireEvent.pointerDown(edge, { clientY: 100 });
    view.unmount();
    on("pointermove");
    on("pointerup");
    expect(change).not.toHaveBeenCalled();
    const kinds = (spy: typeof added) => spy.mock.calls.map(([type]) => type).filter((t) => String(t).startsWith("pointer"));
    expect(kinds(removed).sort()).toEqual(kinds(added).sort());
    added.mockRestore();
    removed.mockRestore();
  });

  it("the bar between columns stops on a cancelled pointer too", () => {
    const change = vi.fn();
    const view = render(<ColumnSplit index={0} widths={[38, 62]} change={change} />);
    const bar = view.container.firstElementChild as HTMLElement;
    const removed = vi.spyOn(document, "removeEventListener");
    fireEvent.pointerDown(bar, { clientX: 100 });
    on("pointercancel");
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]));
    removed.mockRestore();
  });
});
