import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAppInfoIpc } from "./appInfoIpc";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
} from "./testing/fakeIpc";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("./testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const app = {
  getVersion: () => "0.1.0",
  getPlatform: () => "linux",
  clearCache: vi.fn(async () => undefined),
};

beforeEach(() => {
  fakeIpcMain.reset();
  app.clearCache.mockClear();
});

describe("registerAppInfoIpc (SEC-8)", () => {
  it("answers the main window as before", async () => {
    registerAppInfoIpc(app);
    const main = fakePage("main-window");
    expect(fakeIpcMain.deliver("GET_VERSION", fromMainFrame(main)).returnValue).toBe("0.1.0");
    expect(fakeIpcMain.deliver("GET_PLATFORM", fromMainFrame(main)).returnValue).toBe("linux");
    await fakeIpcMain.invoke("CLEAR_CACHE", fromMainFrame(main));
    expect(app.clearCache).toHaveBeenCalledTimes(1);
  });

  it("refuses website tabs and embedded frames without leaving them waiting", async () => {
    registerAppInfoIpc(app);
    const tab = fromMainFrame(fakePage(null));
    expect(fakeIpcMain.deliver("GET_VERSION", tab).returnValue).toBe("");
    expect(fakeIpcMain.deliver("GET_PLATFORM", fromSubframe(fakePage("main-window"))).returnValue).toBe("");
    await expect(fakeIpcMain.invoke("CLEAR_CACHE", tab)).rejects.toThrow();
    expect(app.clearCache).not.toHaveBeenCalled();
  });

  it("can be removed again", () => {
    const dispose = registerAppInfoIpc(app);
    dispose();
    expect(fakeIpcMain.eventNames()).toEqual([]);
    expect(fakeIpcMain.handlers.size).toBe(0);
  });
});
