import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clampFloat, PanelDialog } from "./PanelDialog";
import { SidePanelHost, SidePanelProvider } from "./SidePanel";
import { Button } from "./Button";
import { ShellSettingsProvider } from "../shell/ShellSettings";
import { expectNoAxeViolations } from "../test/axe";

/** A prep screen with Add music: the panel docks beside the screen or floats over it, and never blocks the page. */
function Planner({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  return (
    <ShellSettingsProvider>
      <SidePanelProvider>
        <div id="work">
          <SidePanelHost edge="left" />
          <div id="app">
            <main>
              <Button onClick={() => setOpen(true)}>Add tracks or playlists…</Button>
              <Button onClick={() => setClicks(clicks + 1)}>Session name</Button>
              <output aria-label="Clicks">{clicks}</output>
              <PanelDialog
                open={open}
                title="Add to The abbey ruins"
                placeId="addMusic"
                onClose={() => {
                  setOpen(false);
                  onClose();
                }}
                footer={
                  <>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="primary">Done</Button>
                  </>
                }
              >
                <label>
                  Search <input type="search" />
                </label>
              </PanelDialog>
            </main>
          </div>
          <SidePanelHost edge="right" />
        </div>
      </SidePanelProvider>
    </ShellSettingsProvider>
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Add to The abbey ruins" });
const holder = () => dialog().closest("[data-panel]");

async function openIt() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add tracks or playlists…" }));
  return user;
}

async function dockTo(user: ReturnType<typeof userEvent.setup>, where: "Dock left" | "Dock right" | "Float") {
  await user.click(within(dialog()).getByRole("button", { name: /^Dock/ }));
  await user.click(screen.getByRole("menuitemradio", { name: where }));
}

beforeEach(() => localStorage.clear());

describe("PanelDialog: a dialog that does not block the page (R10 rows 12 and 37)", () => {
  it("is a dialog named by its title, not modal, with focus in its first field", async () => {
    render(<Planner />);
    await openIt();
    expect(dialog()).not.toHaveAttribute("aria-modal");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus();
    expect(document.querySelector(".sheet")).toBeNull();
  });

  it("leaves the page usable while it is open", async () => {
    render(<Planner />);
    const user = await openIt();
    await user.click(screen.getByRole("button", { name: "Session name" }));
    expect(screen.getByLabelText("Clicks")).toHaveTextContent("1");
    expect(dialog()).toBeInTheDocument();
  });

  it("closes on Escape and gives focus back to what opened it", async () => {
    const onClose = vi.fn();
    render(<Planner onClose={onClose} />);
    const user = await openIt();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Add tracks or playlists…" })).toHaveFocus();
  });

  it("opens docked at the right, beside the screen, as the Add music side panel", async () => {
    render(<Planner />);
    await openIt();
    expect(holder()).toHaveAttribute("data-panel", "addMusic");
    expect(holder()).toHaveAttribute("data-edge", "right");
    expect(dialog().closest("#app")).toBeNull();
  });

  it("has one Dock menu with words: Dock left, Dock right and Float, the current one ticked", async () => {
    render(<Planner />);
    const user = await openIt();
    await user.click(within(dialog()).getByRole("button", { name: /^Dock/ }));
    const menu = screen.getByRole("menu", { name: "Dock" });
    expect(within(menu).getAllByRole("menuitemradio").map((i) => i.textContent?.trim())).toEqual(["Dock left", "Dock right", "Float"]);
    expect(within(menu).getByRole("menuitemradio", { name: "Dock right" })).toHaveAttribute("aria-checked", "true");
  });

  it("docks at the left, before the menu and the screen", async () => {
    render(<Planner />);
    const user = await openIt();
    await dockTo(user, "Dock left");
    expect(holder()).toHaveAttribute("data-edge", "left");
    expect(within(dialog()).getByRole("button", { name: /^Dock/ })).toHaveFocus();
  });

  it("floats over the screen, out of the side panels, inside the window", async () => {
    render(<Planner />);
    const user = await openIt();
    await dockTo(user, "Float");
    expect(holder()).toBeNull();
    const panel = dialog();
    expect(panel).toHaveAttribute("data-dock", "float");
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(panel.style.width)).toBeGreaterThanOrEqual(320);
  });

  it("moves with its move button and the arrow keys, and Shift and the arrows change its size", async () => {
    render(<Planner />);
    const user = await openIt();
    await dockTo(user, "Float");
    const move = within(dialog()).getByRole("button", { name: "Move or size with the arrow keys" });
    move.focus();
    const left = parseFloat(dialog().style.left);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(parseFloat(dialog().style.left)).toBe(left + 40);
    const width = parseFloat(dialog().style.width);
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(parseFloat(dialog().style.width)).toBe(width + 20);
    expect(move).toHaveFocus();
  });

  it("docked, the arrow keys let it float and Shift and the arrows change its width", async () => {
    render(<Planner />);
    const user = await openIt();
    within(dialog()).getByRole("button", { name: "Move or size with the arrow keys" }).focus();
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(holder()).toHaveAttribute("data-edge", "right");
    expect(holder()?.getAttribute("style")).toMatch(/--dock-w: \d+px/);
    await user.keyboard("{ArrowLeft}");
    expect(holder()).toBeNull();
    expect(dialog()).toHaveAttribute("data-dock", "float");
  });

  it("moves when its title bar is dragged", async () => {
    render(<Planner />);
    const user = await openIt();
    await dockTo(user, "Float");
    const head = dialog().querySelector("header")!;
    const left = parseFloat(dialog().style.left);
    const top = parseFloat(dialog().style.top);
    fireEvent.pointerDown(head, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(document, { clientX: 130, clientY: 150 });
    fireEvent.pointerUp(document, { clientX: 130, clientY: 150 });
    expect(parseFloat(dialog().style.left)).toBe(left + 30);
    expect(parseFloat(dialog().style.top)).toBe(top + 50);
  });

  it("remembers where it was the next time it opens", async () => {
    const { unmount } = render(<Planner />);
    const user = await openIt();
    await dockTo(user, "Dock left");
    unmount();
    render(<Planner />);
    await openIt();
    expect(holder()).toHaveAttribute("data-edge", "left");
  });

  it("has no accessibility failures, docked or floating", async () => {
    const { container } = render(<Planner />);
    const user = await openIt();
    await expectNoAxeViolations(document.body);
    await dockTo(user, "Float");
    await expectNoAxeViolations(container.ownerDocument.body);
  });
});

describe("a floating panel's place stays inside the window", () => {
  it("keeps 8 px from each edge and a size of at least 320 × 240", () => {
    expect(clampFloat({ dock: "float", left: -50, top: -10, width: 100, height: 100 }, { width: 1280, height: 800 })).toEqual({ dock: "float", left: 8, top: 8, width: 320, height: 240 });
    expect(clampFloat({ dock: "float", left: 1200, top: 700, width: 600, height: 500 }, { width: 1280, height: 800 })).toEqual({ dock: "float", left: 672, top: 292, width: 600, height: 500 });
  });

  it("is never bigger than the window less 16 px", () => {
    expect(clampFloat({ dock: "float", left: 0, top: 0, width: 3000, height: 3000 }, { width: 1280, height: 800 })).toEqual({ dock: "float", left: 8, top: 8, width: 1264, height: 784 });
  });
});
