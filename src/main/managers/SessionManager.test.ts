import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({
  playback: [] as {
    setLyreView: ReturnType<typeof vi.fn>;
    outputs: EventEmitter & {
      connectSaved: ReturnType<typeof vi.fn>;
      state: () => unknown;
      importLegacyToken: ReturnType<typeof vi.fn>;
      setLegacyTokenNote: ReturnType<typeof vi.fn>;
    };
    audioCaptureManager: { setStreamingMode: ReturnType<typeof vi.fn> };
    destroy: ReturnType<typeof vi.fn>;
  }[],
  lyre: [] as { attachView: (view: unknown) => void; onAttachView?: (view: unknown) => void; destroy: ReturnType<typeof vi.fn> }[],
  sound: [] as { options: { file: string | null; apply: (mode: string) => void }; onLibraryEvent: ReturnType<typeof vi.fn> }[],
  moves: [] as Record<string, (...args: never[]) => unknown>[],
}));

vi.mock("electron", () => ({ ipcMain: { on: vi.fn(), handle: vi.fn() } }));
vi.mock("./PlaybackManager", async () => {
  const { EventEmitter } = await import("events");
  return {
  PlaybackManager: class {
    setLyreView = vi.fn();
    outputs = Object.assign(new EventEmitter(), { connectSaved: vi.fn(), state: () => ({}), importLegacyToken: vi.fn(), setLegacyTokenNote: vi.fn() });
    audioCaptureManager = { setStreamingMode: vi.fn() };
    destroy = vi.fn();
    constructor() {
      made.playback.push(this);
    }
  },
  };
});
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
vi.mock("../window/windowFrame", () => ({ WindowFrame: class { destroy = vi.fn(); } }));
vi.mock("../remote/remoteOff", () => ({ RemoteOff: class { destroy = vi.fn(); } }));
vi.mock("../soundToDiscord", () => ({
  SoundToDiscord: class {
    onLibraryEvent = vi.fn();
    constructor(public options: { file: string | null; apply: (mode: string) => void }) {
      made.sound.push(this);
    }
  },
}));
const record = vi.hoisted(() => ({ next: null as unknown, seen: [] as string[] }));
vi.mock("../legacy/oldWindowMove", () => ({
  oldWindowRecordFile: (folder: string) => `${folder}/old-window.json`,
  moveOldWindowDataOnce: vi.fn(async (deps: Record<string, (...args: never[]) => unknown>) => {
    made.moves.push(deps);
    return record.next;
  }),
  markTokenNoteSeen: vi.fn(async (file: string) => void record.seen.push(file)),
}));

import { SessionManager } from "./SessionManager";

function fakeWindow() {
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async () => "stored"),
  });
  return { webContents, isDestroyed: () => false } as unknown as Electron.BrowserWindow;
}

function fakeLibrary() {
  const listeners: ((event: unknown) => void)[] = [];
  return {
    folder: "/data/library",
    service: { call: vi.fn(async () => ({ ok: true, value: {} })) },
    onEvent: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    emit: (event: unknown) => listeners.forEach((listener) => listener(event)),
  };
}

describe("SessionManager (FND-16: the window's own page is the Lyre page)", () => {
  beforeEach(() => {
    made.playback.length = 0;
    made.lyre.length = 0;
    made.sound.length = 0;
    made.moves.length = 0;
    record.next = null;
    record.seen.length = 0;
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

  it("applies Sound to Discord from this computer's settings to the capture window, and again when they change", () => {
    const library = fakeLibrary();
    new SessionManager(fakeWindow(), { library: library as never });
    const sound = made.sound[0];
    expect(sound.options.file).toBe("/data/library/this-computer.json");
    sound.options.apply("lowLatency");
    expect(made.playback[0].audioCaptureManager.setStreamingMode).toHaveBeenCalledWith("lowLatency");
    library.emit({ type: "changed", areas: ["settings"] });
    expect(sound.onLibraryEvent).toHaveBeenCalledWith({ type: "changed", areas: ["settings"] });
  });

  it("takes over the old main window's settings once, when the page first loads, by reading the page's storage", async () => {
    const library = fakeLibrary();
    const window = fakeWindow();
    new SessionManager(window, { library: library as never });
    expect(made.moves).toHaveLength(0);
    window.webContents.emit("did-finish-load");
    window.webContents.emit("did-finish-load");
    expect(made.moves).toHaveLength(1);
    const move = made.moves[0] as unknown as { recordFile: string; read(): Promise<unknown>; setStreamingMode(mode: string): Promise<boolean> };
    expect(move.recordFile).toBe("/data/library/old-window.json");
    expect(await move.read()).toBe("stored");
    expect((window.webContents as unknown as { executeJavaScriptInIsolatedWorld: ReturnType<typeof vi.fn> }).executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(1999, [
      { code: 'localStorage.getItem("persist:root")' },
    ]);
    expect(await move.setStreamingMode("lowLatency")).toBe(true);
    expect(library.service.call).toHaveBeenCalledWith("settings", "setComputer", [{ streamingMode: "lowLatency" }]);
  });

  it("stops hearing the library when destroyed", () => {
    const library = fakeLibrary();
    const session = new SessionManager(fakeWindow(), { library: library as never });
    session.destroy();
    library.emit({ type: "changed", areas: ["settings"] });
    expect(made.sound[0].onLibraryEvent).not.toHaveBeenCalled();
  });

  it("hands a plain Kenku FM token to the bots and logs them in, then shows the note until it is read", async () => {
    const library = fakeLibrary();
    const window = fakeWindow();
    record.next = { movedAt: 1, bookmarks: [], tokenMoved: true, tokenNoteSeen: false };
    new SessionManager(window, { library: library as never });
    window.webContents.emit("did-finish-load");
    const move = made.moves[0] as unknown as { importToken(token: string): void };
    const outputs = made.playback[0].outputs;
    move.importToken("MTIz.abc.def");
    expect(outputs.importLegacyToken).toHaveBeenCalledWith("MTIz.abc.def");
    expect(outputs.connectSaved).toHaveBeenCalled();
    await vi.waitFor(() => expect(outputs.setLegacyTokenNote).toHaveBeenCalledWith(true));
    outputs.emit("legacyTokenNoteSeen");
    expect(record.seen).toEqual(["/data/library/old-window.json"]);
  });

  it("shows no note when the token note was read before, or no token came across", async () => {
    const window = fakeWindow();
    record.next = { movedAt: 1, bookmarks: [], tokenMoved: true, tokenNoteSeen: true };
    new SessionManager(window, { library: fakeLibrary() as never });
    window.webContents.emit("did-finish-load");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(made.playback[0].outputs.setLegacyTokenNote).not.toHaveBeenCalledWith(true);
  });

  it("does not take over the old window's data in a test build's sample library (it has none)", () => {
    const window = fakeWindow();
    new SessionManager(window, { library: fakeLibrary() as never, moveOldWindowData: false });
    window.webContents.emit("did-finish-load");
    expect(made.moves).toHaveLength(0);
  });

  it("test builds: arriving from Kenku FM runs the move again with a plain token and the given bookmarks", async () => {
    const library = fakeLibrary();
    const session = new SessionManager(fakeWindow(), { library: library as never, moveOldWindowData: false });
    record.next = { movedAt: 2, bookmarks: [{ title: "Tabletop Audio", url: "https://tabletopaudio.com/" }], tokenMoved: true, tokenNoteSeen: false };
    await session.arriveFromKenkuFM({ plainToken: true, bookmarks: [{ title: "Tabletop Audio", url: "https://tabletopaudio.com/" }] });
    const move = made.moves[0] as unknown as { read(): Promise<string> };
    const raw = JSON.parse(await move.read());
    expect(JSON.parse(raw.settings).discordToken).toEqual(expect.any(String));
    expect(Object.values(JSON.parse(raw.bookmarks).bookmarks.byId)).toEqual([{ id: "b0", title: "Tabletop Audio", url: "https://tabletopaudio.com/" }]);
    expect(made.playback[0].outputs.setLegacyTokenNote).toHaveBeenCalledWith(true);
  });
});
