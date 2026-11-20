import React, { createContext, useContext, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { goToTrackLibrary, SidePanel, SidePanelHost, SidePanelProvider, useOpenTrackPanel, useSidePanelOpen, useSidePanels, type OpenTrackPanel, type SidePanelKind, type SidePanelRoom } from "./SidePanel";

/** The window as the shell lays it out: #work holds Add music docked left, #app (menu and screen), then the panels. */
function Window({ room, children, openTrackPanel }: { room?: () => SidePanelRoom; children: React.ReactNode; openTrackPanel?: OpenTrackPanel }) {
  return (
    <SidePanelProvider measureRoom={room} openTrackPanel={openTrackPanel}>
      <div id="work">
        <SidePanelHost edge="left" />
        <div id="app">
          <main>{children}</main>
        </div>
        <SidePanelHost edge="right" />
      </div>
    </SidePanelProvider>
  );
}

function Opener({ kind, label, onClosedByHost }: { kind: SidePanelKind; label: string; onClosedByHost?: () => void }) {
  const { openSidePanel, closeSidePanel } = useSidePanels();
  const open = useSidePanelOpen(kind);
  return (
    <>
      <button type="button" onClick={() => openSidePanel(kind, <aside aria-label={label}>{label} content</aside>, { onClosedByHost })}>
        Open {label}
      </button>
      <button type="button" onClick={() => closeSidePanel(kind)}>
        Close {label}
      </button>
      <span data-testid={`${kind}-open`}>{String(open)}</span>
    </>
  );
}

const panelNames = () => Array.from(document.querySelectorAll("#work aside")).map((a) => a.getAttribute("aria-label"));

afterEach(() => {
  window.history.replaceState(null, "", "#/campaigns");
});

describe("the side-panel host: panels beside the screen, not over it (R10-FIX §3)", () => {
  it("shows a panel's content beside the screen, inside #work and outside #app, and closes it", async () => {
    const user = userEvent.setup();
    render(
      <Window>
        <Opener kind="help" label="Help" />
      </Window>,
    );
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
    expect(screen.getByTestId("help-open")).toHaveTextContent("false");
    await user.click(screen.getByRole("button", { name: "Open Help" }));
    const help = screen.getByRole("complementary", { name: "Help" });
    expect(help.closest("#work")).not.toBeNull();
    expect(help.closest("#app")).toBeNull();
    expect(help.closest("[data-panel]")).toHaveAttribute("data-panel", "help");
    expect(screen.getByTestId("help-open")).toHaveTextContent("true");
    await user.click(screen.getByRole("button", { name: "Close Help" }));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
    expect(screen.getByTestId("help-open")).toHaveTextContent("false");
  });

  it("keeps one panel of each kind: opening it again replaces what it shows", async () => {
    function Twice() {
      const { openSidePanel } = useSidePanels();
      return (
        <>
          <button type="button" onClick={() => openSidePanel("find", <aside aria-label="Found">battle</aside>)}>
            Find battle
          </button>
          <button type="button" onClick={() => openSidePanel("find", <aside aria-label="Found">rain</aside>)}>
            Find rain
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <Window>
        <Twice />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Find battle" }));
    await user.click(screen.getByRole("button", { name: "Find rain" }));
    expect(screen.getAllByRole("complementary", { name: "Found" })).toHaveLength(1);
    expect(screen.getByRole("complementary", { name: "Found" })).toHaveTextContent("rain");
  });

  it("puts the panels in one order from left to right, whatever order they opened in, Add music docked left before the menu", async () => {
    function Many() {
      const { openSidePanel } = useSidePanels();
      return (
        <button
          type="button"
          onClick={() => {
            openSidePanel("help", <aside aria-label="Help" />);
            openSidePanel("trackPanel", <aside aria-label="Track panel" />);
            openSidePanel("queue", <aside aria-label="Queue" />);
            openSidePanel("find", <aside aria-label="Found" />);
          }}
        >
          Open four
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <Window>
        <Many />
        <Opener kind="addMusic" label="Add music" />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open four" }));
    expect(panelNames()).toEqual(["Found", "Queue", "Track panel", "Help"]);
    await user.click(screen.getByRole("button", { name: "Open Add music" }));
    expect(panelNames()).toEqual(["Found", "Queue", "Track panel", "Add music", "Help"]);
    // Docked left, Add music comes before the menu and the screen.
    function DockLeft() {
      const { openSidePanel } = useSidePanels();
      return (
        <button type="button" onClick={() => openSidePanel("addMusic", <aside aria-label="Add music" />, { edge: "left" })}>
          Dock left
        </button>
      );
    }
    render(
      <SidePanelProvider>
        <div id="left-test">
          <SidePanelHost edge="left" />
          <DockLeft />
          <SidePanelHost edge="right" />
        </div>
      </SidePanelProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Dock left" }));
    const left = document.querySelector("#left-test aside")!;
    expect(left.compareDocumentPosition(screen.getByRole("button", { name: "Dock left" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(left.closest("[data-panel]")).toHaveAttribute("data-edge", "left");
  });

  it("starts each panel at the right under a strip as tall as the top bar, kept clear of the window's buttons", async () => {
    const user = userEvent.setup();
    render(
      <Window>
        <Opener kind="queue" label="Queue" />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open Queue" }));
    const holder = screen.getByRole("complementary", { name: "Queue" }).closest("[data-panel]")!;
    const strip = holder.querySelector(".side-panel-strip");
    expect(strip).not.toBeNull();
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(holder.firstElementChild).toBe(strip);
  });

  it("closes the panel opened first when a second one would leave the screen under 600 px, and focus stays in the new one", async () => {
    const room = vi.fn<() => SidePanelRoom>(() => ({ window: 1920, screen: 1200 }));
    const firstGaveWay = vi.fn();
    function Second() {
      const { openSidePanel } = useSidePanels();
      return (
        <button
          type="button"
          onClick={() => {
            room.mockReturnValue({ window: 960, screen: 300 });
            openSidePanel("help", <aside aria-label="Help"><input aria-label="Search help" autoFocus /></aside>);
          }}
        >
          Open Help at half a screen
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <Window room={room}>
        <Opener kind="trackPanel" label="Track panel" onClosedByHost={firstGaveWay} />
        <Second />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open Track panel" }));
    expect(panelNames()).toEqual(["Track panel"]);
    await user.click(screen.getByRole("button", { name: "Open Help at half a screen" }));
    expect(panelNames()).toEqual(["Help"]);
    expect(firstGaveWay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Search help" })).toHaveFocus();
    expect(screen.getByTestId("trackPanel-open")).toHaveTextContent("false");
  });

  it("checks the room again when the window is resized", async () => {
    let room: SidePanelRoom = { window: 1920, screen: 1000 };
    const user = userEvent.setup();
    render(
      <Window room={() => room}>
        <Opener kind="trackPanel" label="Track panel" />
        <Opener kind="help" label="Help" />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open Track panel" }));
    await user.click(screen.getByRole("button", { name: "Open Help" }));
    expect(panelNames()).toEqual(["Track panel", "Help"]);
    room = { window: 1100, screen: 500 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(panelNames()).toEqual(["Help"]);
  });

  it("closing a panel by its owner does not count as the host closing it", async () => {
    const gaveWay = vi.fn();
    const user = userEvent.setup();
    render(
      <Window>
        <Opener kind="help" label="Help" onClosedByHost={gaveWay} />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open Help" }));
    await user.click(screen.getByRole("button", { name: "Close Help" }));
    expect(gaveWay).not.toHaveBeenCalled();
  });
});

/* Code review of 0.6.0 (R60-CODE-REVIEW.md M9, M10): focus never drops to the page when a panel closes, and a panel
   that takes the whole window keeps Tab out of the screen under it. */
describe("the side-panel host: focus and the covered screen", () => {
  function PanelWithButton({ kind, label }: { kind: SidePanelKind; label: string }) {
    const { openSidePanel } = useSidePanels();
    return (
      <button type="button" onClick={() => openSidePanel(kind, <aside aria-label={label}><button type="button">Inside {label}</button></aside>)}>
        Open {label}
      </button>
    );
  }

  it("when the host closes a panel that had focus, focus goes back to what opened it", async () => {
    let room: SidePanelRoom = { window: 1920, screen: 1000 };
    const user = userEvent.setup();
    render(
      <Window room={() => room}>
        <PanelWithButton kind="trackPanel" label="Track panel" />
        <Opener kind="help" label="Help" />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open Track panel" }));
    await user.click(screen.getByRole("button", { name: "Open Help" }));
    screen.getByRole("button", { name: "Inside Track panel" }).focus();
    room = { window: 1100, screen: 500 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(panelNames()).toEqual(["Help"]);
    expect(screen.getByRole("button", { name: "Open Track panel" })).toHaveFocus();
  });

  it("a screen's own panel that goes away with what showed it leaves focus on the screen's main heading", async () => {
    function Preview() {
      const [on, setOn] = useState(true);
      return (
        <>
          <h1>The abbey ruins</h1>
          {on && (
            <SidePanel kind="queue">
              <aside aria-label="Queue">
                <button type="button" onClick={() => setOn(false)}>
                  Stop the preview
                </button>
              </aside>
            </SidePanel>
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <Window>
        <Preview />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Stop the preview" }));
    expect(panelNames()).toEqual([]);
    expect(screen.getByRole("heading", { name: "The abbey ruins" })).toHaveFocus();
  });

  it("below 760 px a panel takes the window and the screen under it is out of reach (inert) until it closes", async () => {
    const room = () => ({ window: 700, screen: 700 });
    const user = userEvent.setup();
    render(
      <Window room={room}>
        <Opener kind="help" label="Help" />
      </Window>,
    );
    const app = document.getElementById("app")!;
    expect(app).not.toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Open Help" }));
    expect(app).toHaveAttribute("inert");
    act(() => {
      screen.getByRole("button", { name: "Close Help" }).click();
    });
    expect(app).not.toHaveAttribute("inert");
  });

  it("in a wide window the screen beside a panel stays usable", async () => {
    const user = userEvent.setup();
    render(
      <Window room={() => ({ window: 1280, screen: 900 })}>
        <Opener kind="help" label="Help" />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Open Help" }));
    expect(document.getElementById("app")).not.toHaveAttribute("inert");
  });
});

describe("<SidePanel>: a screen's own panel, drawn beside the screen", () => {
  const Owner = createContext("none");
  function Shown() {
    return <p>From {useContext(Owner)}</p>;
  }
  function Screen() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    return (
      <Owner.Provider value="Live">
        <input aria-label="Find" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" onClick={() => setOpen(!open)}>
          Results
        </button>
        {open && (
          <SidePanel kind="find" onClosedByHost={() => setOpen(false)}>
            <aside aria-label="Found">
              <Shown />
              <span>Looking for {query}</span>
            </aside>
          </SidePanel>
        )}
      </Owner.Provider>
    );
  }

  it("keeps the screen's own context and follows its state as it changes", async () => {
    const user = userEvent.setup();
    render(
      <Window>
        <Screen />
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Results" }));
    const found = screen.getByRole("complementary", { name: "Found" });
    expect(found.closest("#app")).toBeNull();
    expect(within(found).getByText("From Live")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Find" }), "rain");
    expect(within(found).getByText("Looking for rain")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.queryByRole("complementary", { name: "Found" })).toBeNull();
  });
});

describe("openTrackPanel: a track's details from anywhere outside the Track library", () => {
  function Title({ from }: { from?: boolean }) {
    const openTrackPanel = useOpenTrackPanel();
    return (
      <button type="button" onClick={(e) => openTrackPanel("t41", from ? e.currentTarget : null)}>
        Brutal battle
      </button>
    );
  }

  it("goes to the Track library with the track's details shown, until the Track panel is built (stand-in)", async () => {
    render(
      <Window openTrackPanel={goToTrackLibrary}>
        <Title />
      </Window>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Brutal battle" }));
    expect(window.location.hash).toBe("#/library/t41");
  });

  it("hands the track, the title it came from and the host to the Track panel's opener", async () => {
    const opener = vi.fn();
    render(
      <Window openTrackPanel={opener}>
        <Title from />
      </Window>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Brutal battle" }));
    expect(opener).toHaveBeenCalledTimes(1);
    const [trackId, from, panels] = opener.mock.calls[0];
    expect(trackId).toBe("t41");
    expect(from).toBe(screen.getByRole("button", { name: "Brutal battle" }));
    expect(typeof panels.openSidePanel).toBe("function");
    expect(typeof panels.closeSidePanel).toBe("function");
  });

  it("is the stand-in by default", async () => {
    render(
      <Window>
        <Title />
      </Window>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Brutal battle" }));
    expect(window.location.hash).toBe("#/library/t41");
  });
});
