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

describe("updates only for installed copies (SEC-14)", () => {
  const realPlatform = process.platform;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => Object.defineProperty(process, "platform", { value: realPlatform }));

  it("looks for the installer's Update.exe one folder above the app's folder", () => {
    const existsSync = vi.fn(() => true);
    const execPath = path.join("C:", "Users", "gm", "AppData", "Local", "cue-desk", "app-0.1.0", "Cue Desk.exe");
    expect(isSquirrelInstall(execPath, existsSync)).toBe(true);
    expect(existsSync).toHaveBeenCalledWith(
      path.join("C:", "Users", "gm", "AppData", "Local", "cue-desk", "Update.exe"),
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
