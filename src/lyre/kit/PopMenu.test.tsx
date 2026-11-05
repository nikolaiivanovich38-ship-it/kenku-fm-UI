/** The menu whose items hold two lines (Add tracks, New playlist, Add to playlist; ui.css .menu). */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { PopMenuButton, TwoLines, type PopMenuEntry } from "./PopMenu";

function Example({ onFiles = vi.fn(), top }: { onFiles?: () => void; top?: React.ReactNode }) {
  const items = (): PopMenuEntry[] => [
    { group: "Add" },
    { content: <TwoLines icon="file" first="Add files…" second="Choose audio files" bold />, onSelect: onFiles },
    { content: <TwoLines icon="folder" first="Add a folder…" second="Every audio file in it" />, onSelect: vi.fn() },
    { separator: true },
    { content: "Not now", onSelect: vi.fn(), disabled: true },
    { content: "Hidden", onSelect: vi.fn(), hidden: true },
  ];
  return (
    <PopMenuButton label="Add tracks" className="btn" items={items} top={top}>
      Add tracks
    </PopMenuButton>
  );
}

describe("PopMenu: a menu with two-line items", () => {
  it("opens from its button with the first item focused; items show a bold first line and a hint under it", async () => {
    render(<Example />);
    const button = screen.getByRole("button", { name: "Add tracks" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Add tracks" });
    const first = screen.getByRole("menuitem", { name: /Add files…/ });
    expect(first).toHaveFocus();
    expect(first.querySelector("b")).toHaveTextContent("Add files…");
    expect(first.querySelector(".hint")).toHaveTextContent("Choose audio files");
    expect(screen.queryByRole("menuitem", { name: "Hidden" })).toBeNull();
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();
    await expectNoAxeViolations();
  });

  it("moves with the arrows, Home and End over enabled items, and Escape gives focus back to the button", async () => {
    render(<Example />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add tracks" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Add a folder…/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Add files…/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: /Add a folder…/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: /Add files…/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Add tracks" })).toHaveFocus();
  });

  it("does what an item says and closes", async () => {
    const onFiles = vi.fn();
    render(<Example onFiles={onFiles} />);
    await userEvent.click(screen.getByRole("button", { name: "Add tracks" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Add files…/ }));
    expect(onFiles).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("gives focus first to a box above the items, such as a filter", async () => {
    render(<Example top={<input aria-label="Filter" />} />);
    await userEvent.click(screen.getByRole("button", { name: "Add tracks" }));
    expect(screen.getByRole("textbox", { name: "Filter" })).toHaveFocus();
  });
});
