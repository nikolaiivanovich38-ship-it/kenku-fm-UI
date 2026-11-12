import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    isReady: () => true,
    getVersion: () => "0.1.0",
  },
  autoUpdater: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock("electron", () => electron);

import path from "path";
import { isSquirrelInstall, runAutoUpdate } from "./autoUpdate";
import { UpdateStatus } from "./main/updateStatus";

const squirrelInstalled = () => true;

function fakeWindow() {
  return {
    on: vi.fn(),
    webContents: { send: vi.fn() },
  } as unknown as Electron.BrowserWindow;
}

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
}

describe("runAutoUpdate (SEC-14)", () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform(realPlatform);
  });

  it("never points the updater at upstream Kenku FM's feed", () => {
    setPlatform("win32");
    runAutoUpdate(fakeWindow(), squirrelInstalled);
    for (const [options] of electron.autoUpdater.setFeedURL.mock.calls) {
      expect(options.url).not.toContain("download.kenku.fm");
    }
  });

  it("uses the fork's GitHub releases through update.electronjs.org on Windows", () => {
    setPlatform("win32");
    runAutoUpdate(fakeWindow(), squirrelInstalled);
    expect(electron.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: `https://update.electronjs.org/nikolaiivanovich38-ship-it/kenku-fm-UI/win32-${process.arch}/0.1.0`,
    });
  });

  it("does not configure updates on Linux", () => {
    setPlatform("linux");
    runAutoUpdate(fakeWindow(), squirrelInstalled);
    expect(electron.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it("logs update errors instead of swallowing them", () => {
    setPlatform("win32");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runAutoUpdate(fakeWindow(), squirrelInstalled);
    const errorHandler = electron.autoUpdater.on.mock.calls.find(
      ([event]) => event === "error",
    )?.[1];
    expect(errorHandler).toBeTypeOf("function");
    errorHandler(new Error("network down"));
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("update"),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

describe("update errors are shown, not only logged (SEC-14)", () => {
  const realPlatform = process.platform;
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform("win32");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setPlatform(realPlatform);
    vi.restoreAllMocks();
  });

  const handlerFor = (event: string) =>
    electron.autoUpdater.on.mock.calls.find(([name]) => name === event)?.[1] as (...args: unknown[]) => void;

  it("marks the first failure for the Lyre page to show, once, until a check works again (FND-16: no old window to tell)", () => {
    const window = fakeWindow();
    const status = new UpdateStatus();
    runAutoUpdate(window, squirrelInstalled, status);
    handlerFor("error")(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(status.state()).toMatchObject({
      kind: "error",
      message: "Lyre could not check for updates: this computer seems to be offline. It tries again every 15 minutes; this version keeps working.",
      tell: true,
    });
    handlerFor("checking-for-update")();
    handlerFor("error")(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(status.state()).toMatchObject({ kind: "error", tell: false });

    handlerFor("update-not-available")();
    expect(status.state().kind).toBe("up-to-date");
    handlerFor("error")(new Error("HTTP Status 503"));
    expect(status.state()).toMatchObject({ kind: "error", tell: true });
    // The old main window's channels are gone.
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("takes the feed's 404 (a Releases page with only drafts) as no update, not an error (w51-fix2)", () => {
    const window = fakeWindow();
    const status = new UpdateStatus();
    runAutoUpdate(window, squirrelInstalled, status);
    handlerFor("checking-for-update")();
    handlerFor("error")(
      new Error("Command failed: 4294967295\nSystem.AggregateException: One or more errors occurred. ---> System.Net.WebException: The remote server returned an error: (404) Not Found."),
    );
    expect(status.state().kind).toBe("up-to-date");
    expect(vi.mocked(window.webContents.send).mock.calls.filter(([channel]) => channel === "ERROR")).toEqual([]);
  });

  it("does not run the updater while the feed has nothing published (only drafts): up to date, no error (w51-fix2)", async () => {
    vi.useFakeTimers();
    try {
      const window = fakeWindow();
      const status = new UpdateStatus();
      const hasRelease = vi.fn(async () => false);
      runAutoUpdate(window, squirrelInstalled, status, hasRelease);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(hasRelease).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/update\.electronjs\.org\//));
      expect(electron.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
      expect(status.state().kind).toBe("up-to-date");
      expect(vi.mocked(window.webContents.send).mock.calls.filter(([channel]) => channel === "ERROR")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["a release is published", true],
    ["the feed could not be asked", null],
  ])("runs the updater when %s (w51-fix2)", async (_label, published) => {
    vi.useFakeTimers();
    try {
      runAutoUpdate(fakeWindow(), squirrelInstalled, new UpdateStatus(), async () => published);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records checking, downloading and a downloaded update, and says to restart in plain words", () => {
    const window = fakeWindow();
    const status = new UpdateStatus();
    runAutoUpdate(window, squirrelInstalled, status);
    handlerFor("checking-for-update")();
    expect(status.state().kind).toBe("checking");
    handlerFor("update-available")();
    expect(status.state().kind).toBe("downloading");
    handlerFor("update-downloaded")();
    expect(status.state()).toEqual({ kind: "ready", message: "Lyre has an update. Restart Lyre to use it." });
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("keeps a downloaded update ready, and stops checking, so Restart now keeps working (CR51-4)", () => {
    vi.useFakeTimers();
    try {
      const status = new UpdateStatus();
      runAutoUpdate(fakeWindow(), squirrelInstalled, status);
      vi.advanceTimersByTime(15 * 60 * 1000);
      expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      handlerFor("update-downloaded")();
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      // A check already under way when it finished changes nothing.
      handlerFor("checking-for-update")();
      handlerFor("error")(new Error("net::ERR_INTERNET_DISCONNECTED"));
      handlerFor("update-not-available")();
      expect(status.state().kind).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test builds: the specs can make the updater report an event, through the same handlers, even where updates are off", () => {
    vi.stubGlobal("__CUE_DESK_TEST_BUILD__", true);
    try {
      setPlatform("linux");
      const status = new UpdateStatus();
      runAutoUpdate(fakeWindow(), squirrelInstalled, status);
      const hook = (globalThis as unknown as { __lyreUpdatesTest: { report(event: unknown): void } }).__lyreUpdatesTest;
      hook.report({ kind: "error", error: "net::ERR_INTERNET_DISCONNECTED" });
      expect(status.state()).toMatchObject({ kind: "error", tell: true });
      hook.report({ kind: "up-to-date" });
      expect(status.state().kind).toBe("up-to-date");
      hook.report({ kind: "downloaded" });
      expect(status.state().kind).toBe("ready");
    } finally {
      vi.unstubAllGlobals();
      delete (globalThis as { __lyreUpdatesTest?: unknown }).__lyreUpdatesTest;
    }
  });

  it("release builds have no such hook", () => {
    setPlatform("linux");
    runAutoUpdate(fakeWindow(), squirrelInstalled, new UpdateStatus());
    expect((globalThis as { __lyreUpdatesTest?: unknown }).__lyreUpdatesTest).toBeUndefined();
  });

  it("says why updates are off for the zip build and on systems without them", () => {
    const status = new UpdateStatus();
    vi.spyOn(console, "info").mockImplementation(() => {});
    runAutoUpdate(fakeWindow(), () => false, status);
    expect(status.state()).toEqual({
      kind: "off",
      message: "Automatic updates are off: this copy was not set up by the installer. Install Lyre with its installer to get them.",
    });
    setPlatform("linux");
    runAutoUpdate(fakeWindow(), squirrelInstalled, status);
    expect(status.state()).toEqual({ kind: "off", message: "Automatic updates are not available for this system yet." });
  });

  it("removes every updater listener when the window closes", () => {
    const window = fakeWindow();
    runAutoUpdate(window, squirrelInstalled, new UpdateStatus());
    const close = vi.mocked(window.on).mock.calls.find(([event]) => (event as string) === "close")?.[1] as () => void;
    close();
    const added = electron.autoUpdater.on.mock.calls.map(([event]) => event).sort();
    const removed = electron.autoUpdater.off.mock.calls.map(([event]) => event).sort();
    expect(removed).toEqual(added);
  });
});

describe("updates only for installed copies (SEC-14)", () => {
  const realPlatform = process.platform;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => Object.defineProperty(process, "platform", { value: realPlatform }));

  it("looks for the installer's Update.exe one folder above the app's folder", () => {
    const existsSync = vi.fn(() => true);
    const execPath = path.join("C:", "Users", "gm", "AppData", "Local", "lyre", "app-0.1.0", "Lyre.exe");
    expect(isSquirrelInstall(execPath, existsSync)).toBe(true);
    expect(existsSync).toHaveBeenCalledWith(
      path.join("C:", "Users", "gm", "AppData", "Local", "lyre", "Update.exe"),
    );
  });

  it("skips updates for the zip build, which has no Update.exe, instead of logging errors every 15 minutes", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    runAutoUpdate(fakeWindow(), () => false);
    expect(electron.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(electron.autoUpdater.on).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("installer"));
    info.mockRestore();
  });
});
