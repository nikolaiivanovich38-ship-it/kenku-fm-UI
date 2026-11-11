import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeIpcMain, fakePage, fromMainFrame, fromSubframe } from "../security/testing/fakeIpc";
import { WindowSettingsBridge } from "./windowSettingsBridge";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const STATE = { streamingMode: "performance", urlBarEnabled: true, externalInputsEnabled: false, multipleInputsEnabled: false };

let bridge: WindowSettingsBridge | undefined;
let main: ReturnType<typeof fakePage>;
let lyre: ReturnType<typeof fakePage>;

beforeEach(() => {
  fakeIpcMain.reset();
  main = fakePage("main-window");
  lyre = fakePage("lyre-view");
});

afterEach(() => {
  bridge?.destroy();
  bridge = undefined;
});

const make = (lyreView: () => unknown = () => lyre) => (bridge = new WindowSettingsBridge({ mainWindow: () => main as never, lyreView: lyreView as never }));

describe("WindowSettingsBridge: the main window's settings in Settings in Lyre (OUT-8)", () => {
  it("answers null until the main window has told its settings, then the latest", async () => {
    make();
    expect(await fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_GET", fromMainFrame(lyre))).toBeNull();
    fakeIpcMain.deliver("WINDOW_SETTINGS_STATE", fromMainFrame(main), STATE);
    expect(await fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_GET", fromMainFrame(lyre))).toEqual(STATE);
  });

  it("passes each new state on to the Lyre page", () => {
    make();
    fakeIpcMain.deliver("WINDOW_SETTINGS_STATE", fromMainFrame(main), { ...STATE, streamingMode: "lowLatency" });
    expect(lyre.send).toHaveBeenCalledWith("LYRE_WINDOW_SETTINGS_STATE", { ...STATE, streamingMode: "lowLatency" });
  });

  it("passes a change from the Lyre page to the main window, which keeps the settings", async () => {
    make();
    expect(await fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_SET", fromMainFrame(lyre), { externalInputsEnabled: true })).toBe(true);
    expect(main.send).toHaveBeenCalledWith("WINDOW_SETTINGS_SET", { externalInputsEnabled: true });
  });

  it("takes the state only from the main window, and get and set only from the Lyre page", async () => {
    make();
    for (const sender of [fromMainFrame(lyre), fromMainFrame(fakePage(null)), fromMainFrame(fakePage("player-view")), fromSubframe(main)]) {
      fakeIpcMain.deliver("WINDOW_SETTINGS_STATE", sender, STATE);
    }
    expect(await fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_GET", fromMainFrame(lyre))).toBeNull();
    for (const sender of [fromMainFrame(main), fromMainFrame(fakePage(null)), fromMainFrame(fakePage("player-view")), fromSubframe(lyre)]) {
      await expect(fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_GET", sender)).rejects.toThrow();
      await expect(fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_SET", sender, { urlBarEnabled: false })).rejects.toThrow();
    }
    expect(main.send).not.toHaveBeenCalled();
  });

  it("refuses odd values at the boundary: unknown settings, wrong kinds, extra arguments", async () => {
    make();
    fakeIpcMain.deliver("WINDOW_SETTINGS_STATE", fromMainFrame(main), { ...STATE, remoteAddress: "0.0.0.0" });
    fakeIpcMain.deliver("WINDOW_SETTINGS_STATE", fromMainFrame(main), { ...STATE, streamingMode: "loud" });
    expect(await fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_GET", fromMainFrame(lyre))).toBeNull();
    for (const args of [[{ remoteEnabled: true }], [{ urlBarEnabled: "no" }], [{}], [{ urlBarEnabled: false }, "extra"]]) {
      await expect(fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_SET", fromMainFrame(lyre), ...args)).rejects.toThrow();
    }
  });

  it("answers false when there is no main window to take a change", async () => {
    bridge = new WindowSettingsBridge({ mainWindow: () => undefined, lyreView: () => lyre as never });
    expect(await fakeIpcMain.invoke("LYRE_WINDOW_SETTINGS_SET", fromMainFrame(lyre), { urlBarEnabled: false })).toBe(false);
  });

  it("removes its listeners when destroyed", () => {
    make();
    bridge!.destroy();
    bridge = undefined;
    expect(fakeIpcMain.handlers.has("LYRE_WINDOW_SETTINGS_GET")).toBe(false);
    expect(fakeIpcMain.listenerCount("WINDOW_SETTINGS_STATE")).toBe(0);
  });
});
