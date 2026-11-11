import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({
  playback: [] as { setLyreView: ReturnType<typeof vi.fn>; outputs: { connectSaved: ReturnType<typeof vi.fn>; state: () => unknown }; destroy: ReturnType<typeof vi.fn> }[],
  lyre: [] as { attachView: (view: unknown) => void; onAttachView?: (view: unknown) => void; destroy: ReturnType<typeof vi.fn> }[],
}));

vi.mock("electron", () => ({ ipcMain: { on: vi.fn(), handle: vi.fn() } }));
vi.mock("./PlaybackManager", () => ({
  PlaybackManager: class {
    setLyreView = vi.fn();
    outputs = { connectSaved: vi.fn(), state: () => ({}) };
    destroy = vi.fn();
    constructor() {
      made.playback.push(this);
    }
  },
}));
vi.mock("./LyreManager", () => ({
  LyreManager: class {
    onAttachView?: (view: unknown) => void;
    attachView = (view: unknown) => this.onAttachView?.(view);
    getView = vi.fn();
    destroy = vi.fn();
    constructor() {
      made.lyre.push(this);
    }
  },
}));
vi.mock("./PlayerManager", () => ({ PlayerManager: class { destroy = vi.fn(); saveBeforeClose = vi.fn(); } }));
vi.mock("./BrowserViewManagerMain", () => ({ BrowserViewManagerMain: class { destroy = vi.fn(); } }));
vi.mock("./WindowManager", () => ({ WindowManager: class { destroy = vi.fn(); } }));
vi.mock("../diagnostics/diagnosticsBridge", () => ({ DiagnosticsBridge: class { destroy = vi.fn(); } }));
vi.mock("../windowSettings/windowSettingsBridge", () => ({ WindowSettingsBridge: class { destroy = vi.fn(); } }));

import { SessionManager } from "./SessionManager";

function fakeWindow() {
  const webContents = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false });
  return { webContents, isDestroyed: () => false } as unknown as Electron.BrowserWindow;
}

describe("SessionManager (FND-16: the window's own page is the Lyre page)", () => {
  beforeEach(() => {
    made.playback.length = 0;
    made.lyre.length = 0;
  });

  it("joins the window's page to the audio channel and the outputs at once", () => {
    const window = fakeWindow();
    new SessionManager(window);
    expect(made.playback[0].setLyreView).toHaveBeenCalledWith(window.webContents);
  });

  it("joins the page again each time it finishes loading (a reload), keeping the same managers", () => {
    const window = fakeWindow();
    new SessionManager(window);
    made.playback[0].setLyreView.mockClear();
    window.webContents.emit("did-finish-load");
    expect(made.playback).toHaveLength(1);
    expect(made.playback[0].setLyreView).toHaveBeenCalledWith(window.webContents);
  });

  it("stops listening to the page when destroyed", () => {
    const window = fakeWindow();
    const session = new SessionManager(window);
    session.destroy();
    made.playback[0].setLyreView.mockClear();
    window.webContents.emit("did-finish-load");
    expect(made.playback[0].setLyreView).not.toHaveBeenCalled();
  });

  it("logs every saved bot in when asked (the window shows)", () => {
    const session = new SessionManager(fakeWindow());
    session.connectSavedBots();
    expect(made.playback[0].outputs.connectSaved).toHaveBeenCalledTimes(1);
  });
});
