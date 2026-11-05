/** The picker sheet's folding groups (the prototype's pickerSheet with `fold`, as "Use in…" uses it). */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { PickerDialog, type PickerItem } from "./Picker";

const items: PickerItem[] = [
  { id: "c:crown", label: "The Sunken Crown: whole campaign", group: "The Sunken Crown" },
  { id: "s:crown:s14", label: "Session 14: The Drowned Abbey", group: "The Sunken Crown" },
  { id: "c:ash", label: "Ashes of Elysium: whole campaign", group: "Ashes of Elysium" },
  { id: "s:ash:s3", label: "Session 3: Night court", group: "Ashes of Elysium" },
  { id: "c:moor", label: "The Moor: whole campaign", group: "The Moor" },
];

function open(props: Partial<React.ComponentProps<typeof PickerDialog>> = {}) {
  render(<PickerDialog open title="Use it in…" items={items} multi fold onDone={vi.fn()} onClose={vi.fn()} {...props} />);
  return within(screen.getByRole("dialog", { name: "Use it in…" }));
}

describe("PickerDialog with folding groups", () => {
  it("opens the groups asked for and those with something ticked; the others are folded, with their ticks counted", async () => {
    const sheet = open({ openGroups: ["The Sunken Crown"], selected: ["s:ash:s3"] });
    expect(sheet.getByRole("button", { name: /^The Sunken Crown/ })).toHaveAttribute("aria-expanded", "true");
    expect(sheet.getByRole("button", { name: /^Ashes of Elysium/ })).toHaveAttribute("aria-expanded", "true");
    const moor = sheet.getByRole("button", { name: /^The Moor/ });
    expect(moor).toHaveAttribute("aria-expanded", "false");
    expect(moor).toHaveTextContent("0 ticked");
    expect(sheet.getByRole("button", { name: /^Ashes of Elysium/ })).toHaveTextContent("1 ticked");
    expect(sheet.getByRole("checkbox", { name: /Session 14/ })).toBeInTheDocument();
    expect(sheet.queryByRole("checkbox", { name: /The Moor/ })).toBeNull();
    await expectNoAxeViolations();
  });

  it("unfolds and folds a group from its heading, keeping focus there, and counts ticks as they change", async () => {
    const sheet = open();
    const moor = sheet.getByRole("button", { name: /^The Moor/ });
    await userEvent.click(moor);
    expect(moor).toHaveAttribute("aria-expanded", "true");
    expect(moor).toHaveFocus();
    await userEvent.click(sheet.getByRole("checkbox", { name: /The Moor: whole campaign/ }));
    expect(moor).toHaveTextContent("1 ticked");
    await userEvent.click(moor);
    expect(sheet.queryByRole("checkbox", { name: /The Moor/ })).toBeNull();
  });

  it("shows every match while searching, folded or not", async () => {
    const sheet = open();
    expect(sheet.queryByRole("checkbox", { name: /Night court/ })).toBeNull();
    await userEvent.type(sheet.getByRole("searchbox", { name: "Search the list" }), "night");
    expect(sheet.getByRole("checkbox", { name: /Night court/ })).toBeInTheDocument();
  });

  it("without fold, shows plain group headings and every item", () => {
    const sheet = open({ fold: false });
    expect(sheet.queryByRole("button", { name: /^The Moor/ })).toBeNull();
    expect(sheet.getByText("The Moor", { selector: ".pk-group" })).toBeInTheDocument();
    expect(sheet.getAllByRole("checkbox")).toHaveLength(5);
  });

  it("keeps two groups of the same name apart: each folds and counts on its own (review w3-polish 9)", async () => {
    const twins: PickerItem[] = [
      { id: "c:a", label: "Moor A: whole campaign", group: "The Moor", groupId: "a" },
      { id: "c:b", label: "Moor B: whole campaign", group: "The Moor", groupId: "b" },
    ];
    render(<PickerDialog open title="Twins" items={twins} multi fold openGroups={["a"]} selected={[]} onDone={vi.fn()} onClose={vi.fn()} />);
    const sheet = within(screen.getByRole("dialog", { name: "Twins" }));
    const [a, b] = sheet.getAllByRole("button", { name: /^The Moor/ });
    expect(a).toHaveAttribute("aria-expanded", "true");
    expect(b).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(sheet.getByRole("checkbox", { name: /Moor A/ }));
    expect(a).toHaveTextContent("1 ticked");
    expect(b).toHaveTextContent("0 ticked");
  });

  it("while searching, a heading cannot fold its group, as every match shows (review w3-polish 9)", async () => {
    const sheet = open();
    await userEvent.type(sheet.getByRole("searchbox", { name: "Search the list" }), "session");
    expect(sheet.getByRole("button", { name: /^The Sunken Crown/ })).toBeDisabled();
  });
});

