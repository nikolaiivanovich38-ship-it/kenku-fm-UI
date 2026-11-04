import { describe, expect, it, vi } from "vitest";
import { moveTokenOutOfSettings } from "./tokenMigration";

describe("moveTokenOutOfSettings (SEC-5)", () => {
  it("hands the saved token over once and removes it from the settings", () => {
    const handOver = vi.fn();
    const state = { settings: { discordToken: " fake-token ", remotePort: "3333" }, bookmarks: {} };
    const migrated = moveTokenOutOfSettings(state, handOver);
    expect(handOver).toHaveBeenCalledWith("fake-token");
    expect(migrated).toEqual({ settings: { remotePort: "3333" }, bookmarks: {} });
    expect(JSON.stringify(migrated)).not.toContain("fake-token");
  });

  it("removes an empty token without handing anything over", () => {
    const handOver = vi.fn();
    const migrated = moveTokenOutOfSettings({ settings: { discordToken: "" } }, handOver);
    expect(handOver).not.toHaveBeenCalled();
    expect(migrated.settings).toEqual({});
  });

  it("drops the old Multiple Outputs switch (OUT-1)", () => {
    const migrated = moveTokenOutOfSettings({ settings: { multipleOutputsEnabled: true, remotePort: "1" } }, vi.fn());
    expect(migrated).toEqual({ settings: { remotePort: "1" } });
  });

  it("leaves settings without a token alone", () => {
    const handOver = vi.fn();
    const state = { settings: { remotePort: "3333" } };
    expect(moveTokenOutOfSettings(state, handOver)).toBe(state);
    expect(moveTokenOutOfSettings({}, handOver)).toEqual({});
    expect(handOver).not.toHaveBeenCalled();
  });
});
