import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { runAutoUpdate } from "./autoUpdate";

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
    runAutoUpdate(fakeWindow());
    for (const [options] of electron.autoUpdater.setFeedURL.mock.calls) {
      expect(options.url).not.toContain("download.kenku.fm");
    }
  });

  it("uses the fork's GitHub releases through update.electronjs.org on Windows", () => {
    setPlatform("win32");
    runAutoUpdate(fakeWindow());
    expect(electron.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: `https://update.electronjs.org/nikolaiivanovich38-ship-it/kenku-fm-UI/win32-${process.arch}/0.1.0`,
    });
  });

  it("does not configure updates on Linux", () => {
    setPlatform("linux");
    runAutoUpdate(fakeWindow());
    expect(electron.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it("logs update errors instead of swallowing them", () => {
    setPlatform("win32");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runAutoUpdate(fakeWindow());
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
