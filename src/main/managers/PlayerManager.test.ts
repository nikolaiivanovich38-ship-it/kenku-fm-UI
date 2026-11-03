import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerManager } from "./PlayerManager";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
  type FakePage,
} from "../security/testing/fakeIpc";

const { PLAYER_URL, PLAYER_PRELOAD } = vi.hoisted(() => {
  const entries = {
    PLAYER_URL: "file:///app/player_window/index.html",
    PLAYER_PRELOAD: "/app/player_window/preload.js",
  };
  Object.assign(globalThis, {
    PLAYER_WINDOW_WEBPACK_ENTRY: entries.PLAYER_URL,
    PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: entries.PLAYER_PRELOAD,
  });
  return entries;
});

const pages = vi.hoisted(() => new Map<number, unknown>());

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return {
    ipcMain: fakeIpcMain,
    webContents: { fromId: (id: number) => pages.get(id) },
    BrowserWindow: { getAllWindows: (): unknown[] => [] },
  };
});

let manager: PlayerManager | undefined;
let main: FakePage;

beforeEach(() => {
  fakeIpcMain.reset();
  pages.clear();
  main = fakePage("main-window");
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
});

/** A player view created by BrowserViewManagerMain and known to Electron. */
function playerView() {
  const view = fakePage("player-view");
  pages.set(view.id, view);
  return view;
}

describe("PlayerManager: main window requests (SEC-8)", () => {
  it("tells the main window where the player page is", () => {
    manager = new PlayerManager();
    expect(fakeIpcMain.deliver("PLAYER_GET_URL", fromMainFrame(main)).returnValue).toBe(PLAYER_URL);
    expect(fakeIpcMain.deliver("PLAYER_GET_PRELOAD_URL", fromMainFrame(main)).returnValue).toBe(
      PLAYER_PRELOAD,
    );
  });

  it("does not reveal app paths to a website tab or an embedded frame", () => {
    manager = new PlayerManager();
    const tab = fromMainFrame(fakePage(null));
    expect(fakeIpcMain.deliver("PLAYER_GET_URL", tab).returnValue).toBe("");
    expect(fakeIpcMain.deliver("PLAYER_GET_PRELOAD_URL", fromSubframe(main)).returnValue).toBe("");
  });

  it("registers the player view the main window created", () => {
    manager = new PlayerManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), view.id);
    expect(manager.getView()).toBe(view);
  });

  it("refuses to register a website tab, an unknown id or a bad id as the player", () => {
    manager = new PlayerManager();
    const tab = fakePage(null);
    pages.set(tab.id, tab);
    for (const id of [tab.id, 987654, "1", 1.5, -1]) {
      fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), id);
    }
    expect(manager.registeredViewId).toBeUndefined();
    expect(manager.getView()).toBeUndefined();
  });

  it("ignores registration from a website tab", () => {
    manager = new PlayerManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(fakePage(null)), view.id);
    expect(manager.getView()).toBeUndefined();
  });

  it("returns nothing once the player view has been closed", () => {
    manager = new PlayerManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), view.id);
    view.destroyed = true;
    expect(manager.getView()).toBeUndefined();
  });

  it("does not start the remote API for a website tab or with bad arguments", () => {
    manager = new PlayerManager();
    const start = vi.spyOn(manager, "startRemote").mockImplementation(() => undefined);
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(fakePage(null)), "0.0.0.0", "3333");
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(main), "0.0.0.0", 3333);
    expect(start).not.toHaveBeenCalled();
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(main), "127.0.0.1", "3333");
    expect(start).toHaveBeenCalledWith("127.0.0.1", "3333");
  });

  it("stops listening when destroyed", () => {
    manager = new PlayerManager();
    manager.destroy();
    manager = undefined;
    expect(fakeIpcMain.eventNames()).toEqual([]);
  });
});
