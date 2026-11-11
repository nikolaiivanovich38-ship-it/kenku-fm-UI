import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./Dialog";
import { PickerDialog, type PickerItem } from "./Picker";
import { Button } from "./Button";
import { expectNoAxeViolations } from "../test/axe";

function WithDialog({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New campaign</Button>
      <Dialog
        open={open}
        title="New campaign"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary">Create</Button>
          </>
        }
      >
        <label>
          Name <input />
        </label>
      </Dialog>
    </>
  );
}

describe("Dialog: a modal sheet for prep screens", () => {
  it("is a modal dialog named by its title, with focus in its first field", async () => {
    render(<WithDialog />);
    await userEvent.setup().click(screen.getByRole("button", { name: "New campaign" }));
    const dialog = screen.getByRole("dialog", { name: "New campaign" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveFocus();
    await expectNoAxeViolations();
  });

  it("keeps Tab inside until it closes", async () => {
    render(<WithDialog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New campaign" }));
    const dialog = screen.getByRole("dialog");
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Create" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Create" })).toHaveFocus();
  });

  it("UX-R1: focus skips a control that is off, so a list whose first Move up is greyed still gets focus", async () => {
    const user = userEvent.setup();
    function WithSteps() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Steps</Button>
          <Dialog open={open} title="When The abbey ruins starts" onClose={() => setOpen(false)}>
            <button type="button" disabled>
              Move up
            </button>
            <button type="button">Move down</button>
          </Dialog>
        </>
      );
    }
    render(<WithSteps />);
    await user.click(screen.getByRole("button", { name: "Steps" }));
    const dialog = screen.getByRole("dialog", { name: "When The abbey ruins starts" });
    expect(within(dialog).getByRole("button", { name: "Move down" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus in and back without scrolling: the screen behind stays where it was (UX-18)", async () => {
    const user = userEvent.setup();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      render(<WithDialog onClose={() => undefined} />);
      await user.click(screen.getByRole("button", { name: "New campaign" }));
      await user.keyboard("{Escape}");
      const own = focus.mock.calls.filter((call) => call.length > 0);
      expect(own.length).toBeGreaterThanOrEqual(2);
      for (const [options] of own) expect(options).toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });

  it("UX-R1: with nothing to press in its body, focus goes to its first button (Close)", async () => {
    render(
      <Dialog open title="Nothing here" onClose={() => undefined}>
        <p>Just words</p>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes with Escape or Close and gives focus back to what opened it", async () => {
    const onClose = vi.fn();
    render(<WithDialog onClose={onClose} />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "New campaign" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});

const ITEMS: PickerItem[] = [
  { id: "p-company", label: "The Company themes", sub: "Manual · Music · 6 tracks", group: "Playlists", tags: ["music"] },
  { id: "p-abbey", label: "Abbey, eerie", sub: "Dynamic · Music", group: "Playlists", tags: ["music"] },
  { id: "t1", label: "Crypt drips", sub: "Ambience · 3:00", group: "Tracks", tags: ["amb"] },
];

function Picker({ onDone = vi.fn(), multi = true }: { onDone?: (ids: string[]) => void; multi?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <PickerDialog
      open={open}
      title="Add music to the scene"
      intro="Tick playlists, single tracks or both."
      items={ITEMS}
      multi={multi}
      selected={["t1"]}
      filters={[
        { id: "all", label: "All", test: () => true },
        { id: "pl", label: "Playlists", test: (item) => item.group === "Playlists" },
      ]}
      renderContents={(item) => (item.group === "Playlists" ? <p>Inside {item.label}</p> : null)}
      onDone={(ids) => {
        onDone(ids);
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
    />
  );
}

describe("PickerDialog: choose from a long list, look inside before you add", () => {
  it("lists items by group with a search, filters and a count", async () => {
    render(<Picker />);
    const dialog = screen.getByRole("dialog", { name: "Add music to the scene" });
    expect(within(dialog).getByRole("searchbox", { name: "Search the list" })).toHaveFocus();
    expect(within(dialog).getByRole("group", { name: "Show" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Crypt drips/ })).toBeChecked();
    expect(within(dialog).getByText("1 chosen")).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it("narrows the list by search and by filter, and says when nothing matches", async () => {
    render(<Picker />);
    const user = userEvent.setup();
    await user.keyboard("abbey");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Search the list" }));
    await user.click(screen.getByRole("button", { name: "Playlists" }));
    expect(screen.getByRole("button", { name: "Playlists" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    await user.type(screen.getByRole("searchbox", { name: "Search the list" }), "zzz");
    expect(screen.getByText('Nothing matches "zzz".')).toBeInTheDocument();
  });

  it("shows what is inside an item with an expander that is closed by default", async () => {
    render(<Picker />);
    const user = userEvent.setup();
    const show = screen.getByRole("button", { name: "Show contents of The Company themes" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Inside The Company themes")).toBeNull();
    await user.click(show);
    expect(screen.getByText("Inside The Company themes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide contents of The Company themes" })).toHaveFocus();
  });

  it("gives back the ticked items in the order ticked, on Done", async () => {
    const onDone = vi.fn();
    render(<Picker onDone={onDone} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Abbey, eerie/ }));
    await user.click(screen.getByRole("checkbox", { name: /The Company themes/ }));
    expect(screen.getByText("3 chosen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(["t1", "p-abbey", "p-company"]);
  });

  it("picks one with radio buttons when only one may be chosen; Cancel keeps nothing", async () => {
    const onDone = vi.fn();
    render(<Picker onDone={onDone} multi={false} />);
    const user = userEvent.setup();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /Abbey, eerie/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
