import { beforeEach, describe, expect, it } from "vitest";
import { loadShellSettings, saveShellSettings, SHELL_SETTINGS_KEY } from "./settings";

beforeEach(() => localStorage.clear());

describe("remembered shell settings", () => {
  it("starts with each campaign's own theme, a rail that fits the window and no remembered boxes", () => {
    expect(loadShellSettings()).toEqual({ theme: "campaign", rail: "auto", panes: {} });
  });

  it("remembers the theme, the rail and which boxes are open or closed", () => {
    saveShellSettings({ theme: "parchment", rail: "min", panes: { scenes: "c" } });
    expect(loadShellSettings()).toEqual({ theme: "parchment", rail: "min", panes: { scenes: "c" } });
  });

  it("ignores damaged or unknown values instead of failing", () => {
    localStorage.setItem(SHELL_SETTINGS_KEY, "{not json");
    expect(loadShellSettings().theme).toBe("campaign");
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "neon", rail: "wide", panes: { a: "x", b: "o" } }));
    expect(loadShellSettings()).toEqual({ theme: "campaign", rail: "auto", panes: { b: "o" } });
  });

  it("FND-8: remembers that the first-run tour was seen, and nothing else counts as seen", () => {
    saveShellSettings({ theme: "campaign", rail: "auto", panes: {}, tour: "done" });
    expect(loadShellSettings().tour).toBe("done");
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ tour: "yes" }));
    expect(loadShellSettings().tour).toBeUndefined();
  });
});
