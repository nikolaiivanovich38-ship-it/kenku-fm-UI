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
  emptyAudioCache: vi.fn(async () => undefined),
};

beforeEach(() => {
  fakeIpcMain.reset();
  app.emptyAudioCache.mockClear();
});

describe("registerAppInfoIpc (SEC-8)", () => {
  it("FND-16: the old main window's version, platform and Clear cache are gone", async () => {
    registerAppInfoIpc(app);
    const main = fromMainFrame(fakePage("main-window"));
    expect(fakeIpcMain.deliver("GET_VERSION", main).returnValue).toBeUndefined();
    await expect(fakeIpcMain.invoke("CLEAR_CACHE", main)).rejects.toThrow();
  });

  // --- w6-rooms ---
  it("FND-16: lets the Lyre page's Settings empty the audio cache, and no other page; website data is not touched from there", async () => {
    registerAppInfoIpc(app);
    await fakeIpcMain.invoke("LYRE_EMPTY_AUDIO_CACHE", fromMainFrame(fakePage("lyre-view")));
    expect(app.emptyAudioCache).toHaveBeenCalledTimes(1);
    for (const event of [fromMainFrame(fakePage(null)), fromMainFrame(fakePage(null)), fromSubframe(fakePage("lyre-view")), fromMainFrame(fakePage("main-window"))]) {
      await expect(fakeIpcMain.invoke("LYRE_EMPTY_AUDIO_CACHE", event)).rejects.toThrow();
    }
    await expect(fakeIpcMain.invoke("LYRE_CLEAR_WEBSITE_DATA", fromMainFrame(fakePage("lyre-view")))).rejects.toThrow();
    expect(app.emptyAudioCache).toHaveBeenCalledTimes(1);
  });

  it("can be removed again", () => {
    const dispose = registerAppInfoIpc(app);
    dispose();
    expect(fakeIpcMain.eventNames()).toEqual([]);
    expect(fakeIpcMain.handlers.size).toBe(0);
  });
});
