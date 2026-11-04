import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { trustedContents } from "../security/trustedContents";
import { TAB_PARTITION } from "../security/partitions";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
} from "../security/testing/fakeIpc";

const { PLAYER_URL, PLAYER_PRELOAD } = vi.hoisted(() => {
  const entries = {
    PLAYER_URL: "file:///app/.webpack/renderer/player_window/index.html",
    PLAYER_PRELOAD: "/app/.webpack/renderer/player_window/preload.js",
  };
  Object.assign(globalThis, {
    PLAYER_WINDOW_WEBPACK_ENTRY: entries.PLAYER_URL,
    PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: entries.PLAYER_PRELOAD,
  });
  return entries;
});

type WindowOpenHandler = (details: { url: string }) => { action: string };

const created = vi.hoisted(
  () =>
    [] as {
      options: { webPreferences?: Record<string, unknown> };
      webContents: FakeWebContents;
    }[],
);

class FakeWebContents extends EventEmitter {
  static nextId = 100;
  id = FakeWebContents.nextId++;
  url = "";
  loadURL = vi.fn((url: string) => {
    this.url = url;
    return Promise.resolve();
  });
  getURL = () => this.url;
  setUserAgent = vi.fn();
  windowOpenHandler?: WindowOpenHandler;
  setWindowOpenHandler = (handler: WindowOpenHandler) => {
    this.windowOpenHandler = handler;
  };
  close = vi.fn();
  destroy = vi.fn();
  reload = vi.fn();
  navigationHistory = { goBack: vi.fn(), goForward: vi.fn() };
}

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  class WebContentsView {
    webContents = new FakeWebContents();
    constructor(public options: { webPreferences?: Record<string, unknown> }) {
      created.push({ options, webContents: this.webContents });
    }
    setBounds = vi.fn();
    getBounds = () => ({ x: 0, y: 0, width: 100, height: 100 });
  }
  return {
    ipcMain: fakeIpcMain,
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    WebContentsView,
  };
});

function fakeWindow() {
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    webContents: { send: vi.fn() },
  };
}

function setup() {
  const window = fakeWindow();
  const manager = new BrowserViewManagerMain(window as never);
  const mainWindow = fakePage("main-window");
  const create = (url: string, kind?: string) => {
    const before = created.length;
    const event = fakeIpcMain.deliver(
      "BROWSER_VIEW_CREATE_BROWSER_VIEW",
      fromMainFrame(mainWindow),
      url,
      0,
      0,
      100,
      100,
      ...(kind === undefined ? [] : [kind]),
    );
    const view = created.length > before ? created[created.length - 1] : undefined;
    return { event, view, id: event.returnValue as number };
  };
  /** Send a message on `channel` as the main window would. */
  const send = (channel: string, ...args: unknown[]) =>
    fakeIpcMain.deliver(channel, fromMainFrame(mainWindow), ...args);
  return { window, manager, mainWindow, create, send };
}

function sentErrors(window: ReturnType<typeof fakeWindow>) {
  return window.webContents.send.mock.calls.filter(([channel]) => channel === "ERROR");
}

beforeEach(() => {
  created.length = 0;
  fakeIpcMain.reset();
});

describe("BrowserViewManagerMain: tab URL policy (SEC-6)", () => {
  it("loads ordinary web pages", () => {
    const { create } = setup();
    const { view } = create("https://www.youtube.com/");
    expect(view.webContents.loadURL).toHaveBeenCalledWith("https://www.youtube.com/");
  });

  it.each(["file:///etc/passwd", "chrome://gpu", "javascript:alert(1)", "steam://run/1"])(
    "refuses to open a tab at %j and tells the user",
    (url) => {
      const { create, window } = setup();
      const { view } = create(url);
      expect(view.webContents.loadURL).not.toHaveBeenCalled();
      expect(sentErrors(window)).toHaveLength(1);
    },
  );

  it("refuses to load a disallowed address in an existing tab", () => {
    const { create, send, window } = setup();
    const { view, id } = create("https://example.com/");
    view.webContents.loadURL.mockClear();
    send("BROWSER_VIEW_LOAD_URL", id, "file:///C:/Windows/win.ini");
    expect(view.webContents.loadURL).not.toHaveBeenCalled();
    expect(sentErrors(window)).toHaveLength(1);
  });

  it("does nothing for an empty new tab", () => {
    const { create, window } = setup();
    const { view } = create("");
    expect(view.webContents.loadURL).not.toHaveBeenCalled();
    expect(sentErrors(window)).toHaveLength(0);
  });

  it("cancels in-page navigation to a disallowed address", () => {
    const { create } = setup();
    const { view } = create("https://example.com/");
    const event = { url: "file:///etc/passwd", isMainFrame: true, preventDefault: vi.fn() };
    view.webContents.emit("will-navigate", event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("cancels redirects to a disallowed address", () => {
    const { create } = setup();
    const { view } = create("https://example.com/");
    const event = { url: "ms-settings:", isMainFrame: true, preventDefault: vi.fn() };
    view.webContents.emit("will-redirect", event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("BrowserViewManagerMain: popups (SEC-6)", () => {
  function newTabRequests(window: ReturnType<typeof fakeWindow>, event: { reply: ReturnType<typeof vi.fn> }) {
    return [
      ...window.webContents.send.mock.calls,
      ...event.reply.mock.calls,
    ].filter(([channel]) => channel === "BROWSER_VIEW_NEW_TAB");
  }

  it("turns an allowed popup into a new tab and denies the window", () => {
    const { create, window } = setup();
    const { view, event } = create("https://example.com/");
    expect(view.webContents.windowOpenHandler?.({ url: "https://example.org/" })).toEqual({
      action: "deny",
    });
    expect(newTabRequests(window, event)).toEqual([
      ["BROWSER_VIEW_NEW_TAB", "https://example.org/"],
    ]);
  });

  it("ignores popups to disallowed addresses", () => {
    const { create, window } = setup();
    const { view, event } = create("https://example.com/");
    view.webContents.windowOpenHandler?.({ url: "file:///etc/passwd" });
    view.webContents.windowOpenHandler?.({ url: "javascript:alert(1)" });
    expect(newTabRequests(window, event)).toHaveLength(0);
  });

  it("limits a page to 3 popup tabs in 10 seconds", () => {
    const { create, window } = setup();
    const { view, event } = create("https://example.com/");
    for (let i = 0; i < 10; i++) {
      view.webContents.windowOpenHandler?.({ url: `https://example.org/${i}` });
    }
    expect(newTabRequests(window, event)).toHaveLength(3);
  });
});

describe("BrowserViewManagerMain: isolation (SEC-3)", () => {
  it("puts website tabs in their own storage partition without a preload", () => {
    const { create } = setup();
    const { view } = create("https://example.com/");
    expect(view.options.webPreferences?.partition).toBe(TAB_PARTITION);
    expect(view.options.webPreferences?.preload).toBeUndefined();
    expect(trustedContents.roleOf(view.webContents)).toBeNull();
  });

  it("registers the Kenku player view as trusted and keeps it in the app session", () => {
    const { create } = setup();
    const { view } = create(PLAYER_URL, "player");
    expect(view.options.webPreferences?.preload).toBe(PLAYER_PRELOAD);
    expect(view.options.webPreferences?.partition).toBeUndefined();
    expect(trustedContents.roleOf(view.webContents)).toBe("player-view");
  });

  it("refuses a preload script path from the renderer, even the player's own (SEC-8)", () => {
    const { create } = setup();
    expect(create("https://evil.example/", "/tmp/evil.js").id).toBe(-1);
    expect(create(PLAYER_URL, PLAYER_PRELOAD).id).toBe(-1);
    expect(created).toHaveLength(0);
  });
});

describe("BrowserViewManagerMain: player view lock (SEC-7)", () => {
  it("keeps the player view on its own page", () => {
    const { create } = setup();
    const { view } = create(PLAYER_URL, "player");
    const event = { url: "https://evil.example/", isMainFrame: true, preventDefault: vi.fn() };
    view.webContents.emit("will-navigate", event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("never opens a window from the player view", () => {
    const { create, window } = setup();
    const { view, event } = create(PLAYER_URL, "player");
    expect(view.webContents.windowOpenHandler?.({ url: "file:///etc/passwd" })).toEqual({
      action: "deny",
    });
    const requests = [...window.webContents.send.mock.calls, ...event.reply.mock.calls].filter(
      ([channel]) => channel === "BROWSER_VIEW_NEW_TAB",
    );
    expect(requests).toHaveLength(0);
  });
});

describe("BrowserViewManagerMain: who may control views (SEC-8)", () => {
  it("creates nothing for a website tab or an embedded frame", () => {
    setup();
    for (const event of [fromMainFrame(fakePage(null)), fromSubframe(fakePage("main-window"))]) {
      const reply = fakeIpcMain.deliver(
        "BROWSER_VIEW_CREATE_BROWSER_VIEW",
        event,
        "https://example.com/",
        0,
        0,
        100,
        100,
      );
      expect(reply.returnValue).toBe(-1);
    }
    expect(created).toHaveLength(0);
  });

  it("ignores navigation requests from the player view", () => {
    const { create } = setup();
    const { view, id } = create("https://example.com/");
    fakeIpcMain.deliver("BROWSER_VIEW_RELOAD", fromMainFrame(fakePage("player-view")), id);
    expect(view.webContents.reload).not.toHaveBeenCalled();
  });

  it("ignores a view request with bad bounds", () => {
    const { send } = setup();
    const event = send("BROWSER_VIEW_CREATE_BROWSER_VIEW", "https://example.com/", "0", 0, 100, 100);
    expect(event.returnValue).toBe(-1);
    expect(created).toHaveLength(0);
  });

  it.each([
    ["BROWSER_VIEW_REMOVE_BROWSER_VIEW", [999]],
    ["BROWSER_VIEW_HIDE_BROWSER_VIEW", [999]],
    ["BROWSER_VIEW_SHOW_BROWSER_VIEW", [999]],
    ["BROWSER_VIEW_SET_BROWSER_VIEW_BOUNDS", [999, 0, 0, 1, 1]],
    ["BROWSER_VIEW_LOAD_URL", [999, "https://example.com/"]],
    ["BROWSER_VIEW_GO_FORWARD", [999]],
    ["BROWSER_VIEW_GO_BACK", [999]],
    ["BROWSER_VIEW_RELOAD", [999]],
  ])("does not throw for %s with an unknown view id", (channel, args) => {
    const { send } = setup();
    expect(() => send(channel, ...args)).not.toThrow();
  });

  it("still drives a tab from the main window", () => {
    const { create, send } = setup();
    const { view, id } = create("https://example.com/");
    send("BROWSER_VIEW_RELOAD", id);
    send("BROWSER_VIEW_GO_BACK", id);
    expect(view.webContents.reload).toHaveBeenCalled();
    expect(view.webContents.navigationHistory.goBack).toHaveBeenCalled();
  });

  it("stops listening when destroyed", () => {
    const { manager } = setup();
    manager.destroy();
    expect(fakeIpcMain.eventNames()).toEqual([]);
  });
});

describe("BrowserViewManagerMain: legacy requests keep working (SEC-8)", () => {
  it("still opens a blank tab for a bookmark saved without an address", () => {
    const { send } = setup();
    const event = send("BROWSER_VIEW_CREATE_BROWSER_VIEW", undefined, 0, 0, 100, 100);
    expect(event.returnValue).toBeGreaterThan(0);
    expect(created).toHaveLength(1);
    expect(created[0].webContents.loadURL).not.toHaveBeenCalled();
  });
});
