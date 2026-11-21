import { describe, expect, it } from "vitest";
import { MIN_SCREEN_PX, NARROW_WINDOW_PX, panelToGiveWay, SIDE_PANEL_ORDER } from "./sidePanelRoom";
import { gaveWayWords } from "./SidePanel";

describe("which side panel gives way (R10-FIX §3: the screen keeps 600 px)", () => {
  it("closes nothing while one panel is open, however narrow the window", () => {
    expect(panelToGiveWay(["help"], { window: 500, screen: 0 })).toBeNull();
    expect(panelToGiveWay([], { window: 500, screen: 0 })).toBeNull();
  });

  it("closes nothing while the screen keeps 600 px or more beside two panels", () => {
    expect(panelToGiveWay(["trackPanel", "help"], { window: 1920, screen: MIN_SCREEN_PX })).toBeNull();
  });

  it("closes the panel opened first when a second one leaves the screen less than 600 px", () => {
    expect(panelToGiveWay(["trackPanel", "help"], { window: 1280, screen: MIN_SCREEN_PX - 1 })).toBe("trackPanel");
    expect(panelToGiveWay(["help", "queue", "find"], { window: 1280, screen: 420 })).toBe("help");
  });

  it("below 760 px of window a panel takes the whole window, so a second one closes the first", () => {
    expect(panelToGiveWay(["help", "trackPanel"], { window: NARROW_WINDOW_PX - 1, screen: 700 })).toBe("help");
  });

  it("closes nothing before anything is measured (a window 0 px wide)", () => {
    expect(panelToGiveWay(["help", "trackPanel"], { window: 0, screen: 0 })).toBeNull();
  });

  it("orders the panels from left to right: Add music docked left, Find's results, the queue, the Track panel, Add music docked right, Help", () => {
    expect(SIDE_PANEL_ORDER).toEqual(["addMusic:left", "find", "queue", "trackPanel", "addMusic:right", "help"]);
  });
});

/* The 0.6.0 usability test (F-P11): a panel that gives way says so. */
describe("gaveWayWords", () => {
  it("names the panel that closed and the one it made room for, as a sentence", () => {
    expect(gaveWayWords("trackPanel", "help")).toBe("The track details closed to make room for Help.");
    expect(gaveWayWords("help", "queue")).toBe("Help closed to make room for the queue.");
  });
});
