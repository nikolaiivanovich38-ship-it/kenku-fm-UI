import { describe, expect, it, vi } from "vitest";
import { moveRemoteOutOfSettings } from "./remoteMigration";

describe("moveRemoteOutOfSettings (review 0.5.0 CR-3)", () => {
  it("hands the old Remote choice to the main process once and removes it from the main window's settings", () => {
    const handOver = vi.fn();
    const state = { settings: { urlBarEnabled: true, remoteEnabled: true, remoteAddress: "192.168.1.20", remotePort: "4000" }, bookmarks: {} };
    const migrated = moveRemoteOutOfSettings(state, handOver);
    expect(handOver).toHaveBeenCalledWith({ enabled: true, address: "192.168.1.20", port: "4000" });
    expect(migrated).toEqual({ settings: { urlBarEnabled: true }, bookmarks: {} });
  });

  it("hands over an old setting that was off too, so the main process stops listening for one", () => {
    const handOver = vi.fn();
    const migrated = moveRemoteOutOfSettings({ settings: { remoteEnabled: false, remoteAddress: "127.0.0.1", remotePort: "3333" } }, handOver);
    expect(handOver).toHaveBeenCalledWith({ enabled: false, address: "127.0.0.1", port: "3333" });
    expect(migrated.settings).toEqual({});
  });

  it("hands over only well-formed values (an odd saved value counts as off, at 127.0.0.1, port 3333)", () => {
    const handOver = vi.fn();
    moveRemoteOutOfSettings({ settings: { remoteEnabled: "yes", remoteAddress: 7, remotePort: { x: 1 } } }, handOver);
    expect(handOver).toHaveBeenCalledWith({ enabled: false, address: "127.0.0.1", port: "3333" });
  });

  it("leaves a state without the old fields alone", () => {
    const handOver = vi.fn();
    const state = { settings: { urlBarEnabled: false } };
    expect(moveRemoteOutOfSettings(state, handOver)).toBe(state);
    expect(moveRemoteOutOfSettings(undefined, handOver)).toBeUndefined();
    expect(handOver).not.toHaveBeenCalled();
  });
});
