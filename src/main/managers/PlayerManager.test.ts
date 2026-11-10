import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerManager } from "./PlayerManager";
import { RemoteSettingsStore } from "../remote/remoteSettings";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
  type FakePage,
} from "../security/testing/fakeIpc";

const { PLAYER_URL } = vi.hoisted(() => {
  const entries = {
    PLAYER_URL: "file:///app/player_window/index.html",
  };
  Object.assign(globalThis, {
    PLAYER_WINDOW_WEBPACK_ENTRY: entries.PLAYER_URL,
  });
  return entries;
});

const pages = vi.hoisted(() => new Map<number, unknown>());

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return {
    ipcMain: fakeIpcMain,
    webContents: {
      fromId: (id: number) => pages.get(id),
      getAllWebContents: () => [...pages.values()],
    },
    BrowserWindow: { getAllWindows: (): unknown[] => [] },
  };
});

const noEncryption = {
  isEncryptionAvailable: () => false,
  encryptString: (): Buffer => Buffer.alloc(0),
  decryptString: () => "",
};

let manager: PlayerManager | undefined;
let main: FakePage;
let dataFolder: string;
let remoteStore: RemoteSettingsStore;

beforeEach(() => {
  fakeIpcMain.reset();
  pages.clear();
  main = fakePage("main-window");
  dataFolder = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-player-manager-"));
  remoteStore = new RemoteSettingsStore(RemoteSettingsStore.fileIn(dataFolder), noEncryption);
});

afterEach(async () => {
  await manager?.destroy();
  manager = undefined;
  fs.rmSync(dataFolder, { recursive: true, force: true });
});

function newManager() {
  return new PlayerManager({ remoteStore, homeAddress: () => "192.168.1.20" });
}

/** A player view created by BrowserViewManagerMain and known to Electron. */
function playerView() {
  const view = fakePage("player-view");
  pages.set(view.id, view);
  return view;
}

describe("PlayerManager: main window requests (SEC-8)", () => {
  it("tells the main window where the player page is", () => {
    manager = newManager();
    expect(fakeIpcMain.deliver("PLAYER_GET_URL", fromMainFrame(main)).returnValue).toBe(PLAYER_URL);
  });

  it("does not reveal app paths to a website tab or an embedded frame", () => {
    manager = newManager();
    const tab = fromMainFrame(fakePage(null));
    expect(fakeIpcMain.deliver("PLAYER_GET_URL", tab).returnValue).toBe("");
    expect(fakeIpcMain.deliver("PLAYER_GET_URL", fromSubframe(main)).returnValue).toBe("");
  });

  it("registers the player view the main window created", () => {
    manager = newManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), view.id);
    expect(manager.getView()).toBe(view);
  });

  it("refuses to register a website tab, an unknown id or a bad id as the player", () => {
    manager = newManager();
    const tab = fakePage(null);
    pages.set(tab.id, tab);
    for (const id of [tab.id, 987654, "1", 1.5, -1]) {
      fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), id);
    }
    expect(manager.registeredViewId).toBeUndefined();
    expect(manager.getView()).toBeUndefined();
  });

  it("ignores registration from a website tab", () => {
    manager = newManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(fakePage(null)), view.id);
    expect(manager.getView()).toBeUndefined();
  });

  it("returns nothing once the player view has been closed", () => {
    manager = newManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), view.id);
    view.destroyed = true;
    expect(manager.getView()).toBeUndefined();
  });

  it("does not start the remote API for a website tab or with bad arguments", () => {
    manager = newManager();
    const start = vi.spyOn(manager, "startRemote").mockImplementation(() => undefined);
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(fakePage(null)), "0.0.0.0", "3333");
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(main), "0.0.0.0", 3333);
    expect(start).not.toHaveBeenCalled();
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(main), "127.0.0.1", "3333");
    expect(start).toHaveBeenCalledWith("127.0.0.1", "3333");
  });

  it("stops listening when destroyed", async () => {
    manager = newManager();
    await manager.destroy();
    manager = undefined;
    expect(fakeIpcMain.eventNames()).toEqual([]);
    expect([...fakeIpcMain.handlers.keys()]).toEqual([]);
  });
});

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("PlayerManager: remote-control settings over IPC (SEC-4)", () => {
  const lyre = () => {
    const page = fakePage("lyre-view");
    pages.set(page.id, page);
    return page;
  };

  it("tells the Lyre page the settings and the secret code", async () => {
    manager = newManager();
    expect(await fakeIpcMain.invoke("REMOTE_GET", fromMainFrame(lyre()))).toEqual({
      enabled: false,
      running: false,
      address: "127.0.0.1",
      port: 3333,
      code: remoteStore.code(),
      codeRemembered: false,
      homeAddress: "192.168.1.20",
    });
  });

  it("never tells the main window, a website tab, the old player, the capture window or an embedded frame", async () => {
    manager = newManager();
    for (const sender of [fromMainFrame(main), fromMainFrame(fakePage(null)), fromMainFrame(fakePage("player-view")), fromMainFrame(fakePage("audio-capture")), fromSubframe(lyre())]) {
      await expect(fakeIpcMain.invoke("REMOTE_GET", sender)).rejects.toThrow();
      await expect(fakeIpcMain.invoke("REMOTE_NEW_CODE", sender)).rejects.toThrow();
      await expect(fakeIpcMain.invoke("REMOTE_SET", sender, { enabled: true })).rejects.toThrow();
    }
    expect(remoteStore.settings().enabled).toBe(false);
  });

  it("turns the remote on and off from the Lyre page, and says so to the pages", async () => {
    manager = newManager();
    const page = lyre();
    const port = await freePort();
    const on = await fakeIpcMain.invoke("REMOTE_SET", fromMainFrame(page), { enabled: true, port });
    expect(on).toMatchObject({ enabled: true, running: true, port });
    expect(page.send).toHaveBeenCalledWith("REMOTE_STATE", expect.objectContaining({ running: true }));
    const off = await fakeIpcMain.invoke("REMOTE_SET", fromMainFrame(page), { enabled: false });
    expect(off).toMatchObject({ enabled: false, running: false });
  });

  it("answers a refused address with the reason", async () => {
    manager = newManager();
    expect(await fakeIpcMain.invoke("REMOTE_SET", fromMainFrame(lyre()), { address: "evil.example" })).toEqual({
      error: expect.stringMatching(/address in numbers/),
    });
  });

  it("refuses settings of the wrong shape", async () => {
    manager = newManager();
    const sender = fromMainFrame(lyre());
    for (const bad of [
      [],
      [null],
      ["on"],
      [{ enabled: "yes" }],
      [{ port: "3333" }],
      [{ port: 3.5 }],
      [{ address: 127 }],
      [{ address: "x".repeat(65) }],
      [{ enabled: true, code: "AAAA" }],
      [{ enabled: true }, "extra"],
    ]) {
      await expect(fakeIpcMain.invoke("REMOTE_SET", sender, ...bad), JSON.stringify(bad)).rejects.toThrow();
    }
  });

  it("makes a new secret code on request", async () => {
    manager = newManager();
    const old = remoteStore.code();
    const state = (await fakeIpcMain.invoke("REMOTE_NEW_CODE", fromMainFrame(lyre()))) as { code: string };
    expect(state.code).not.toBe(old);
    expect(remoteStore.code()).toBe(state.code);
  });

  it("keeps Start Remote in the old Settings working, and Stop Remote turns it off", async () => {
    manager = newManager();
    const port = await freePort();
    fakeIpcMain.deliver("PLAYER_START_REMOTE", fromMainFrame(main), "127.0.0.1", String(port));
    await vi.waitFor(() => expect(manager!.remote.state()).toMatchObject({ enabled: true, running: true, port }));
    fakeIpcMain.deliver("PLAYER_STOP_REMOTE", fromMainFrame(main));
    await vi.waitFor(() => expect(manager!.remote.state()).toMatchObject({ enabled: false, running: false }));
  });

  it("after a reload, the next window's remote waits for the last one to close and takes the same port", async () => {
    const port = await freePort();
    remoteStore.update({ enabled: true, port });
    manager = newManager();
    await vi.waitFor(() => expect(manager!.remote.state().running).toBe(true));
    void manager.destroy();
    manager = newManager();
    await vi.waitFor(() => expect(manager!.remote.state().running).toBe(true));
    expect(manager.remote.state().problem).toBeUndefined();
  });

  it("starts the remote by itself when it was left on, and closes it when the window goes", async () => {
    const port = await freePort();
    remoteStore.update({ enabled: true, port });
    manager = newManager();
    await vi.waitFor(() => expect(manager!.remote.state().running).toBe(true));
    await manager.destroy();
    expect(manager.remote.listeningAddresses()).toEqual([]);
    expect(remoteStore.settings().enabled).toBe(true);
    manager = undefined;
  });
});

describe("PlayerManager: saving the player's changes before the app closes (PERF-6, review 7)", () => {
  function registeredPlayer() {
    manager ??= newManager();
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), view.id);
    return view;
  }

  /** Whether `promise` has settled after pending callbacks have run. */
  async function settled(promise: Promise<unknown>) {
    let done = false;
    void promise.then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    return done;
  }

  it("asks the player to save and waits for its answer", async () => {
    const view = registeredPlayer();
    const saved = manager!.saveBeforeClose();
    expect(view.send).toHaveBeenCalledWith("PLAYER_SAVE_NOW");
    expect(await settled(saved)).toBe(false);

    fakeIpcMain.deliver("PLAYER_SAVED", fromMainFrame(view));

    expect(await settled(saved)).toBe(true);
  });

  it("does not take an answer from another page or an embedded frame", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = registeredPlayer();
    const saved = manager!.saveBeforeClose();
    fakeIpcMain.deliver("PLAYER_SAVED", fromMainFrame(main));
    fakeIpcMain.deliver("PLAYER_SAVED", fromMainFrame(fakePage(null)));
    fakeIpcMain.deliver("PLAYER_SAVED", fromSubframe(view));
    fakeIpcMain.deliver("PLAYER_SAVED", fromMainFrame(view), "extra");
    expect(await settled(saved)).toBe(false);
    fakeIpcMain.deliver("PLAYER_SAVED", fromMainFrame(view));
    expect(await settled(saved)).toBe(true);
    warn.mockRestore();
  });

  it("closes anyway when the player does not answer within the time limit", async () => {
    vi.useFakeTimers();
    try {
      registeredPlayer();
      const saved = manager!.saveBeforeClose(1000);
      await vi.advanceTimersByTimeAsync(999);
      expect(await settled(saved)).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await settled(saved)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait when there is no player view, or it has gone", async () => {
    manager = newManager();
    expect(await settled(manager.saveBeforeClose())).toBe(true);
    const view = registeredPlayer();
    view.destroyed = true;
    expect(await settled(manager!.saveBeforeClose())).toBe(true);
  });
});


// --- Rooms and buses ---
describe("PlayerManager: the player page's audio channel (OUT-5, PRV-1)", () => {
  it("says when the player page is registered, and only for the player page", () => {
    manager = newManager();
    const registered: unknown[] = [];
    manager.onRegisterView = (view) => registered.push(view);
    const tab = fakePage(null);
    pages.set(tab.id, tab);
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), tab.id);
    const view = playerView();
    fakeIpcMain.deliver("PLAYER_REGISTER_VIEW", fromMainFrame(main), view.id);
    expect(registered).toEqual([view]);
  });
});
