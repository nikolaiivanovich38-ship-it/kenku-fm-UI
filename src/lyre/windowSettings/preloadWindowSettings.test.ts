import { describe, expect, it, vi } from "vitest";

import { createLyreWindowSettingsBridge } from "./preloadWindowSettings";

const STATE = { streamingMode: "performance", urlBarEnabled: true, externalInputsEnabled: false, multipleInputsEnabled: false };

function fakeIpc(answers: Record<string, unknown> = {}) {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  return {
    invoke: vi.fn(async (channel: string) => answers[channel]),
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
    emit: (channel: string, ...args: unknown[]) => listeners.get(channel)?.({}, ...args),
    listeners,
  };
}

describe("the Lyre page's bridge to the main window's settings (OUT-8)", () => {
  it("gets the settings (null before the main window told them) and passes only well-formed ones", async () => {
    expect(await createLyreWindowSettingsBridge(fakeIpc({ LYRE_WINDOW_SETTINGS_GET: STATE })).get()).toEqual(STATE);
    expect(await createLyreWindowSettingsBridge(fakeIpc({ LYRE_WINDOW_SETTINGS_GET: null })).get()).toBeNull();
    expect(await createLyreWindowSettingsBridge(fakeIpc({ LYRE_WINDOW_SETTINGS_GET: { ...STATE, extra: "x" } })).get()).toBeNull();
  });

  it("sends a change and says whether the main window took it", async () => {
    const ipc = fakeIpc({ LYRE_WINDOW_SETTINGS_SET: true });
    expect(await createLyreWindowSettingsBridge(ipc).set({ streamingMode: "lowLatency" })).toBe(true);
    expect(ipc.invoke).toHaveBeenCalledWith("LYRE_WINDOW_SETTINGS_SET", { streamingMode: "lowLatency" });
    expect(await createLyreWindowSettingsBridge(fakeIpc({ LYRE_WINDOW_SETTINGS_SET: "yes" })).set({ urlBarEnabled: false })).toBe(false);
  });

  it("tells each well-formed new state, until it stops listening", () => {
    const ipc = fakeIpc();
    const bridge = createLyreWindowSettingsBridge(ipc);
    const heard = vi.fn();
    const stop = bridge.onChange(heard);
    ipc.emit("LYRE_WINDOW_SETTINGS_STATE", STATE);
    ipc.emit("LYRE_WINDOW_SETTINGS_STATE", { nonsense: true });
    expect(heard.mock.calls).toEqual([[STATE]]);
    stop();
    expect(ipc.listeners.has("LYRE_WINDOW_SETTINGS_STATE")).toBe(false);
  });

  it("lists and forgets Local files folders, keeping only text, and clears website data", async () => {
    const ipc = fakeIpc({ LYRE_LOCAL_FOLDERS_LIST: ["H:\\Audio\\Incoming", 42], LYRE_LOCAL_FOLDERS_FORGET: [] });
    const bridge = createLyreWindowSettingsBridge(ipc);
    expect(await bridge.localFolders()).toEqual(["H:\\Audio\\Incoming"]);
    expect(await bridge.forgetLocalFolder("H:\\Audio\\Incoming")).toEqual([]);
    expect(ipc.invoke).toHaveBeenCalledWith("LYRE_LOCAL_FOLDERS_FORGET", "H:\\Audio\\Incoming");
    await bridge.clearWebsiteData();
    expect(ipc.invoke).toHaveBeenCalledWith("LYRE_CLEAR_WEBSITE_DATA");
  });
});
