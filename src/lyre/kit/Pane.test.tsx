import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Column, Pane } from "./Pane";
import { Button } from "./Button";
import { ShellSettingsProvider } from "../shell/ShellSettings";
import { expectNoAxeViolations } from "../test/axe";
import { loadShellSettings } from "../shell/settings";

beforeEach(() => localStorage.clear());

function inShell(node: React.ReactNode) {
  return render(<ShellSettingsProvider>{node}</ShellSettingsProvider>);
}

describe("Pane: every box shows what it is for and what it is doing (UX-3)", () => {
  it("is a region named by its title, with its title as a level 2 heading", async () => {
    inShell(
      <Pane id="scenes" title="Scenes" icon="list" kind="scenes" summary="5 scenes" status={{ text: "Standby", tone: "on" }}>
        <p>Scene list</p>
      </Pane>,
    );
    const region = screen.getByRole("region", { name: "Scenes" });
    expect(region).toHaveClass("pane", "k-scenes");
    expect(within(region).getByRole("heading", { level: 2, name: "Scenes" })).toBeInTheDocument();
    expect(within(region).getByText("5 scenes")).toHaveClass("pane-summary");
    expect(within(region).getByText("Standby")).toHaveClass("pane-status", "s-on");
    await expectNoAxeViolations();
  });

  it("collapses to its header and opens again; the toggle says which", async () => {
    inShell(
      <Pane id="scenes" title="Scenes" actions={<Button>Add scene</Button>}>
        <p>Scene list</p>
      </Pane>,
    );
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Scenes" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("title", "Collapse Scenes");
    expect(screen.getByText("Scene list")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add scene" })).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("title", "Expand Scenes");
    expect(screen.getByRole("region", { name: "Scenes" })).toHaveClass("collapsed");
    // A closed box keeps only its header: its own actions go too.
    expect(screen.queryByRole("button", { name: "Add scene" })).toBeNull();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("is closed by default where the design says, and remembers what the user chose", async () => {
    const { unmount } = inShell(
      <Pane id="pads" title="Pads" collapsed>
        <p>Pad grid</p>
      </Pane>,
    );
    const toggle = screen.getByRole("button", { name: "Pads" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(toggle);
    expect(loadShellSettings().panes).toEqual({ pads: "o" });
    unmount();
    inShell(
      <Pane id="pads" title="Pads" collapsed>
        <p>Pad grid</p>
      </Pane>,
    );
    expect(screen.getByRole("button", { name: "Pads" })).toHaveAttribute("aria-expanded", "true");
  });

  it("fills its column and goes back, hiding the other boxes meanwhile", async () => {
    const { container } = inShell(
      <Column>
        <Pane id="music" title="Scene music" kind="music">
          <p>Music</p>
        </Pane>
        <Pane id="onair" title="On air" kind="onair" collapsed>
          <p>Lanes</p>
        </Pane>
      </Column>,
    );
    const user = userEvent.setup();
    const fill = screen.getByRole("button", { name: "Fill the column with On air" });
    expect(fill).toHaveAttribute("aria-pressed", "false");
    await user.click(fill);
    const back = screen.getByRole("button", { name: "Back to all panes" });
    expect(back).toHaveAttribute("aria-pressed", "true");
    // Filling a column opens the box.
    expect(screen.getByRole("button", { name: "On air" })).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".col")).toHaveClass("has-max");
    expect(screen.getByRole("region", { name: "On air" })).toHaveClass("maxed");
    await user.click(back);
    expect(container.querySelector(".col")).not.toHaveClass("has-max");
  });

  it("has no fill button outside a column, or when told so", () => {
    inShell(
      <>
        <Pane id="a" title="Alone">
          x
        </Pane>
        <Column>
          <Pane id="b" title="Fixed" noMax>
            y
          </Pane>
        </Column>
      </>,
    );
    expect(screen.queryByRole("button", { name: /Fill the column/ })).toBeNull();
  });

  it("keeps the rest of the page working when its content fails (BUG-9)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    function Fragile() {
      if (fail) {
        throw new Error("boom");
      }
      return <p>Back again</p>;
    }
    inShell(
      <>
        <Pane id="broken" title="Scenes">
          <Fragile />
        </Pane>
        <Pane id="fine" title="Pads">
          <p>Pad grid</p>
        </Pane>
      </>,
    );
    const broken = screen.getByRole("region", { name: "Scenes" });
    expect(within(broken).getByRole("alert")).toHaveTextContent(
      "Something went wrong in Scenes, so Lyre stopped showing it. Everything else keeps working.",
    );
    expect(screen.getByText("Pad grid")).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(within(broken).getByRole("button", { name: "Show Scenes again" }));
    expect(screen.getByText("Back again")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("can be told its open state by its screen", async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open it</Button>
          <Pane id="ctl" title="Search" open={open} onOpenChange={setOpen}>
            <p>Results</p>
          </Pane>
        </>
      );
    }
    inShell(<Controlled />);
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-expanded", "true");
  });
});
