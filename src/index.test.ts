import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import { app as electronApp } from "electron";
import "./index";
import { trustedContents } from "./main/security/trustedContents";

const state = vi.hoisted(() => {
  Object.assign(globalThis, {
    LYRE_WINDOW_WEBPACK_ENTRY: "file:///app/lyre_window/index.html",
    LYRE_WINDOW_PRELOAD_WEBPACK_ENTRY: "/app/lyre_window/preload.js",
  });
  return {
    windows: [] as unknown[],
    ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    openExternal: undefined as unknown as Mock,
    secureSessions: undefined as unknown as Mock,
    clearBrowsingData: undefined as unknown as Mock,
    startupCalls: [] as string[],
    showMessageBoxSync: undefined as unknown as Mock,
  };
});

// FND-1: the migration module moves the data folder on import; here it only
// records when the carry-over runs.
vi.mock("./main/migration", () => ({
  runDataCarryOver: vi.fn(() => {
    state.startupCalls.push("carry-over");
    return { status: "copied", errors: [] as unknown[] };
  }),
  getDataCarryOverResult: () => ({ status: "copied", errors: [] as unknown[] }),
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("events");
  type Handler = (details: { url: string }) => { action: string };
  class FakeWebContents extends EventEmitter {
    id = 1;
    windowOpenHandler?: Handler;
    getURL = () => "file:///app/lyre_window/index.html";
    setWindowOpenHandler = (h: Handler) => {
      this.windowOpenHandler = h;
    };
    setUserAgent = vi.fn();
    send = vi.fn();
  }
  class BrowserWindow extends EventEmitter {
    static getAllWindows = () => state.windows;
    webContents = new FakeWebContents();
    loadURL = vi.fn();
    maximize = vi.fn();
    constructor(public options: Record<string, unknown>) {
      super();
      state.windows.push(this);
    }
  }
  state.openExternal = vi.fn().mockResolvedValue(undefined);
  const session = {
    defaultSession: {
      webRequest: { onBeforeSendHeaders: vi.fn() },
      clearCache: vi.fn(),
      clearStorageData: vi.fn(),
    },
  };
  state.showMessageBoxSync = vi.fn();
  return {
    app: {
      requestSingleInstanceLock: () => {
        state.startupCalls.push("single-instance-lock");
        return true;
      },
      whenReady: () => Promise.resolve(),
      on: vi.fn(),
      quit: vi.fn(),
      isPackaged: false,
      getVersion: () => "0.0.0",
    },
    BrowserWindow,
    dialog: { showMessageBoxSync: state.showMessageBoxSync },
    session,
    shell: { openExternal: state.openExternal },
    ipcMain: {
      on: vi.fn(),
      handle: (channel: string, h: (...args: unknown[]) => unknown) =>
        state.ipcHandlers.set(channel, h),
    },
    powerSaveBlocker: { start: () => 1, stop: vi.fn() },
  };
});
vi.mock("electron-squirrel-startup", () => ({ default: false }));
vi.mock("./menu", () => ({}));
const appInfo = vi.hoisted(() => ({
  registered: undefined as undefined | import("./main/security/appInfoIpc").AppInfo,
}));
vi.mock("./main/security/appInfoIpc", () => ({
  registerAppInfoIpc: (info: import("./main/security/appInfoIpc").AppInfo) => {
    appInfo.registered = info;
    return (): void => undefined;
  },
}));
vi.mock("./assets/icon.png", () => ({ default: "icon.png" }));
vi.mock("./bounds", () => ({
  getSavedBounds: () => ({ bounds: {}, maximized: false }),
  saveWindowBounds: vi.fn(),
}));
vi.mock("./autoUpdate", () => ({ runAutoUpdate: vi.fn() }));
// WP5: Lyre's library process is started, given the window's go-ahead for backups, and closed before quitting.
vi.mock("./main/lyreApi/startLibrary", () => {
  const library = { windowShown: vi.fn(), clearAudioCache: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
  (state as { lyreLibrary?: typeof library }).lyreLibrary = library;
  return {
    startLyreLibrary: vi.fn(() => {
      state.startupCalls.push("lyre-library");
      return library;
    }),
  };
});
vi.mock("./main/managers/SessionManager", () => ({
  SessionManager: class {
    destroy = vi.fn();
    connectSavedBots = vi.fn();
    constructor() {
      (state as { sessions?: unknown[] }).sessions = [...((state as { sessions?: unknown[] }).sessions ?? []), this];
    }
  },
}));
vi.mock("./main/security/sessions", () => {
  state.secureSessions = vi.fn();
  state.clearBrowsingData = vi.fn().mockResolvedValue(undefined);
  return {
    secureSessions: state.secureSessions,
    clearBrowsingData: state.clearBrowsingData,
    // Records how many start-up steps had run when the scheme was declared.
    registerLocalFileScheme: vi.fn(() => {
      (state as { stepsBeforeScheme?: number }).stepsBeforeScheme = state.startupCalls.length;
    }),
  };
});

beforeAll(async () => {
  // Let app.whenReady() resolve and create the main window.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

type FakeWindow = {
  options: Record<string, unknown>;
  webContents: {
    id: number;
    windowOpenHandler?: (d: { url: string }) => { action: string };
    emit: (event: string, ...args: unknown[]) => boolean;
    setUserAgent: ReturnType<typeof vi.fn>;
  };
  loadURL: ReturnType<typeof vi.fn>;
};
const mainWindow = () => state.windows[0] as FakeWindow;

describe("start-up order (FND-1)", () => {
  it("copies the Kenku FM library only after taking the single-instance lock, before any window", () => {
    expect(state.startupCalls.slice(0, 2)).toEqual(["single-instance-lock", "carry-over"]);
    expect(state.windows).toHaveLength(1);
  });

  it("reads nothing else of Kenku FM's after the library carry-over (its background pictures are Cue Desk's own now)", () => {
    expect(state.startupCalls).toEqual(["single-instance-lock", "carry-over", "lyre-library"]);
  });

  it("does not interrupt start-up when the library was copied", () => {
    expect(state.showMessageBoxSync).not.toHaveBeenCalled();
  });
});

describe("local-file scheme (WP1 security review 1)", () => {
  it("is declared before anything else, as Electron requires it before the app is ready", () => {
    expect((state as { stepsBeforeScheme?: number }).stepsBeforeScheme).toBe(0);
  });
});

describe("main window (SEC-10, SEC-7, SEC-3)", () => {
  it("is Lyre's own page, with Lyre's preload (FND-16: the old main window and its tabs are gone)", () => {
    const window = mainWindow();
    expect(window.loadURL).toHaveBeenCalledWith("file:///app/lyre_window/index.html");
    expect((window.options.webPreferences as { preload?: string }).preload).toBe("/app/lyre_window/preload.js");
  });

  it("has no frame of its own: Lyre's top strip is the title bar, with the system's buttons drawn over it (FND-16 step 2)", () => {
    expect(mainWindow().options).toMatchObject({ titleBarStyle: "hidden", titleBarOverlay: { height: 36 } });
  });

  it("keeps the browser's own user agent: only website tabs needed the spoofed one", () => {
    expect(mainWindow().webContents.setUserAgent).not.toHaveBeenCalled();
  });

  it("opens https links from the main window in the system browser", () => {
    state.openExternal.mockClear();
    expect(
      mainWindow().webContents.windowOpenHandler?.({
        url: "https://kenku.fm/docs/getting-a-discord-token",
      }),
    ).toEqual({ action: "deny" });
    expect(state.openExternal).toHaveBeenCalledWith(
      "https://kenku.fm/docs/getting-a-discord-token",
    );
  });

  it.each(["file:///C:/Windows/System32/calc.exe", "smb://host/x.exe", "http://kenku.fm"])(
    "never passes %j to the operating system",
    (url) => {
      state.openExternal.mockClear();
      expect(mainWindow().webContents.windowOpenHandler?.({ url })).toEqual({ action: "deny" });
      expect(state.openExternal).not.toHaveBeenCalled();
    },
  );

  it("cannot navigate away from its own page", () => {
    const event = { url: "https://evil.example/", isMainFrame: true, preventDefault: vi.fn() };
    mainWindow().webContents.emit("will-navigate", event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("is registered as the trusted Lyre page", () => {
    expect(trustedContents.roleOf(mainWindow().webContents)).toBe("lyre-view");
  });

  it("has one set of managers for its whole life, so reloading the page keeps the bots in their rooms", () => {
    const sessions = () => (state as { sessions?: unknown[] }).sessions ?? [];
    expect(sessions()).toHaveLength(1);
    mainWindow().webContents.emit("did-start-loading");
    expect(sessions()).toHaveLength(1);
  });

  it("hardens sessions on start-up", () => {
    expect(state.secureSessions).toHaveBeenCalledTimes(1);
  });

  it("FND-16: Empty the audio cache leaves website data alone, and goes only through the IPC sender guard (SEC-8)", async () => {
    await appInfo.registered?.emptyAudioCache();
    expect(state.clearBrowsingData).not.toHaveBeenCalled();
    expect(state.ipcHandlers.has("LYRE_EMPTY_AUDIO_CACHE")).toBe(false);
  });
});

describe("Lyre's library (WP5)", () => {
  const library = () => (state as unknown as { lyreLibrary: { windowShown: Mock; clearAudioCache: Mock; stop: Mock } }).lyreLibrary;
  const beforeQuit = () => {
    const app = electronApp as unknown as { on: Mock; quit: Mock };
    const call = app.on.mock.calls.find(([event]) => event === "before-quit");
    return { app, handler: call?.[1] as (event: { preventDefault: Mock }) => void };
  };

  it("starts after the carry-over, before the main window", () => {
    expect(state.startupCalls.indexOf("lyre-library")).toBeGreaterThan(state.startupCalls.indexOf("carry-over"));
    expect(state.windows).toHaveLength(1);
  });

  it("starts the daily backups (and the audio cache's tidy-up) once the main window is ready to show", () => {
    expect(library().windowShown).not.toHaveBeenCalled();
    (mainWindow() as unknown as { emit(event: string): void }).emit("ready-to-show");
    expect(library().windowShown).toHaveBeenCalledTimes(1);
  });

  it("logs the saved Discord bots in once the window shows, with nobody pressing Connect (FND-16)", () => {
    const session = ((state as { sessions?: { connectSavedBots: Mock }[] }).sessions ?? [])[0];
    // The ready-to-show above was the window's first showing.
    expect(session.connectSavedBots).toHaveBeenCalledTimes(1);
    (mainWindow() as unknown as { emit(event: string): void }).emit("ready-to-show");
    expect(session.connectSavedBots).toHaveBeenCalledTimes(1);
  });

  it("empties Lyre's audio cache when Settings asks (security review 3, FND-16)", async () => {
    await appInfo.registered?.emptyAudioCache();
    expect(library().clearAudioCache).toHaveBeenCalled();
  });

  it("is closed before the app quits, then the quit goes ahead", async () => {
    const { app, handler } = beforeQuit();
    const event = { preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(library().stop).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
    const again = { preventDefault: vi.fn() };
    handler(again);
    expect(again.preventDefault).not.toHaveBeenCalled();
    expect(library().stop).toHaveBeenCalledTimes(1);
  });
});
