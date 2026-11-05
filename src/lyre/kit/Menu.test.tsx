import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuButton } from "./Menu";
import { expectNoAxeViolations } from "../test/axe";

function setup() {
  const rename = vi.fn();
  const remove = vi.fn();
  const pick = vi.fn();
  render(
    <MenuButton
      icon="more"
      label="More for The Company themes"
      items={[
        { label: "Rename", icon: "edit", onSelect: rename },
        { label: "Use in…", onSelect: () => undefined },
        { separator: true },
        { group: "Play to" },
        { label: "Table", checked: true, onSelect: pick },
        { label: "Side room", checked: false, onSelect: pick },
        { label: "Delete…", danger: true, onSelect: remove },
        { label: "Not now", disabled: true, onSelect: remove },
      ]}
    />,
  );
  return { rename, remove, pick, button: screen.getByRole("button", { name: "More for The Company themes" }) };
}

describe("MenuButton: an anchored menu (A11Y-2)", () => {
  it("opens a menu named after its button, with the first item focused", async () => {
    const { button } = setup();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(button);
    const menu = screen.getByRole("menu", { name: "More for The Company themes" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    expect(menu).toHaveClass("menu");
    await expectNoAxeViolations();
  });

  it("moves with the arrow keys, Home and End, skipping what cannot be chosen", async () => {
    const { button } = setup();
    const user = userEvent.setup();
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Use in…" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  });

  it("shows which of a set is chosen", async () => {
    const { button, pick } = setup();
    await userEvent.setup().click(button);
    expect(screen.getByRole("menuitemradio", { name: "Table" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Side room" })).toHaveAttribute("aria-checked", "false");
    await userEvent.setup().click(screen.getByRole("menuitemradio", { name: "Side room" }));
    expect(pick).toHaveBeenCalled();
  });

  it("closes on Escape and gives focus back to its button", async () => {
    const { button } = setup();
    const user = userEvent.setup();
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("does the chosen thing, closes and gives focus back", async () => {
    const { button, rename } = setup();
    const user = userEvent.setup();
    await user.click(button);
    await user.keyboard("{Enter}");
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes when you click elsewhere or Tab away", async () => {
    const { button } = setup();
    const user = userEvent.setup();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    await user.tab();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
