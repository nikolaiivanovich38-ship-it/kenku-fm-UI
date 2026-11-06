import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyreManager } from "./LyreManager";
import { fakeIpcMain, fakePage, fromMainFrame, fromSubframe } from "../security/testing/fakeIpc";
import { UpdateStatus } from "../updateStatus";

const { LYRE_URL } = vi.hoisted(() => {
  const entries = { LYRE_URL: "file:///app/.webpack/renderer/lyre_window/index.html" };
  Object.assign(globalThis, { LYRE_WINDOW_WEBPACK_ENTRY: entries.LYRE_URL });
  return entries;
});

const allContents = vi.hoisted(() => [] as unknown[]);

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return {
    ipcMain: fakeIpcMain,
    webContents: { getAllWebContents: () => allContents },
  };
});

let manager: LyreManager | undefined;

beforeEach(() => {
  fakeIpcMain.reset();
  allContents.length = 0;
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
});

describe("LyreManager: where the new interface page is (WP5, SEC-8)", () => {
  it("tells the main window the Lyre page's address", () => {
    manager = new LyreManager();
    const main = fakePage("main-window");
    expect(fakeIpcMain.deliver("LYRE_GET_URL", fromMainFrame(main)).returnValue).toBe(LYRE_URL);
  });

  it("does not reveal app paths to a website tab, the player or an embedded frame", () => {
    manager = new LyreManager();
    for (const event of [
      fromMainFrame(fakePage(null)),
      fromMainFrame(fakePage("player-view")),
      fromSubframe(fakePage("main-window")),
    ]) {
      expect(fakeIpcMain.deliver("LYRE_GET_URL", event).returnValue).toBe("");
    }
  });

  it("stops answering once destroyed", () => {
    manager = new LyreManager();
    manager.destroy();
    manager = undefined;
    expect(fakeIpcMain.listenerCount("LYRE_GET_URL")).toBe(0);
  });
});

describe("LyreManager.getView: the page other managers talk to", () => {
  it("finds the live page registered as the Lyre page and nothing else", () => {
    manager = new LyreManager();
    const tab = fakePage(null);
    const player = fakePage("player-view");
    const lyre = fakePage("lyre-view");
    allContents.push(tab, player, lyre);
    expect(manager.getView()).toBe(lyre);
    lyre.destroy();
    expect(manager.getView()).toBeUndefined();
  });
});

describe("LyreManager.attachView: the audio host's hook (wave 3)", () => {
  it("passes the Lyre page to whoever wires the audio channel to it, and only the Lyre page", () => {
    manager = new LyreManager();
    const onAttachView = vi.fn();
    manager.onAttachView = onAttachView;
    const tab = fakePage(null);
    manager.attachView(tab as never);
    expect(onAttachView).not.toHaveBeenCalled();
    const lyre = fakePage("lyre-view");
    manager.attachView(lyre as never);
    expect(onAttachView).toHaveBeenCalledWith(lyre);
  });
});

// --- w6-found ---
describe("LyreManager: automatic updates for the Lyre page's Settings (SEC-14)", () => {
  it("answers the update state to the Lyre page only", async () => {
    const status = new UpdateStatus(() => 7);
    status.failed(new Error("net::ERR_INTERNET_DISCONNECTED"));
    manager = new LyreManager({ updates: status });
    const lyre = fakePage("lyre-view");
    expect(await fakeIpcMain.invoke("UPDATE_GET", fromMainFrame(lyre))).toEqual(status.state());
    for (const event of [fromMainFrame(fakePage(null)), fromMainFrame(fakePage("player-view")), fromSubframe(lyre)]) {
      await expect(fakeIpcMain.invoke("UPDATE_GET", event)).rejects.toThrow();
    }
    await expect(fakeIpcMain.invoke("UPDATE_GET", fromMainFrame(lyre), "extra")).rejects.toThrow();
  });

  it("tells the Lyre page each change, and stops when destroyed", () => {
    const status = new UpdateStatus();
    manager = new LyreManager({ updates: status });
    const lyre = fakePage("lyre-view");
    const tab = fakePage(null);
    allContents.push(lyre, tab);
    status.checking();
    expect(lyre.send).toHaveBeenCalledWith("UPDATE_STATE", { kind: "checking" });
    expect(tab.send).not.toHaveBeenCalled();
    manager.destroy();
    manager = undefined;
    status.upToDate();
    expect(lyre.send).toHaveBeenCalledTimes(1);
  });
});
