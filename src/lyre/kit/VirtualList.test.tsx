import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VirtualList } from "./VirtualList";
import { expectNoAxeViolations } from "../test/axe";

const ROWS = 20_000;
const label = (i: number) => `Track ${i + 1}`;

describe("VirtualList: a long list drawn a screenful at a time (PERF-3)", () => {
  it("draws 20,000 rows quickly, keeping only the visible ones (plus a few) on the page", () => {
    const started = performance.now();
    render(<VirtualList label="Tracks" itemCount={ROWS} rowHeight={30} height={600} renderRow={(i) => <span>{label(i)}</span>} />);
    expect(performance.now() - started).toBeLessThan(500);
    const list = screen.getByRole("list", { name: "Tracks" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.length).toBeLessThan(60);
    // Screen readers still hear how long the list is and where each row sits.
    expect(rows[0]).toHaveAttribute("aria-setsize", String(ROWS));
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(list.firstElementChild).toHaveStyle({ height: `${ROWS * 30}px` });
  });

  it("draws the rows scrolled to, and stays fast doing it", () => {
    render(<VirtualList label="Tracks" itemCount={ROWS} rowHeight={30} height={600} renderRow={(i) => <span>{label(i)}</span>} />);
    const list = screen.getByRole("list", { name: "Tracks" });
    const started = performance.now();
    for (let top = 0; top < ROWS * 30; top += 30 * 997) {
      list.scrollTop = top;
      fireEvent.scroll(list);
    }
    list.scrollTop = 15_000 * 30;
    fireEvent.scroll(list);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(screen.getByText("Track 15001")).toBeInTheDocument();
    expect(screen.queryByText("Track 1")).toBeNull();
  });

  function Picker({ onActivate = vi.fn() }: { onActivate?: (i: number) => void }) {
    const [active, setActive] = useState(0);
    return (
      <VirtualList
        label="Library"
        role="listbox"
        itemCount={ROWS}
        rowHeight={30}
        height={300}
        activeIndex={active}
        onActiveChange={setActive}
        onActivate={onActivate}
        isSelected={(i) => i === active}
        renderRow={(i) => <span>{label(i)}</span>}
      />
    );
  }

  it("moves through 20,000 rows with the keyboard, telling screen readers which row is current", async () => {
    const onActivate = vi.fn();
    render(<Picker onActivate={onActivate} />);
    const user = userEvent.setup();
    const box = screen.getByRole("listbox", { name: "Library" });
    await user.tab();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Track 1" }).id);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: "Track 3" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    const last = screen.getByRole("option", { name: "Track 20000" });
    expect(box).toHaveAttribute("aria-activedescendant", last.id);
    expect(box.scrollTop).toBe(ROWS * 30 - 300);
    await user.keyboard("{PageUp}");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Track 19990" }).id);
    await user.keyboard("{Home}");
    expect(box.scrollTop).toBe(0);
    await user.keyboard("{PageDown}{Enter}");
    expect(onActivate).toHaveBeenCalledWith(10);
    await expectNoAxeViolations();
  });
});
