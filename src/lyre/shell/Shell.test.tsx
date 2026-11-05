import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "./Shell";
import { ShellDataProvider } from "./ShellData";
import { expectNoAxeViolations } from "../test/axe";
import { loadShellSettings } from "./settings";
import { Column, Pane } from "../kit/Pane";
import { SCREENS } from "../screens";
import { PlaceholderScreen } from "../screens/Placeholder";

// Built screens can reach the audio host, whose worklet file is a webpack asset.
vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

// The shell's own tests: built screens read the library and play sound, so they are placeholders here.
const SHELL_SCREENS = {
  ...SCREENS,
  library: () => <PlaceholderScreen title="Library" />,
  playlists: () => <PlaceholderScreen title="Playlists" />,
  playlist: () => <PlaceholderScreen title="Playlist" />,
  boards: () => <PlaceholderScreen title="Pad boards" />,
  board: () => <PlaceholderScreen title="Pad board" />,
  campaigns: () => <PlaceholderScreen title="Campaigns" />,
  campaign: () => <PlaceholderScreen title="Campaign" />,
  session: () => <PlaceholderScreen title="Session" />,
};

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
    render(<Shell screens={SHELL_SCREENS} />);
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
  ])("%s shows its heading and a placeholder, with %s's section lit", (path, heading, section) => {
    window.history.replaceState(null, "", `#/${path}`);
    render(<Shell screens={SHELL_SCREENS} />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(heading);
    expect(within(main).getByText("Not built yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["live", "Live"],
    ["outputs", "Outputs"],
  ])("%s says in plain words that it comes in 0.4 and where to run a session until then (w3-ux 2)", (path, heading) => {
    window.history.replaceState(null, "", `#/${path}`);
    render(<Shell screens={SHELL_SCREENS} />);
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { level: 1 })).toHaveTextContent(heading);
    expect(main.getByText("Live comes in Lyre 0.4. Until then, run your session from the Player tab.")).toBeInTheDocument();
    expect(main.queryByText("Not built yet.")).toBeNull();
  });

  it("moves focus to the new screen's heading when the route changes, without an outline class", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    go("library");
    const h1 = within(screen.getByRole("main")).getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Library");
    expect(h1).toHaveFocus();
    expect(h1).toHaveAttribute("tabindex", "-1");
    expect(h1.closest(".viewhead")).not.toBeNull();
  });

  it("moves focus to the heading of a screen that shows it once its data has loaded (w3-ux 5)", async () => {
    function Late() {
      const [ready, setReady] = React.useState(false);
      React.useEffect(() => void setTimeout(() => setReady(true), 50), []);
      return ready ? <PlaceholderScreen title="Late" /> : <p>Opening…</p>;
    }
    render(<Shell screens={{ ...SHELL_SCREENS, library: Late }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Library" }));
    expect(screen.getByRole("link", { name: "Library" })).toHaveFocus();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Late" });
    await vi.waitFor(() => expect(h1).toHaveFocus());
  });

  it("keeps focus on the heading when a loading heading is replaced by the screen's own (w3-ux 5)", async () => {
    function Swap() {
      const [ready, setReady] = React.useState(false);
      React.useEffect(() => void setTimeout(() => setReady(true), 50), []);
      return ready ? <PlaceholderScreen key="ready" title="Board" /> : <PlaceholderScreen key="loading" title="Pad board" />;
    }
    render(<Shell screens={{ ...SHELL_SCREENS, board: Swap }} />);
    go("board/new");
    expect(screen.getByRole("heading", { level: 1, name: "Pad board" })).toHaveFocus();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Board" });
    await vi.waitFor(() => expect(h1).toHaveFocus());
  });

  it("leaves focus where the user put it while the screen was loading", async () => {
    function Late() {
      const [ready, setReady] = React.useState(false);
      React.useEffect(() => void setTimeout(() => setReady(true), 80), []);
      return ready ? <PlaceholderScreen title="Late" /> : <p>Opening…</p>;
    }
    render(<Shell screens={{ ...SHELL_SCREENS, library: Late }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Library" }));
    screen.getByRole("link", { name: "Playlists" }).focus();
    await screen.findByRole("heading", { level: 1, name: "Late" });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("link", { name: "Playlists" })).toHaveFocus();
  });

  it("does not take focus when the page first opens", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    expect(document.body).toHaveFocus();
  });

  it("follows the rail's links", async () => {
    render(<Shell screens={SHELL_SCREENS} />);
    await userEvent.setup().click(screen.getByRole("link", { name: "Pad boards" }));
    expect(window.location.hash).toBe("#/boards");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toHaveTextContent("Pad boards");
  });

  it("shows icons only on request, and remembers it", async () => {
    render(<Shell screens={SHELL_SCREENS} />);
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
        <Shell screens={SHELL_SCREENS} />
      </ShellDataProvider>,
    );
    expect(screen.getByRole("link", { name: "Live: S14" })).toHaveAttribute("href", "#/live");
    expect(screen.getByRole("link", { name: "Outputs (1/2)" })).toHaveAttribute("href", "#/outputs");
  });

  it("passes axe on every placeholder screen", async () => {
    render(<Shell screens={SHELL_SCREENS} />);
    for (const path of ["campaigns", "library", "live", "look"]) {
      go(path);
      await expectNoAxeViolations();
    }
  });
});

describe("themes (UX-11): Candlelit Library by default, each campaign's own, or one from Look and feel", () => {
  const data = { campaignTheme: (cid: string) => ({ crown: "hearth", ash: "elysium" })[cid] as never };

  it("opens in Candlelit Library", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    expect(document.documentElement.dataset.theme).toBe("candle");
  });

  it("switches to a campaign's theme while it is open, and keeps it on the Library", () => {
    render(
      <ShellDataProvider value={data}>
        <Shell screens={SHELL_SCREENS} />
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
        <Shell screens={SHELL_SCREENS} />
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
    render(<Shell screens={{ ...SHELL_SCREENS, outputs: Outputs }} />);
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
