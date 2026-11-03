import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowManager } from "./WindowManager";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
} from "../security/testing/fakeIpc";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

function fakeWindow() {
  return {
    isMaximized: vi.fn(() => false),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
  };
}

beforeEach(() => {
  fakeIpcMain.reset();
});

describe("WindowManager: who may send (SEC-8)", () => {
  it("minimises, maximises and closes for the main window", () => {
    const window = fakeWindow();
    const manager = new WindowManager(window as never);
    const main = fromMainFrame(fakePage("main-window"));
    fakeIpcMain.deliver("WINDOW_MINIMIZE", main);
    fakeIpcMain.deliver("WINDOW_TOGGLE_MAXIMIZE", main);
    fakeIpcMain.deliver("WINDOW_CLOSE", main);
    expect(window.minimize).toHaveBeenCalled();
    expect(window.maximize).toHaveBeenCalled();
    expect(window.close).toHaveBeenCalled();
    manager.destroy();
  });

  it("ignores a website tab, the player view and embedded frames", () => {
    const window = fakeWindow();
    const manager = new WindowManager(window as never);
    for (const event of [
      fromMainFrame(fakePage(null)),
      fromMainFrame(fakePage("player-view")),
      fromSubframe(fakePage("main-window")),
    ]) {
      fakeIpcMain.deliver("WINDOW_CLOSE", event);
    }
    expect(window.close).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("stops listening when destroyed", () => {
    const manager = new WindowManager(fakeWindow() as never);
    manager.destroy();
    expect(fakeIpcMain.eventNames()).toEqual([]);
  });
});
