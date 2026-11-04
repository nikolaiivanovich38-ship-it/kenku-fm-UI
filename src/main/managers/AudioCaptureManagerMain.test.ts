import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "net";
import { AudioCaptureManagerMain } from "./AudioCaptureManagerMain";
import { trustedContents } from "../security/trustedContents";
import { captureTargets } from "../security/captureTargets";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
  type FakePage,
} from "../security/testing/fakeIpc";

vi.hoisted(() => {
  Object.assign(globalThis, {
    AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: "file:///app/audio_capture_window/index.html",
    AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: "/app/audio_capture_window/preload.js",
  });
});

const windowOptions = vi.hoisted(() => [] as Record<string, unknown>[]);
const pages = vi.hoisted(() => new Map<number, unknown>());

vi.mock("electron", async () => {
  const { EventEmitter } = await import("events");
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  class FakeWebContents extends EventEmitter {
    id = 42;
    mainFrame = { frameTreeNodeId: 420 };
    isDestroyed = () => false;
    loadURL = vi.fn().mockResolvedValue(undefined);
    getURL = () => "file:///app/audio_capture_window/index.html";
    send = vi.fn();
    close = vi.fn();
    destroy = vi.fn();
    setWindowOpenHandler = vi.fn();
  }
  class BrowserWindow {
    webContents = new FakeWebContents();
    constructor(options: Record<string, unknown>) {
      windowOptions.push(options);
    }
  }
  return {
    BrowserWindow,
    webContents: { fromId: (id: number) => pages.get(id) },
    ipcMain: fakeIpcMain,
  };
});

let manager: InstanceType<typeof AudioCaptureManagerMain> | undefined;
afterEach(() => {
  manager?.destroy();
  manager = undefined;
  captureTargets.revokeAll();
  fakeIpcMain.reset();
  pages.clear();
  windowOptions.length = 0;
});

/** The hidden capture window's page, as seen by IPC. */
function capturePage(m: AudioCaptureManagerMain) {
  return m._browserWindow.webContents as unknown as FakePage;
}

/** Messages the main process forwarded to the hidden capture window. */
function sentToCapture(m: AudioCaptureManagerMain) {
  return (capturePage(m).send as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

async function listening(m: InstanceType<typeof AudioCaptureManagerMain>) {
  if (!m._wss.address()) {
    await new Promise((resolve) => m._wss.once("listening", resolve));
  }
  return m._wss.address() as AddressInfo;
}

describe("AudioCaptureManagerMain audio socket (SEC-2)", () => {
  it("listens on the loopback interface only", async () => {
    manager = new AudioCaptureManagerMain();
    const address = await listening(manager);
    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
  });

  it("hands the capture window a loopback address it can connect to", async () => {
    manager = new AudioCaptureManagerMain();
    await listening(manager);
    const address = (await fakeIpcMain.invoke(
      "AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS",
      fromMainFrame(capturePage(manager)),
    )) as AddressInfo;
    expect(address.address).toBe("127.0.0.1");

    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.close();
  });

  it("registers the capture window as a trusted page", async () => {
    manager = new AudioCaptureManagerMain();
    expect(trustedContents.roleOf(manager._browserWindow.webContents)).toBe("audio-capture");
  });
});

describe("AudioCaptureManagerMain: who may send (SEC-8)", () => {
  it("forwards capture commands from the main window", () => {
    manager = new AudioCaptureManagerMain();
    const main = fakePage("main-window");
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_MUTED", fromMainFrame(main), 7, true);
    fakeIpcMain.deliver("AUDIO_CAPTURE_START", fromMainFrame(main), "performance");
    expect(sentToCapture(manager)).toEqual([
      ["AUDIO_CAPTURE_BROWSER_VIEW_MUTED", 7, true],
      ["AUDIO_CAPTURE_START", "performance"],
    ]);
  });

  it("ignores capture commands from a website tab, an embedded frame or the player", () => {
    manager = new AudioCaptureManagerMain();
    for (const event of [
      fromMainFrame(fakePage(null)),
      fromSubframe(fakePage("main-window")),
      fromMainFrame(fakePage("player-view")),
    ]) {
      fakeIpcMain.deliver("AUDIO_CAPTURE_SET_LOOPBACK", event, true);
      fakeIpcMain.deliver("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", event, "mic");
    }
    expect(sentToCapture(manager)).toEqual([]);
  });

  it("ignores capture commands with the wrong argument types", () => {
    manager = new AudioCaptureManagerMain();
    const main = fromMainFrame(fakePage("main-window"));
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_LOOPBACK", main, "true");
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_MUTED", main, "7", true);
    fakeIpcMain.deliver("AUDIO_CAPTURE_START", main, "fast");
    expect(sentToCapture(manager)).toEqual([]);
  });

  it("hands the socket address to the capture window only", async () => {
    manager = new AudioCaptureManagerMain();
    await expect(
      fakeIpcMain.invoke("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS", fromMainFrame(fakePage("main-window"))),
    ).rejects.toThrow();
    await expect(
      fakeIpcMain.invoke("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS", fromMainFrame(fakePage(null))),
    ).rejects.toThrow();
  });

  it("starts the Discord stream only when the capture window asks", () => {
    manager = new AudioCaptureManagerMain();
    const started = vi.fn();
    manager.on("streamStart", started);
    fakeIpcMain.deliver("AUDIO_CAPTURE_STREAM_START", fromMainFrame(fakePage("main-window")), 2, 960, 48000);
    fakeIpcMain.deliver("AUDIO_CAPTURE_STREAM_START", fromMainFrame(capturePage(manager)), "2", 960, 48000);
    expect(started).not.toHaveBeenCalled();
    fakeIpcMain.deliver("AUDIO_CAPTURE_STREAM_START", fromMainFrame(capturePage(manager)), 2, 960, 48000);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("stops listening when destroyed", () => {
    manager = new AudioCaptureManagerMain();
    manager.destroy();
    manager = undefined;
    expect(fakeIpcMain.eventNames()).toEqual([]);
    expect(fakeIpcMain.handlers.size).toBe(0);
  });
});

describe("AudioCaptureManagerMain: tab audio streams", () => {
  it("starts capturing a tab that exists", () => {
    manager = new AudioCaptureManagerMain();
    const tab = fakePage(null);
    pages.set(tab.id, tab);
    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", fromMainFrame(fakePage("main-window")), tab.id);
    expect(tab.getMediaSourceId).toHaveBeenCalledWith(capturePage(manager));
    expect(sentToCapture(manager)).toEqual([
      ["AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", tab.id, `media-source-${tab.id}`],
    ]);
  });

  it("lets the chosen tab's audio be captured, and only until it stops (SEC-3)", () => {
    manager = new AudioCaptureManagerMain();
    const tab = fakePage(null);
    const other = fakePage(null);
    pages.set(tab.id, tab);
    const main = fromMainFrame(fakePage("main-window"));
    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, tab.id);
    expect(captureTargets.has(tab)).toBe(true);
    expect(captureTargets.has(other)).toBe(false);
    fakeIpcMain.deliver("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", main, tab.id);
    expect(captureTargets.has(tab)).toBe(false);
  });

  it("captures only tabs and the player, never the main window or itself (WP1 review)", () => {
    manager = new AudioCaptureManagerMain();
    const mainPage = fakePage("main-window");
    pages.set(mainPage.id, mainPage);
    pages.set(capturePage(manager).id, capturePage(manager));
    const player = fakePage("player-view");
    pages.set(player.id, player);
    const main = fromMainFrame(mainPage);

    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, mainPage.id);
    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, capturePage(manager).id);
    expect(captureTargets.has(mainPage)).toBe(false);
    expect(captureTargets.has(capturePage(manager))).toBe(false);
    expect(sentToCapture(manager)).toEqual([]);

    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, player.id);
    expect(captureTargets.has(player)).toBe(true);
  });

  it("forgets every captured tab when all streams stop (SEC-3)", () => {
    manager = new AudioCaptureManagerMain();
    const tab = fakePage(null);
    pages.set(tab.id, tab);
    const main = fromMainFrame(fakePage("main-window"));
    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, tab.id);
    fakeIpcMain.deliver("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS", main);
    expect(captureTargets.has(tab)).toBe(false);
  });

  it("does not throw for an unknown or closed tab", () => {
    manager = new AudioCaptureManagerMain();
    const closed = fakePage(null);
    closed.destroyed = true;
    pages.set(closed.id, closed);
    const main = fromMainFrame(fakePage("main-window"));
    expect(() =>
      fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, 123456),
    ).not.toThrow();
    expect(() =>
      fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, closed.id),
    ).not.toThrow();
    expect(sentToCapture(manager)).toEqual([]);
  });

  it("stops every tab stream when the main window removes all views", () => {
    manager = new AudioCaptureManagerMain();
    fakeIpcMain.deliver(
      "AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS",
      fromMainFrame(fakePage("main-window")),
    );
    expect(sentToCapture(manager)).toEqual([["AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS"]]);
  });
});

describe("AudioCaptureManagerMain: capture window isolation (SEC-12)", () => {
  it("runs the capture window sandboxed with context isolation and no Node", () => {
    manager = new AudioCaptureManagerMain();
    const prefs = windowOptions[0].webPreferences as Record<string, unknown>;
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.preload).toBe("/app/audio_capture_window/preload.js");
    expect(windowOptions[0].show).toBe(false);
  });
});
