import { describe, expect, it } from "vitest";

import { DEFAULT_WINDOW_SETTINGS, isWindowSettings, isWindowSettingsChange, windowSettingsOf } from "./windowSettings";

describe("the main window's settings the Lyre page shows (OUT-8: Sound to Discord, Website tabs)", () => {
  it("are the streaming mode and the three website-tab switches, nothing else of the main window's state", () => {
    const state = { streamingMode: "lowLatency", urlBarEnabled: false, externalInputsEnabled: true, multipleInputsEnabled: false, remoteEnabled: true, remoteAddress: "1.2.3.4", legacyTokenNotice: true };
    expect(windowSettingsOf(state)).toEqual({ streamingMode: "lowLatency", urlBarEnabled: false, externalInputsEnabled: true, multipleInputsEnabled: false });
    expect(windowSettingsOf({})).toEqual(DEFAULT_WINDOW_SETTINGS);
    expect(windowSettingsOf({ streamingMode: "loud", urlBarEnabled: "yes" })).toEqual(DEFAULT_WINDOW_SETTINGS);
  });

  it("the default is Kenku FM's: Lighter on the computer, the address bar shown, no inputs", () => {
    expect(DEFAULT_WINDOW_SETTINGS).toEqual({ streamingMode: "performance", urlBarEnabled: true, externalInputsEnabled: false, multipleInputsEnabled: false });
  });

  it("checks a whole state exactly", () => {
    expect(isWindowSettings(DEFAULT_WINDOW_SETTINGS)).toBe(true);
    expect(isWindowSettings({ ...DEFAULT_WINDOW_SETTINGS, extra: 1 })).toBe(false);
    expect(isWindowSettings({ ...DEFAULT_WINDOW_SETTINGS, streamingMode: "loud" })).toBe(false);
    expect(isWindowSettings(null)).toBe(false);
  });

  it("a change names only known settings, each of the right kind, and at least one", () => {
    expect(isWindowSettingsChange({ streamingMode: "lowLatency" })).toBe(true);
    expect(isWindowSettingsChange({ externalInputsEnabled: true, multipleInputsEnabled: false })).toBe(true);
    expect(isWindowSettingsChange({})).toBe(false);
    expect(isWindowSettingsChange({ remoteEnabled: true })).toBe(false);
    expect(isWindowSettingsChange({ urlBarEnabled: "true" })).toBe(false);
    expect(isWindowSettingsChange([])).toBe(false);
    expect(isWindowSettingsChange("streamingMode")).toBe(false);
  });
});
