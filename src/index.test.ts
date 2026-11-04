import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import "./index";
import { trustedContents } from "./main/security/trustedContents";

const state = vi.hoisted(() => {
  Object.assign(globalThis, {
    MAIN_WINDOW_WEBPACK_ENTRY: "file:///app/main_window/index.html",
    MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: "/app/main_window/preload.js",
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
    getURL = () => "file:///app/main_window/index.html";
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
    constructor() {
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
vi.mock("./main/managers/SessionManager", () => ({
  SessionManager: class {
    destroy = vi.fn();
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
    expect(state.startupCalls).toEqual(["single-instance-lock", "carry-over"]);
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
  it("sets its user agent before loading, so the page loads once", () => {
    const window = mainWindow();
    const setAgent = window.webContents.setUserAgent.mock.invocationCallOrder[0];
    const load = window.loadURL.mock.invocationCallOrder[0];
    expect(setAgent).toBeLessThan(load);
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

  it("is registered as a trusted app page", () => {
    expect(trustedContents.roleOf(mainWindow().webContents)).toBe("main-window");
  });

  it("hardens sessions on start-up", () => {
    expect(state.secureSessions).toHaveBeenCalledTimes(1);
  });

  it("clears website tab data as well when the user clears the cache", async () => {
    await appInfo.registered?.clearCache();
    expect(state.clearBrowsingData).toHaveBeenCalled();
  });

  it("answers version and platform only through the IPC sender guard (SEC-8)", () => {
    expect(appInfo.registered?.getVersion()).toBe("0.0.0");
    expect(state.ipcHandlers.has("CLEAR_CACHE")).toBe(false);
  });
});
