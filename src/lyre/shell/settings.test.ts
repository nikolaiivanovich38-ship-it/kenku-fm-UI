import { beforeEach, describe, expect, it } from "vitest";
import { loadShellSettings, saveShellSettings, SHELL_SETTINGS_KEY } from "./settings";

beforeEach(() => localStorage.clear());

describe("remembered shell settings", () => {
  it("starts with Candlelit Library as the base theme, a rail that fits the window and no remembered boxes", () => {
    expect(loadShellSettings()).toEqual({ theme: "candle", rail: "auto", panes: {} });
  });

  it("0.5.1: the old \"Each campaign's own\" choice is brought over as the default base theme; a chosen theme stays the base", () => {
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "campaign", rail: "min", panes: {} }));
    expect(loadShellSettings().theme).toBe("candle");
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "elysium" }));
    expect(loadShellSettings().theme).toBe("elysium");
  });

  it("remembers the theme, the rail and which boxes are open or closed", () => {
    saveShellSettings({ theme: "parchment", rail: "min", panes: { scenes: "c" } });
    expect(loadShellSettings()).toEqual({ theme: "parchment", rail: "min", panes: { scenes: "c" } });
  });

  it("ignores damaged or unknown values instead of failing", () => {
    localStorage.setItem(SHELL_SETTINGS_KEY, "{not json");
    expect(loadShellSettings().theme).toBe("candle");
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "neon", rail: "wide", panes: { a: "x", b: "o" } }));
    expect(loadShellSettings()).toEqual({ theme: "candle", rail: "auto", panes: { b: "o" } });
  });

  it("FND-8: remembers that the first-run tour was seen, and nothing else counts as seen", () => {
    saveShellSettings({ theme: "candle", rail: "auto", panes: {}, tour: "done" });
    expect(loadShellSettings().tour).toBe("done");
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ tour: "yes" }));
    expect(loadShellSettings().tour).toBeUndefined();
  });

  it("round 10: remembers where a panel was, docked or floating, and drops a damaged place", () => {
    saveShellSettings({ theme: "candle", rail: "auto", panes: {}, places: { addMusic: { dock: "left", width: 420 }, other: { dock: "float", left: 10, top: 20, width: 400, height: 300 } } });
    expect(loadShellSettings().places).toEqual({ addMusic: { dock: "left", width: 420 }, other: { dock: "float", left: 10, top: 20, width: 400, height: 300 } });
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ places: { addMusic: { dock: "up" }, other: { dock: "float", left: "x" } } }));
    expect(loadShellSettings().places).toBeUndefined();
  });

  // Code review of 0.6.0 (R60-CODE-REVIEW.md M12): Set up Lyre's "Choose a theme" reads a flag Look and feel writes.
  it("round 10: remembers that a theme was chosen in Look and feel, and nothing else counts as choosing one", () => {
    saveShellSettings({ theme: "candle", rail: "min", panes: { scenes: "c" } });
    expect(loadShellSettings().themeChosen).toBeUndefined();
    saveShellSettings({ theme: "candle", rail: "auto", panes: {}, themeChosen: true });
    expect(loadShellSettings().themeChosen).toBe(true);
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "candle", themeChosen: "yes" }));
    expect(loadShellSettings().themeChosen).toBeUndefined();
  });
});
