import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeIpcMain, fakePage, fromMainFrame, fromSubframe } from "../security/testing/fakeIpc";
import { TITLE_BAR_HEIGHT, WindowFrame, isTitleBarColours, windowFrameOptions } from "./windowFrame";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

function fakeWindow() {
  let maximised = false;
  return {
    isDestroyed: () => false,
    isMaximized: () => maximised,
    maximize: vi.fn(() => (maximised = true)),
    unmaximize: vi.fn(() => (maximised = false)),
    setTitleBarOverlay: vi.fn(),
  };
}

let frame: WindowFrame | undefined;
beforeEach(() => fakeIpcMain.reset());
afterEach(() => {
  frame?.destroy();
  frame = undefined;
});

describe("the window's frame (FND-16 step 2: Lyre is the whole window)", () => {
  it("draws Windows' own buttons over Lyre's top strip, 36 px tall, on Windows and Linux; macOS keeps its own", () => {
    expect(windowFrameOptions("win32")).toEqual({ titleBarStyle: "hidden", titleBarOverlay: { color: expect.any(String), symbolColor: expect.any(String), height: TITLE_BAR_HEIGHT } });
    expect(windowFrameOptions("linux").titleBarOverlay).toMatchObject({ height: 36 });
    expect(windowFrameOptions("darwin")).toEqual({});
  });

  it("takes the buttons' colours from the Lyre page (what is under them), as #rrggbb only", () => {
    const window = fakeWindow();
    frame = new WindowFrame(window);
    const lyre = fakePage("lyre-view");
    fakeIpcMain.deliver("LYRE_TITLE_BAR", fromMainFrame(lyre), { color: "#1c1f2b", symbolColor: "#e8e6df" });
    expect(window.setTitleBarOverlay).toHaveBeenCalledWith({ color: "#1c1f2b", symbolColor: "#e8e6df", height: 36 });
    for (const colours of [{ color: "red", symbolColor: "#fff" }, { color: "#1c1f2b" }, { color: "#1c1f2b", symbolColor: "#e8e6df", height: 99 }, "x"]) {
      fakeIpcMain.deliver("LYRE_TITLE_BAR", fromMainFrame(lyre), colours);
    }
    fakeIpcMain.deliver("LYRE_TITLE_BAR", fromMainFrame(fakePage(null)), { color: "#000000", symbolColor: "#ffffff" });
    fakeIpcMain.deliver("LYRE_TITLE_BAR", fromSubframe(lyre), { color: "#000000", symbolColor: "#ffffff" });
    expect(window.setTitleBarOverlay).toHaveBeenCalledTimes(1);
  });

  it("maximises the window and puts it back when the page asks (a double-click on the strip that reached the page)", () => {
    const window = fakeWindow();
    frame = new WindowFrame(window);
    const lyre = fakePage("lyre-view");
    fakeIpcMain.deliver("LYRE_WINDOW_MAXIMISE", fromMainFrame(lyre));
    expect(window.maximize).toHaveBeenCalledTimes(1);
    fakeIpcMain.deliver("LYRE_WINDOW_MAXIMISE", fromMainFrame(lyre));
    expect(window.unmaximize).toHaveBeenCalledTimes(1);
    fakeIpcMain.deliver("LYRE_WINDOW_MAXIMISE", fromMainFrame(lyre), "extra");
    fakeIpcMain.deliver("LYRE_WINDOW_MAXIMISE", fromMainFrame(fakePage(null)));
    expect(window.maximize).toHaveBeenCalledTimes(1);
  });

  it("stops listening when destroyed", () => {
    frame = new WindowFrame(fakeWindow());
    frame.destroy();
    frame = undefined;
    expect(fakeIpcMain.listenerCount("LYRE_TITLE_BAR")).toBe(0);
    expect(fakeIpcMain.listenerCount("LYRE_WINDOW_MAXIMISE")).toBe(0);
  });

  it("checks colours exactly", () => {
    expect(isTitleBarColours({ color: "#AABBCC", symbolColor: "#000000" })).toBe(true);
    expect(isTitleBarColours({ color: "#abc", symbolColor: "#000000" })).toBe(false);
    expect(isTitleBarColours(null)).toBe(false);
  });
});
