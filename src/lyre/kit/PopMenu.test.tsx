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
    <>
      <PopMenuButton label="Add tracks" className="btn" items={items} top={top}>
        Add tracks
      </PopMenuButton>
      <button type="button">Next control</button>
    </>
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

  it("is the menu its button controls (review w3-polish 8)", async () => {
    render(<Example />);
    const button = screen.getByRole("button", { name: "Add tracks" });
    await userEvent.click(button);
    expect(screen.getByRole("menu", { name: "Add tracks" })).toHaveAttribute("id", button.getAttribute("aria-controls"));
  });

  it("Tab closes it and goes on from its button, not from the end of the page (review w3-polish 8)", async () => {
    render(<Example />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add tracks" }));
    await user.tab();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
  });
});

describe("PopMenu: ticks and choices that keep the menu open (PLY-13's play order menu)", () => {
  function Choices({ onShuffle = vi.fn(), onRepeat = vi.fn() }: { onShuffle?: () => void; onRepeat?: () => void }) {
    const items = (): PopMenuEntry[] => [
      { key: "shuffle", role: "menuitemcheckbox", checked: true, keepOpen: true, content: "Shuffle", onSelect: onShuffle },
      { key: "one", role: "menuitemradio", checked: false, keepOpen: true, content: "Repeat one", onSelect: onRepeat },
      { note: "Only in the scene The abbey ruins." },
      { content: "Use the playlist's own order here", onSelect: vi.fn() },
    ];
    return (
      <PopMenuButton label="Play order" className="btn" items={items}>
        Play order
      </PopMenuButton>
    );
  }

  it("draws a tick box and a choice with their state, and the arrows reach them", async () => {
    render(<Choices />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Play order" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Repeat one" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemradio", { name: "Repeat one" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Use the playlist's own order here" })).toHaveFocus();
  });

  it("stays open with focus on the item after one of them is chosen", async () => {
    const onRepeat = vi.fn();
    render(<Choices onRepeat={onRepeat} />);
    await userEvent.click(screen.getByRole("button", { name: "Play order" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Repeat one" }));
    expect(onRepeat).toHaveBeenCalledOnce();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Repeat one" })).toHaveFocus();
  });

  it("a note is part of the menu's description, not an item", async () => {
    render(<Choices />);
    await userEvent.click(screen.getByRole("button", { name: "Play order" }));
    expect(screen.getByRole("menu")).toHaveAccessibleDescription("Only in the scene The abbey ruins.");
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    await expectNoAxeViolations();
  });
});
