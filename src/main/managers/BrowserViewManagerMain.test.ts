import { EventEmitter } from "events";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserViewManagerMain } from "./BrowserViewManagerMain";
import { trustedContents } from "../security/trustedContents";
import { LOCAL_FILE_PARTITION, TAB_PARTITION } from "../security/partitions";
import { LocalFileFolders, type LocalFilePrompt, type PromptAnswer } from "../security/localFiles";
import { LocalFileServer } from "../security/localFileServer";

/**
 * The files in these tests do not exist on the test machine: paths are taken
 * as written, and any path containing "missing" does not exist.
 */
const fakeRealpath = (value: string) => {
  if (value.includes("missing")) {
    throw new Error("ENOENT");
  }
  return value;
};
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
} from "../security/testing/fakeIpc";

const { PLAYER_URL, PLAYER_PRELOAD, LYRE_URL, LYRE_PRELOAD } = vi.hoisted(() => {
  const entries = {
    PLAYER_URL: "file:///app/.webpack/renderer/player_window/index.html",
    PLAYER_PRELOAD: "/app/.webpack/renderer/player_window/preload.js",
    LYRE_URL: "file:///app/.webpack/renderer/lyre_window/index.html",
    LYRE_PRELOAD: "/app/.webpack/renderer/lyre_window/preload.js",
  };
  Object.assign(globalThis, {
    PLAYER_WINDOW_WEBPACK_ENTRY: entries.PLAYER_URL,
    PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: entries.PLAYER_PRELOAD,
    LYRE_WINDOW_WEBPACK_ENTRY: entries.LYRE_URL,
    LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY: entries.LYRE_PRELOAD,
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
  destroyed = false;
  isDestroyed = () => this.destroyed;
  close = vi.fn();
  destroy = vi.fn();
  reload = vi.fn();
  navigationHistory = { goBack: vi.fn(), goForward: vi.fn() };
}

// SEC-15: the real folder list is saved with electron-store; tests pass their own.
vi.mock("../security/localFileStore", () => ({
  localFileFolders: () => {
    throw new Error("tests must pass a folder list");
  },
}));

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

function setup({
  answer = { response: 1, checkboxChecked: false },
  remembered = [] as string[],
}: { answer?: PromptAnswer; remembered?: string[] } = {}) {
  const window = fakeWindow();
  let saved = [...remembered];
  const localFiles = new LocalFileFolders(
    {
      get: () => saved,
      set: (folders) => {
        saved = folders;
      },
    },
    path.posix,
    fakeRealpath,
  );
  const askAboutFile = vi.fn(async (_prompt: LocalFilePrompt) => answer);
  const manager = new BrowserViewManagerMain(window as never, {
    localFiles,
    askAboutFile,
    realpath: fakeRealpath,
    fileServer: new LocalFileServer({
      pathApi: path.posix,
      fileSystem: { realpath: fakeRealpath, isFile: () => true },
      windowsPaths: false,
    }),
    fileExists: (filePath: string) => !filePath.includes("folder-only"),
  });
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
  /** Open a file the way the address bar does (SEC-15). */
  const openFile = async (url: string) => {
    const before = created.length;
    const event = fromMainFrame(mainWindow);
    const id = (await fakeIpcMain.invoke("BROWSER_VIEW_OPEN_LOCAL_FILE", event, url, 0, 0, 100, 100)) as number;
    const view = created.length > before ? created[created.length - 1] : undefined;
    return { id, view, event };
  };
  return { window, manager, mainWindow, create, send, openFile, askAboutFile, localFiles };
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

  it.each([
    ["a website tab", "https://www.youtube.com/", undefined],
    ["the player", PLAYER_URL, "player"],
  ] as const)("sets the user agent of %s before loading, so it loads once", (_, url, kind) => {
    const { create } = setup();
    const { view } = create(url, kind);
    const setAgent = view.webContents.setUserAgent.mock.invocationCallOrder[0];
    const load = view.webContents.loadURL.mock.invocationCallOrder[0];
    expect(load).toBeDefined();
    expect(setAgent).toBeLessThan(load);
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

describe("BrowserViewManagerMain: files from the user's computer (SEC-15)", () => {
  const file = "file:///home/gm/maps/index.html";

  it("asks first, then opens the file in its own partition with no preload", async () => {
    const { openFile, askAboutFile } = setup({ answer: { response: 0, checkboxChecked: false } });
    const { id, view } = await openFile(file);
    expect(askAboutFile).toHaveBeenCalledTimes(1);
    expect(askAboutFile.mock.calls[0][0].detail).toContain("/home/gm/maps/index.html");
    expect(id).toBe(view?.webContents.id);
    expect(view?.options.webPreferences).toEqual({ partition: LOCAL_FILE_PARTITION });
    expect(trustedContents.roleOf(view!.webContents)).toBeNull();
  });

  it("loads the file from its own scheme, never from file: (WP1 review 1 and 2)", async () => {
    const { openFile } = setup({ answer: { response: 0, checkboxChecked: false } });
    const { view } = await openFile(`${file}#room-3`);
    expect(view?.webContents.loadURL).toHaveBeenCalledWith(
      expect.stringMatching(/^cue-local-file:\/\/[0-9a-f]{32}\/index\.html#room-3$/),
    );
  });

  it.each(["file:///home/gm/maps/missing.html", "file:///home/gm/maps/folder-only"])(
    "says %s cannot be found and opens nothing, without asking (UX finding 7)",
    async (address) => {
      const { openFile, askAboutFile, window } = setup({ answer: { response: 0, checkboxChecked: false } });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { id, view } = await openFile(address);
      expect(id).toBe(-1);
      expect(view).toBeUndefined();
      expect(askAboutFile).not.toHaveBeenCalled();
      expect(sentErrors(window)).toEqual([
        ["ERROR", "Can't find this file. Check the name and folder.", { kind: "address" }],
      ]);
    },
  );

  it("opens nothing when the user says no", async () => {
    const { openFile } = setup({ answer: { response: 1, checkboxChecked: false } });
    const { id, view } = await openFile(file);
    expect(id).toBe(-1);
    expect(view).toBeUndefined();
  });

  it("does not ask about a file in a remembered folder", async () => {
    const { openFile, askAboutFile } = setup({ remembered: ["/home/gm/maps"] });
    const { id } = await openFile(file);
    expect(id).toBeGreaterThan(0);
    expect(askAboutFile).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/", "file://fileserver/share/x.html", "javascript:alert(1)"])(
    "refuses %j on the file channel without asking",
    async (url) => {
      const { openFile, askAboutFile } = setup({ answer: { response: 0, checkboxChecked: false } });
      expect((await openFile(url)).id).toBe(-1);
      expect(askAboutFile).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    },
  );

  it("refuses the file channel to anything but the main window", async () => {
    const { askAboutFile } = setup({ answer: { response: 0, checkboxChecked: false } });
    for (const event of [fromMainFrame(fakePage(null)), fromMainFrame(fakePage("player-view"))]) {
      await expect(
        fakeIpcMain.invoke("BROWSER_VIEW_OPEN_LOCAL_FILE", event, file, 0, 0, 100, 100),
      ).rejects.toThrow();
    }
    expect(askAboutFile).not.toHaveBeenCalled();
  });

  it("never loads another address in a file's tab", async () => {
    const { openFile, send } = setup({ answer: { response: 0, checkboxChecked: false } });
    const { id, view } = await openFile(file);
    view!.webContents.loadURL.mockClear();
    send("BROWSER_VIEW_LOAD_URL", id, "https://example.com/");
    send("BROWSER_VIEW_LOAD_URL", id, "file:///etc/passwd");
    expect(view!.webContents.loadURL).not.toHaveBeenCalled();
  });

  it("sends a link to a web page from a file to a new website tab", async () => {
    const { openFile, mainWindow } = setup({ answer: { response: 0, checkboxChecked: false } });
    const { view } = await openFile(file);
    const event = { url: "https://example.com/", isMainFrame: true, preventDefault: vi.fn() };
    view!.webContents.emit("will-navigate", event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mainWindow.send).toHaveBeenCalledWith("BROWSER_VIEW_NEW_TAB", "https://example.com/");
  });

  it("tells the main window about the file tab's title and address", async () => {
    const { openFile, mainWindow } = setup({ answer: { response: 0, checkboxChecked: false } });
    const { id, view } = await openFile(file);
    const loaded = view!.webContents.loadURL.mock.calls[0][0];
    view!.webContents.emit("did-start-navigation", {}, `${loaded}#legend`, true, true);
    view!.webContents.emit("page-title-updated", {}, "Maps");
    // The address bar shows the file's own address, which bookmarks keep.
    expect(mainWindow.send).toHaveBeenCalledWith("BROWSER_VIEW_DID_NAVIGATE", id, `${file}#legend`);
    expect(mainWindow.send).toHaveBeenCalledWith("BROWSER_VIEW_TITLE_UPDATED", id, "Maps");
  });

  it("does not pass a file's own icons to the main window", async () => {
    const { openFile, mainWindow } = setup({ answer: { response: 0, checkboxChecked: false } });
    const { view } = await openFile(file);
    const loaded = view!.webContents.loadURL.mock.calls[0][0];
    view!.webContents.emit("page-favicon-updated", {}, [new URL("icon.png", loaded).href, "file:///etc/x.png"]);
    expect(mainWindow.send).not.toHaveBeenCalledWith("BROWSER_VIEW_FAVICON_UPDATED", expect.anything(), expect.anything());
  });

  it("lists and forgets remembered folders for Settings", async () => {
    const { mainWindow } = setup({ remembered: ["/home/gm/maps", "/home/gm/music"] });
    const event = fromMainFrame(mainWindow);
    await expect(fakeIpcMain.invoke("LOCAL_FILES_LIST_FOLDERS", event)).resolves.toEqual([
      "/home/gm/maps",
      "/home/gm/music",
    ]);
    await expect(fakeIpcMain.invoke("LOCAL_FILES_FORGET_FOLDER", event, "/home/gm/maps")).resolves.toEqual([
      "/home/gm/music",
    ]);
  });
});

// --- w3-shell ---
describe("BrowserViewManagerMain: the new interface page, Lyre (WP5)", () => {
  it("opens the Lyre page with its own preload in the app session, registered as trusted", () => {
    const { create } = setup();
    const { view, id } = create(LYRE_URL, "lyre");
    expect(id).toBe(view.webContents.id);
    expect(view.options.webPreferences?.preload).toBe(LYRE_PRELOAD);
    expect(view.options.webPreferences?.partition).toBeUndefined();
    expect(trustedContents.roleOf(view.webContents)).toBe("lyre-view");
    expect(view.webContents.loadURL).toHaveBeenCalledWith(LYRE_URL);
  });

  it("tells its owner about the Lyre page once it is created and trusted (the audio host's hook)", () => {
    const onLyreView = vi.fn();
    const manager = new BrowserViewManagerMain(fakeWindow() as never, {
      localFiles: new LocalFileFolders({ get: () => [], set: () => undefined }, path.posix, fakeRealpath),
      onLyreView,
    });
    const main = fakePage("main-window");
    fakeIpcMain.deliver("BROWSER_VIEW_CREATE_BROWSER_VIEW", fromMainFrame(main), PLAYER_URL, 0, 0, 100, 100, "player");
    expect(onLyreView).not.toHaveBeenCalled();
    fakeIpcMain.deliver("BROWSER_VIEW_CREATE_BROWSER_VIEW", fromMainFrame(main), LYRE_URL, 0, 0, 100, 100, "lyre");
    const lyre = created[created.length - 1].webContents;
    expect(onLyreView).toHaveBeenCalledWith(lyre);
    expect(trustedContents.roleOf(lyre)).toBe("lyre-view");
    manager.destroy();
  });

  it("refuses the lyre kind for any other page, and the Lyre preload as a kind", () => {
    const { create } = setup();
    expect(create("https://evil.example/", "lyre").id).toBe(-1);
    expect(create(PLAYER_URL, "lyre").id).toBe(-1);
    expect(create(LYRE_URL, LYRE_PRELOAD).id).toBe(-1);
    expect(created).toHaveLength(0);
  });

  it("keeps the Lyre page on its own document, allowing only #route changes", () => {
    const { create } = setup();
    const { view } = create(LYRE_URL, "lyre");
    const away = { url: "https://evil.example/", isMainFrame: true, preventDefault: vi.fn() };
    view.webContents.emit("will-navigate", away);
    expect(away.preventDefault).toHaveBeenCalled();
    const route = { url: `${LYRE_URL}#/library`, isMainFrame: true, preventDefault: vi.fn() };
    view.webContents.emit("will-navigate", route);
    expect(route.preventDefault).not.toHaveBeenCalled();
  });

  it("never opens a window from the Lyre page; an allowed web link becomes an ordinary tab", () => {
    const { create, window } = setup();
    const { view, event } = create(LYRE_URL, "lyre");
    expect(view.webContents.windowOpenHandler?.({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(view.webContents.windowOpenHandler?.({ url: "https://example.com/help" })).toEqual({ action: "deny" });
    const requests = [...window.webContents.send.mock.calls, ...event.reply.mock.calls].filter(
      ([channel]) => channel === "BROWSER_VIEW_NEW_TAB",
    );
    expect(requests).toEqual([["BROWSER_VIEW_NEW_TAB", "https://example.com/help"]]);
  });

  it("removes a view whose page has already closed without touching the closed page (quitting no longer hangs)", () => {
    const { create, send, window } = setup();
    const { view, id } = create(LYRE_URL, "lyre");
    view.webContents.destroyed = true;
    expect(() => send("BROWSER_VIEW_REMOVE_BROWSER_VIEW", id)).not.toThrow();
    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(view.webContents.destroy).not.toHaveBeenCalled();
    expect(window.contentView.removeChildView).toHaveBeenCalled();
    view.webContents.close.mockClear();
    const other = create(PLAYER_URL, "player");
    other.view.webContents.destroyed = true;
    expect(() => send("BROWSER_VIEW_REMOVE_ALL_BROWSER_VIEWS")).not.toThrow();
    expect(other.view.webContents.close).not.toHaveBeenCalled();
  });

  it("never loads another address in the Lyre page", () => {
    const { create, send } = setup();
    const { view, id } = create(LYRE_URL, "lyre");
    view.webContents.loadURL.mockClear();
    send("BROWSER_VIEW_LOAD_URL", id, "https://example.com/");
    expect(view.webContents.loadURL).not.toHaveBeenCalled();
  });

  it("never offers the Lyre page for tab capture: its sound reaches Discord only through the private channel", () => {
    const { create, window } = setup();
    const { view, event } = create(LYRE_URL, "lyre");
    view.webContents.emit("did-finish-load");
    const player = create(PLAYER_URL, "player");
    player.view.webContents.emit("did-finish-load");
    const loaded = [...window.webContents.send.mock.calls, ...event.reply.mock.calls, ...player.event.reply.mock.calls].filter(
      ([channel]) => channel === "BROWSER_VIEW_LOADED",
    );
    expect(loaded).toEqual([["BROWSER_VIEW_LOADED", player.id]]);
  });
});
