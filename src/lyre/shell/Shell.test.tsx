import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "./Shell";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { LyreApiProvider } from "../api";
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
      "Rooms",
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
    expect(within(screen.getByRole("navigation", { name: "Lyre" })).getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
  });

  // Outputs is built (w4-outputs); Live still says it comes later.
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
      <LyreApiProvider api={createFakeLyreApi()}>
        <ShellDataProvider value={data}>
          <Shell screens={SHELL_SCREENS} />
        </ShellDataProvider>
      </LyreApiProvider>,
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

describe("FND-8 Help in the shell: one entry at the foot of the rail, and F1", () => {
  const help = () => screen.queryByRole("complementary", { name: "Help" });
  const press = (key: string, target: Element = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

  it("has a Help button right after Look and feel, before Icons only, closed at first", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    const button = screen.getByRole("button", { name: "Help" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-keyshortcuts", "F1");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.previousElementSibling).toBe(screen.getByRole("link", { name: "Look and feel" }));
    expect(button.nextElementSibling).toBe(screen.getByRole("button", { name: "Show icons only" }));
    expect(help()).toBeNull();
  });

  it("opens Help beside the screen from the rail; Esc closes it and focus goes back to the button", async () => {
    const user = userEvent.setup();
    render(<Shell screens={SHELL_SCREENS} />);
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(help()).toBeInTheDocument();
    expect(help()?.parentElement?.id).toBe("app");
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("searchbox", { name: "Search help" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(help()).toBeNull();
    expect(screen.getByRole("button", { name: "Help" })).toHaveFocus();
  });

  it("F1 opens it from anywhere, and stays open across screens", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    press("F1");
    expect(screen.getByRole("searchbox", { name: "Search help" })).toHaveFocus();
    go("library");
    expect(help()).toBeInTheDocument();
  });

  it("leaves F1 to a screen that uses it (a Live pad on F1)", () => {
    const takeF1 = (e: KeyboardEvent) => e.key === "F1" && e.preventDefault();
    document.addEventListener("keydown", takeF1);
    try {
      render(<Shell screens={SHELL_SCREENS} />);
      press("F1");
      expect(help()).toBeNull();
    } finally {
      document.removeEventListener("keydown", takeF1);
    }
  });

  it("shows the tour only when the page asks for it", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FND-8 the first-run tour", () => {
  const tour = () => screen.queryByRole("dialog", { name: /\d of 5$/ });

  it("shows five short steps with Skip on each, then remembers it was seen", async () => {
    const user = userEvent.setup();
    render(<Shell screens={SHELL_SCREENS} firstRunTour />);
    const titles: string[] = [];
    for (let step = 1; step <= 5; step++) {
      const box = screen.getByRole("dialog", { name: new RegExp(` ${step} of 5$`) });
      expect(within(box).getByRole("button", { name: "Skip" })).toBeInTheDocument();
      titles.push(within(box).getByRole("heading").textContent ?? "");
      if (step === 1) expect(within(box).getByRole("button", { name: "Next" })).toHaveFocus();
      await user.click(within(box).getByRole("button", { name: step === 5 ? "Done" : "Next" }));
    }
    expect(titles).toEqual(["Lyre's places", "Library", "Scenes", "Live", "Now playing"]);
    expect(tour()).toBeNull();
    expect(loadShellSettings().tour).toBe("done");
  });

  it("Back goes to the step before; Skip and Esc end it", async () => {
    const user = userEvent.setup();
    render(<Shell screens={SHELL_SCREENS} firstRunTour />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Lyre's places 1 of 5" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(tour()).toBeNull();
    expect(loadShellSettings().tour).toBe("done");
  });

  it("does not come back once seen, and plays again from Help › Take the tour", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lyre-shell", JSON.stringify({ tour: "done" }));
    render(<Shell screens={SHELL_SCREENS} firstRunTour />);
    expect(tour()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Lyre's places 1 of 5" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("button", { name: "Help" })).toHaveFocus();
  });

  it("passes axe with the tour up", async () => {
    render(<Shell screens={SHELL_SCREENS} firstRunTour />);
    await expectNoAxeViolations();
  });
});

describe("Back and the trail (UX-18, round 6 parts 6 and 7)", () => {
  const back = () => within(screen.getByRole("main")).getAllByRole("button", { name: /^Back( to .+)?$/ })[0];

  it("is first in the top bar, a ‹ with no words; greyed at the very start of the history, saying why", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    const head = screen.getByRole("main").querySelector(".viewhead")!;
    expect(head.firstElementChild).toBe(back());
    expect(back()).toHaveAccessibleName("Back");
    expect(back()).toHaveTextContent("");
    expect(back()).toHaveAttribute("aria-disabled", "true");
    expect(back()).toHaveAttribute("title", "Nothing to go back to yet: this is the first screen since Lyre opened");
  });

  it("walks back through every place, from the menu too, one place a press; Alt+Left does the same", async () => {
    const user = userEvent.setup();
    render(<Shell screens={SHELL_SCREENS} />);
    await user.click(within(screen.getByRole("navigation", { name: "Lyre" })).getByRole("link", { name: "Pad boards" }));
    expect(back()).toHaveAccessibleName("Back to Campaigns");
    expect(back()).toHaveAttribute("title", "Back to Campaigns (Alt+Left)");
    go("board/weather");
    go("library");
    expect(back()).toHaveAccessibleName("Back to Pad board");
    await user.click(back());
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toHaveTextContent("Pad board");
    expect(back()).toHaveAccessibleName("Back to Pad boards");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toHaveTextContent("Pad boards");
    await user.click(back());
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toHaveTextContent("Campaigns");
    expect(back()).toHaveAttribute("aria-disabled", "true");
  });

  it("puts focus back on the control used to leave", async () => {
    function WithLinks() {
      return (
        <>
          <PlaceholderScreen title="Campaigns" />
          <a href="#/playlist/a">Ashen King</a>
          <a href="#/playlist/b">The Abbess</a>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Shell screens={{ ...SHELL_SCREENS, campaigns: WithLinks }} />);
    await user.click(screen.getByRole("link", { name: "The Abbess" }));
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toHaveTextContent("Playlist");
    await user.click(back());
    await vi.waitFor(() => expect(screen.getByRole("link", { name: "The Abbess" })).toHaveFocus());
  });

  it("shows the trail of a screen with parents right after Back, every part a link, the whole path on hover", () => {
    window.history.replaceState(null, "", "#/session/crown/s14");
    render(
      <ShellDataProvider
        value={{
          placeNames: { loaded: true, campaign: () => "The Sunken Crown", session: () => 14, playlist: () => null, board: () => null, track: () => null },
        }}
      >
        <Shell screens={SHELL_SCREENS} />
      </ShellDataProvider>,
    );
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(back().nextElementSibling).toBe(trail);
    expect(within(trail).getAllByRole("link").map((a) => a.textContent)).toEqual(["Campaigns", "The Sunken Crown"]);
    expect(trail).toHaveAttribute("title", "Campaigns › The Sunken Crown › Session");
  });

  it("has no trail on a screen at the top of the menu", () => {
    render(<Shell screens={SHELL_SCREENS} />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });
});
