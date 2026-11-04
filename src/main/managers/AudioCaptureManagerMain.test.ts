import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "net";
import { AudioCaptureManagerMain, MAX_OPUS_PACKET_BYTES, SILENCE_HOLD_MS } from "./AudioCaptureManagerMain";
import { trustedContents } from "../security/trustedContents";
import { captureTargets } from "../security/captureTargets";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
  type FakePage,
} from "../security/testing/fakeIpc";

vi.hoisted(() => {
  Object.assign(globalThis, {
    AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: "file:///app/audio_capture_window/index.html",
    AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: "/app/audio_capture_window/preload.js",
  });
});

const windowOptions = vi.hoisted(() => [] as Record<string, unknown>[]);
const pages = vi.hoisted(() => new Map<number, unknown>());

vi.mock("electron", async () => {
  const { EventEmitter } = await import("events");
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  class FakeWebContents extends EventEmitter {
    id = 42;
    mainFrame = { frameTreeNodeId: 420 };
    isDestroyed = () => false;
    loadURL = vi.fn().mockResolvedValue(undefined);
    getURL = () => "file:///app/audio_capture_window/index.html";
    send = vi.fn();
    close = vi.fn();
    destroy = vi.fn();
    setWindowOpenHandler = vi.fn();
  }
  class BrowserWindow {
    webContents = new FakeWebContents();
    constructor(options: Record<string, unknown>) {
      windowOptions.push(options);
    }
  }
  return {
    BrowserWindow,
    webContents: { fromId: (id: number) => pages.get(id) },
    ipcMain: fakeIpcMain,
  };
});

let manager: InstanceType<typeof AudioCaptureManagerMain> | undefined;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  manager?.destroy();
  manager = undefined;
  captureTargets.revokeAll();
  fakeIpcMain.reset();
  pages.clear();
  windowOptions.length = 0;
});

/** The hidden capture window's page, as seen by IPC. */
function capturePage(m: AudioCaptureManagerMain) {
  return m._browserWindow.webContents as unknown as FakePage;
}

/** Messages the main process forwarded to the hidden capture window. */
function sentToCapture(m: AudioCaptureManagerMain) {
  return (capturePage(m).send as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

/** Only the capture start/stop messages, in order. */
function captureCommands(m: AudioCaptureManagerMain) {
  return sentToCapture(m).filter(([channel]) =>
    /BROADCAST_|BROWSER_VIEW_STREAM/.test(channel as string),
  );
}

async function listening(m: InstanceType<typeof AudioCaptureManagerMain>) {
  if (!m._wss.address()) {
    await new Promise((resolve) => m._wss.once("listening", resolve));
  }
  return m._wss.address() as AddressInfo;
}

/** A website tab (or the player, with a role) that can play sound. */
type SoundPage = FakePage & {
  audible: boolean;
  isCurrentlyAudible(): boolean;
  setAudioMuted: ReturnType<typeof vi.fn>;
  play(): void;
  fallSilent(): void;
};

function soundPage(role: Parameters<typeof fakePage>[0] = null): SoundPage {
  const page = fakePage(role) as SoundPage;
  page.audible = false;
  page.isCurrentlyAudible = () => page.audible;
  page.setAudioMuted = vi.fn();
  page.play = () => {
    page.audible = true;
    page.emit("audio-state-changed", { audible: true });
  };
  page.fallSilent = () => {
    page.audible = false;
    page.emit("audio-state-changed", { audible: false });
  };
  pages.set(page.id, page);
  return page;
}

/** Last item of a list. */
const last = <T>(items: T[]): T => items[items.length - 1];

const mainWindow = () => fromMainFrame(fakePage("main-window"));

/** The main window offers a loaded view for capture. */
function offer(page: FakePage) {
  fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", mainWindow(), page.id);
}

describe("AudioCaptureManagerMain audio socket (SEC-2)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("listens on the loopback interface only", async () => {
    manager = new AudioCaptureManagerMain();
    const address = await listening(manager);
    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
  });

  it("hands the capture window a loopback address it can connect to", async () => {
    manager = new AudioCaptureManagerMain();
    await listening(manager);
    const address = (await fakeIpcMain.invoke(
      "AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS",
      fromMainFrame(capturePage(manager)),
    )) as AddressInfo;
    expect(address.address).toBe("127.0.0.1");

    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.close();
  });

  it("registers the capture window as a trusted page", async () => {
    manager = new AudioCaptureManagerMain();
    expect(trustedContents.roleOf(manager._browserWindow.webContents)).toBe("audio-capture");
  });
});

describe("AudioCaptureManagerMain: who may send (SEC-8)", () => {
  it("forwards capture commands from the main window", () => {
    manager = new AudioCaptureManagerMain();
    const main = fakePage("main-window");
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_MUTED", fromMainFrame(main), 7, true);
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_STREAMING_MODE", fromMainFrame(main), "lowLatency");
    expect(sentToCapture(manager)).toEqual([["AUDIO_CAPTURE_BROWSER_VIEW_MUTED", 7, true]]);
    manager.startBroadcast();
    expect(sentToCapture(manager)).toContainEqual(["AUDIO_CAPTURE_BROADCAST_START", "lowLatency"]);
  });

  it("ignores capture commands from a website tab, an embedded frame or the player", () => {
    manager = new AudioCaptureManagerMain();
    for (const event of [
      fromMainFrame(fakePage(null)),
      fromSubframe(fakePage("main-window")),
      fromMainFrame(fakePage("player-view")),
    ]) {
      fakeIpcMain.deliver("AUDIO_CAPTURE_SET_LOOPBACK", event, true);
      fakeIpcMain.deliver("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", event, "mic");
      fakeIpcMain.deliver("AUDIO_CAPTURE_SET_STREAMING_MODE", event, "lowLatency");
    }
    expect(sentToCapture(manager)).toEqual([]);
    manager.startBroadcast();
    expect(sentToCapture(manager)).toEqual([["AUDIO_CAPTURE_BROADCAST_START", "performance"]]);
  });

  it("ignores capture commands with the wrong argument types", () => {
    manager = new AudioCaptureManagerMain();
    const main = mainWindow();
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_LOOPBACK", main, "true");
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_MUTED", main, "7", true);
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_STREAMING_MODE", main, "fast");
    expect(sentToCapture(manager)).toEqual([]);
  });

  it("hands the socket address to the capture window only", async () => {
    vi.useRealTimers();
    manager = new AudioCaptureManagerMain();
    await expect(
      fakeIpcMain.invoke("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS", fromMainFrame(fakePage("main-window"))),
    ).rejects.toThrow();
    await expect(
      fakeIpcMain.invoke("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS", fromMainFrame(fakePage(null))),
    ).rejects.toThrow();
  });

  it("stops listening when destroyed", () => {
    manager = new AudioCaptureManagerMain();
    manager.destroy();
    manager = undefined;
    expect(fakeIpcMain.eventNames()).toEqual([]);
    expect(fakeIpcMain.handlers.size).toBe(0);
  });
});

describe("AudioCaptureManagerMain: capture only while broadcasting (PERF-4)", () => {
  it("captures nothing before an output joins, even a tab that plays", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    tab.play();
    expect(captureCommands(manager)).toEqual([]);
    expect(captureTargets.has(tab)).toBe(false);
    expect(tab.getMediaSourceId).not.toHaveBeenCalled();
  });

  it("starts the broadcast once and captures only the views that are playing", () => {
    manager = new AudioCaptureManagerMain();
    const playing = soundPage();
    const quiet = soundPage();
    offer(playing);
    offer(quiet);
    playing.audible = true;

    manager.startBroadcast();
    manager.startBroadcast();

    expect(captureCommands(manager)).toEqual([
      ["AUDIO_CAPTURE_BROADCAST_START", "performance"],
      ["AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", playing.id, `media-source-${playing.id}`],
    ]);
    expect(captureTargets.has(playing)).toBe(true);
    expect(captureTargets.has(quiet)).toBe(false);
  });

  it("captures a view as soon as it becomes audible during a broadcast", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    manager.startBroadcast();
    tab.play();
    expect(captureCommands(manager)).toContainEqual([
      "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM",
      tab.id,
      `media-source-${tab.id}`,
    ]);
  });

  it("captures a view offered during a broadcast that is already playing", () => {
    manager = new AudioCaptureManagerMain();
    manager.startBroadcast();
    const tab = soundPage();
    tab.audible = true;
    offer(tab);
    expect(captureTargets.has(tab)).toBe(true);
  });

  it("keeps a capture through a short silence and stops it after a long one", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    manager.startBroadcast();
    tab.play();
    tab.fallSilent();
    vi.advanceTimersByTime(SILENCE_HOLD_MS - 1000);
    tab.play();
    tab.fallSilent();
    vi.advanceTimersByTime(SILENCE_HOLD_MS - 1000);
    expect(captureTargets.has(tab)).toBe(true);
    expect(captureCommands(manager).filter(([c]) => c === "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM")).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(captureTargets.has(tab)).toBe(false);
    expect(last(captureCommands(manager))).toEqual(["AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", tab.id]);

    tab.play();
    expect(captureTargets.has(tab)).toBe(true);
  });

  it("starts capturing when an audio or video element starts, before the view is audible", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    manager.startBroadcast();
    tab.emit("media-started-playing");
    expect(captureTargets.has(tab)).toBe(true);
    // The element turns out to be audible: the capture stays.
    tab.play();
    vi.advanceTimersByTime(SILENCE_HOLD_MS * 2);
    expect(captureTargets.has(tab)).toBe(true);
  });

  it("stops a capture started by an element that never became audible", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    manager.startBroadcast();
    tab.emit("media-started-playing");
    vi.advanceTimersByTime(SILENCE_HOLD_MS);
    expect(captureTargets.has(tab)).toBe(false);
  });

  it("ignores elements that start playing outside a broadcast", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    tab.emit("media-started-playing");
    expect(captureTargets.has(tab)).toBe(false);
  });

  it("stops every capture when the last output leaves, and ignores sound afterwards", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    manager.startBroadcast();
    tab.play();
    manager.stopBroadcast();
    expect(captureTargets.has(tab)).toBe(false);
    expect(last(captureCommands(manager))).toEqual(["AUDIO_CAPTURE_BROADCAST_STOP"]);

    tab.fallSilent();
    tab.play();
    vi.advanceTimersByTime(SILENCE_HOLD_MS * 2);
    expect(last(captureCommands(manager))).toEqual(["AUDIO_CAPTURE_BROADCAST_STOP"]);
  });

  it("passes on encoded packets only while broadcasting, and refuses oversized ones", () => {
    manager = new AudioCaptureManagerMain();
    const packets: Buffer[] = [];
    manager.on("packet", (packet) => packets.push(packet));
    manager._handlePacket(Buffer.from([1]));
    manager.startBroadcast();
    manager._handlePacket(Buffer.from([2]));
    manager._handlePacket(Buffer.alloc(MAX_OPUS_PACKET_BYTES + 1));
    manager._handlePacket(Buffer.alloc(0));
    expect(packets).toEqual([Buffer.from([2])]);
  });
});

describe("AudioCaptureManagerMain: local playback while not captured (PERF-4)", () => {
  it("mutes a tab locally when its mute button is pressed", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    expect(tab.setAudioMuted).toHaveBeenLastCalledWith(false);
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_MUTED", mainWindow(), tab.id, true);
    expect(tab.setAudioMuted).toHaveBeenLastCalledWith(true);
  });

  it("remembers a mute pressed before the view was offered", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_MUTED", mainWindow(), tab.id, true);
    offer(tab);
    expect(tab.setAudioMuted).toHaveBeenLastCalledWith(true);
  });

  it("silences every view on this computer when This Computer is off", () => {
    manager = new AudioCaptureManagerMain();
    const tab = soundPage();
    offer(tab);
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_LOOPBACK", mainWindow(), false);
    expect(tab.setAudioMuted).toHaveBeenLastCalledWith(true);
    expect(sentToCapture(manager)).toContainEqual(["AUDIO_CAPTURE_SET_LOOPBACK", false]);
    fakeIpcMain.deliver("AUDIO_CAPTURE_SET_LOOPBACK", mainWindow(), true);
    expect(tab.setAudioMuted).toHaveBeenLastCalledWith(false);
  });
});

describe("AudioCaptureManagerMain: which views may be captured (SEC-3)", () => {
  it("lets the chosen tab's audio be captured, and only until it stops", () => {
    manager = new AudioCaptureManagerMain();
    manager.startBroadcast();
    const tab = soundPage();
    const other = soundPage();
    tab.audible = true;
    offer(tab);
    expect(captureTargets.has(tab)).toBe(true);
    expect(captureTargets.has(other)).toBe(false);
    fakeIpcMain.deliver("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", mainWindow(), tab.id);
    expect(captureTargets.has(tab)).toBe(false);
    // A closed view is no longer watched.
    tab.play();
    expect(captureTargets.has(tab)).toBe(false);
  });

  it("captures only tabs and the player, never the main window or itself (WP1 review)", () => {
    manager = new AudioCaptureManagerMain();
    manager.startBroadcast();
    const mainPage = soundPage("main-window");
    mainPage.audible = true;
    const capture = Object.assign(capturePage(manager), { isCurrentlyAudible: () => true, setAudioMuted: vi.fn() });
    pages.set(capture.id, capture);
    const player = soundPage("player-view");
    player.audible = true;
    const main = fromMainFrame(mainPage);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, mainPage.id);
    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, capture.id);
    expect(captureTargets.has(mainPage)).toBe(false);
    expect(captureTargets.has(capture)).toBe(false);
    expect(errors).toHaveBeenCalledTimes(2);

    fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", main, player.id);
    expect(captureTargets.has(player)).toBe(true);
    errors.mockRestore();
  });

  it("forgets every captured tab when all streams stop", () => {
    manager = new AudioCaptureManagerMain();
    manager.startBroadcast();
    const tab = soundPage();
    tab.audible = true;
    offer(tab);
    fakeIpcMain.deliver("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS", mainWindow());
    expect(captureTargets.has(tab)).toBe(false);
    expect(last(sentToCapture(manager))).toEqual(["AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS"]);
    tab.play();
    expect(captureTargets.has(tab)).toBe(false);
  });

  it("does not throw for an unknown or closed tab", () => {
    manager = new AudioCaptureManagerMain();
    manager.startBroadcast();
    const closed = soundPage();
    closed.destroyed = true;
    expect(() =>
      fakeIpcMain.deliver("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", mainWindow(), 123456),
    ).not.toThrow();
    expect(() => offer(closed)).not.toThrow();
    expect(captureCommands(manager)).toEqual([["AUDIO_CAPTURE_BROADCAST_START", "performance"]]);
  });

  it("forgets a tab that is destroyed", () => {
    manager = new AudioCaptureManagerMain();
    manager.startBroadcast();
    const tab = soundPage();
    tab.audible = true;
    offer(tab);
    tab.destroy();
    expect(captureTargets.has(tab)).toBe(false);
    expect(manager._views.size).toBe(0);
  });
});

describe("AudioCaptureManagerMain: capture window isolation (SEC-12)", () => {
  it("runs the capture window sandboxed with context isolation and no Node", () => {
    manager = new AudioCaptureManagerMain();
    const prefs = windowOptions[0].webPreferences as Record<string, unknown>;
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.preload).toBe("/app/audio_capture_window/preload.js");
    expect(windowOptions[0].show).toBe(false);
  });
});
