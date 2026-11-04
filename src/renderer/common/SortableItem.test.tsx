import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { DragHandle, SortableItem } from "./SortableItem";

function List({ onDragStart, onClick }: { onDragStart: () => void; onClick: () => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart}>
      <SortableContext items={["a"]}>
        <SortableItem id="a">
          <DragHandle label="Move Tabletop Audio">
            <span>icon</span>
          </DragHandle>
          <button onClick={onClick}>Close tab Tabletop Audio</button>
        </SortableItem>
      </SortableContext>
    </DndContext>
  );
}

// dnd-kit 3 measures the window itself when a drag starts, which jsdom cannot do.
Object.assign(window, { getBoundingClientRect: () => document.documentElement.getBoundingClientRect() });

describe("SortableItem (UX finding 2)", () => {
  it("lets Enter and Space press a button inside the row instead of picking the row up", async () => {
    const onDragStart = vi.fn();
    const onClick = vi.fn();
    render(<List onDragStart={onDragStart} onClick={onClick} />);
    const user = userEvent.setup();
    screen.getByRole("button", { name: "Close tab Tabletop Audio" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("picks the row up with Space only from its drag handle", async () => {
    const onDragStart = vi.fn();
    render(<List onDragStart={onDragStart} onClick={() => undefined} />);
    screen.getByRole("button", { name: "Move Tabletop Audio" }).focus();
    await userEvent.setup().keyboard(" ");
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("does not make the whole row one big button around the others", () => {
    render(<List onDragStart={() => undefined} onClick={() => undefined} />);
    const close = screen.getByRole("button", { name: "Close tab Tabletop Audio" });
    expect(close.parentElement).not.toHaveAttribute("role");
    expect(close.parentElement).not.toHaveAttribute("tabindex");
  });
});
