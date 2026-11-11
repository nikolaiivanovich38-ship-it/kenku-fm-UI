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

  it("tells the main window the first failure in plain words, once, until a check works again", () => {
    const window = fakeWindow();
    const status = new UpdateStatus();
    runAutoUpdate(window, squirrelInstalled, status);
    handlerFor("error")(new Error("net::ERR_INTERNET_DISCONNECTED"));
    handlerFor("error")(new Error("net::ERR_INTERNET_DISCONNECTED"));
    const errors = vi.mocked(window.webContents.send).mock.calls.filter(([channel]) => channel === "ERROR");
    expect(errors).toEqual([
      [
        "ERROR",
        "Lyre could not check for updates: this computer seems to be offline. It tries again every 15 minutes; this version keeps working.",
      ],
    ]);
    expect(status.state().kind).toBe("error");

    handlerFor("update-not-available")();
    expect(status.state().kind).toBe("up-to-date");
    handlerFor("error")(new Error("HTTP Status 503"));
    expect(vi.mocked(window.webContents.send).mock.calls.filter(([channel]) => channel === "ERROR")).toHaveLength(2);
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
    expect(status.state()).toEqual({ kind: "ready", message: "A new version of Lyre is ready. Restart Lyre to use it." });
    expect(window.webContents.send).toHaveBeenCalledWith("MESSAGE", "A new version of Lyre is ready. Restart Lyre to use it.");
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
