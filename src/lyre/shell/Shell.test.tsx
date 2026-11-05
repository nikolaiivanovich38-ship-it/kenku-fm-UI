import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "./Shell";
import { ShellDataProvider } from "./ShellData";
import { expectNoAxeViolations } from "../test/axe";
import { loadShellSettings } from "./settings";
import { Column, Pane } from "../kit/Pane";
import { SCREENS } from "../screens";

function go(path: string) {
  act(() => {
    window.location.hash = `#/${path}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/campaigns");
  document.documentElement.removeAttribute("data-theme");
});

describe("the shell: rail, routes and screens (UX-9)", () => {
  it("shows the rail's sections in the prototype's order, the current one marked", () => {
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Lyre" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Campaigns",
      "Library",
      "Playlists",
      "Pad boards",
      "Live",
      "Outputs",
    ]);
    expect(screen.getByRole("link", { name: "Look and feel" })).toHaveAttribute("href", "#/look");
    expect(within(nav).getByRole("link", { name: "Campaigns" })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["campaigns", "Campaigns", "Campaigns"],
    ["campaign/crown", "Campaign", "Campaigns"],
    ["session/crown/s14", "Session", "Campaigns"],
    ["library", "Library", "Library"],
    ["library/t44", "Library", "Library"],
    ["playlists", "Playlists", "Playlists"],
    ["playlist/p-abbess", "Playlist", "Playlists"],
    ["boards", "Pad boards", "Pad boards"],
    ["board/weather", "Pad board", "Pad boards"],
    ["live", "Live", "Live"],
    ["outputs", "Outputs", "Outputs"],
    ["look", "Look and feel", "Look and feel"],
  ])("%s shows its heading and a placeholder, with %s's section lit", (path, heading, section) => {
    window.history.replaceState(null, "", `#/${path}`);
    render(<Shell />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(heading);
    expect(within(main).getByText("Not built yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
  });

  it("moves focus to the new screen's heading when the route changes, without an outline class", () => {
    render(<Shell />);
    go("library");
    const h1 = within(screen.getByRole("main")).getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Library");
    expect(h1).toHaveFocus();
    expect(h1).toHaveAttribute("tabindex", "-1");
    expect(h1.closest(".viewhead")).not.toBeNull();
  });

  it("does not take focus when the page first opens", () => {
    render(<Shell />);
    expect(document.body).toHaveFocus();
  });

  it("follows the rail's links", async () => {
    render(<Shell />);
    await userEvent.setup().click(screen.getByRole("link", { name: "Pad boards" }));
    expect(window.location.hash).toBe("#/boards");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toHaveTextContent("Pad boards");
  });

  it("shows icons only on request, and remembers it", async () => {
    render(<Shell />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show icons only" }));
    expect(screen.getByRole("complementary")).toHaveClass("rail", "min");
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("title", "Library");
    expect(loadShellSettings().rail).toBe("min");
    await user.click(screen.getByRole("button", { name: "Show menu labels" }));
    expect(screen.getByRole("complementary")).not.toHaveClass("min");
  });

  it("shows what the library knows in the rail (the loaded session, the outputs)", () => {
    render(
      <ShellDataProvider value={{ liveLabel: "Live: S14", outputsLabel: "Outputs (1/2)" }}>
        <Shell />
      </ShellDataProvider>,
    );
    expect(screen.getByRole("link", { name: "Live: S14" })).toHaveAttribute("href", "#/live");
    expect(screen.getByRole("link", { name: "Outputs (1/2)" })).toHaveAttribute("href", "#/outputs");
  });

  it("passes axe on every placeholder screen", async () => {
    render(<Shell />);
    for (const path of ["campaigns", "library", "live", "look"]) {
      go(path);
      await expectNoAxeViolations();
    }
  });
});

describe("themes (UX-11): Candlelit Library by default, each campaign's own, or one from Look and feel", () => {
  const data = { campaignTheme: (cid: string) => ({ crown: "hearth", ash: "elysium" })[cid] as never };

  it("opens in Candlelit Library", () => {
    render(<Shell />);
    expect(document.documentElement.dataset.theme).toBe("candle");
  });

  it("switches to a campaign's theme while it is open, and keeps it on the Library", () => {
    render(
      <ShellDataProvider value={data}>
        <Shell />
      </ShellDataProvider>,
    );
    go("campaign/crown");
    expect(document.documentElement.dataset.theme).toBe("hearth");
    go("library");
    expect(document.documentElement.dataset.theme).toBe("hearth");
    go("campaigns");
    expect(document.documentElement.dataset.theme).toBe("candle");
  });

  it("uses the theme chosen in Look and feel everywhere, and remembers it", async () => {
    render(
      <ShellDataProvider value={data}>
        <Shell />
      </ShellDataProvider>,
    );
    go("look");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Theme" }), "Parchment (light)");
    expect(document.documentElement.dataset.theme).toBe("parchment");
    go("campaign/crown");
    expect(document.documentElement.dataset.theme).toBe("parchment");
    expect(loadShellSettings().theme).toBe("parchment");
  });
});

describe("keyboard: F6 and Shift+F6 jump between boxes (UX-12)", () => {
  it("cycles the box headers of the screen and says where you are", () => {
    const Outputs = () => (
      <>
        <div className="viewhead">
          <h1>Outputs</h1>
        </div>
        <Column>
          <Pane id="t1" title="Rooms">
            a
          </Pane>
          <Pane id="t2" title="Not in a room">
            b
          </Pane>
          <Pane id="t3" title="Bots">
            c
          </Pane>
        </Column>
      </>
    );
    window.history.replaceState(null, "", "#/outputs");
    render(<Shell screens={{ ...SCREENS, outputs: Outputs }} />);
    const press = (shiftKey = false) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", shiftKey, bubbles: true })));
    press();
    expect(screen.getByRole("button", { name: "Rooms" })).toHaveFocus();
    press();
    expect(screen.getByRole("button", { name: "Not in a room" })).toHaveFocus();
    press(true);
    expect(screen.getByRole("button", { name: "Rooms" })).toHaveFocus();
    press(true);
    expect(screen.getByRole("button", { name: "Bots" })).toHaveFocus();
    press();
    expect(screen.getByRole("button", { name: "Rooms" })).toHaveFocus();
  });
});
