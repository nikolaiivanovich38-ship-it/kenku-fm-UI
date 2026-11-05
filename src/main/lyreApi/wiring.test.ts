/**
 * The main process's wiring of the library (WP5, wave 3 step 2): page calls reach the library service, its
 * events reach the Lyre page, the player may read files from the library's folders only (and waits for the
 * up-to-date list), and the old player's library is brought in once, on the new interface's first call.
 */
import path from "path";
import { describe, expect, it, vi } from "vitest";

import type { LyreEvent } from "../../common/lyre/api";
import { guardIpc, type IpcMainLike, type IpcSenderEvent } from "../security/ipcGuard";
import { TrustedContentsRegistry } from "../security/trustedContents";
import type { MediaPreparer } from "../media/mediaIpc";
import { LIBRARY_NOT_ANSWERING, wantsSeededLibrary, wireLyreLibrary, type WiredService } from "./wiring";

type Handler = (event: IpcSenderEvent, ...args: unknown[]) => unknown;

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(options: { bringInOld?: boolean; folders?: string[][] } = {}) {
  const handlers = new Map<string, Handler>();
  const ipc: IpcMainLike = {
    on: vi.fn(),
    removeListener: vi.fn(),
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel),
  };
  const registry = new TrustedContentsRegistry();
  const page = (id: number) => ({ id, isDestroyed: () => false, mainFrame: { frameTreeNodeId: id * 10 }, once: (): void => undefined });
  const lyre = page(1);
  const player = page(2);
  registry.trust(lyre, "lyre-view");
  registry.trust(player, "player-view");
  const answers = [...(options.folders ?? [["/music"]])];
  const service: WiredService = {
    call: vi.fn(async (area: string, method: string) => ({ ok: true, value: `${area}.${method}` })),
    mediaFolders: vi.fn(async () => answers.shift() ?? ["/music"]),
    bringInOldLibrary: vi.fn(async () => ({ status: "moved" }) as never),
  };
  const sent: LyreEvent[] = [];
  let allowed: () => readonly string[] = () => [];
  const media = vi.fn((folders: () => readonly string[]): MediaPreparer => {
    allowed = folders;
    return { prepare: async (address) => ({ url: `${address} in ${folders().join(",")}` }) };
  });
  const readOldLibrary = vi.fn(async () => '{"playlists":"{}"}');
  const wired = wireLyreLibrary({
    service,
    ipc: guardIpc(ipc, { registry, warn: () => undefined }),
    send: (event) => sent.push(event),
    media,
    bringInOldLibrary: options.bringInOld ?? true,
    readOldLibrary,
    log: () => undefined,
  });
  const invoke = (channel: string, sender: ReturnType<typeof page>, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!({ sender, senderFrame: sender.mainFrame }, ...args));
  return { wired, service, sent, invoke, lyre, player, readOldLibrary, allowed: () => allowed(), handlers };
}

describe("wireLyreLibrary (WP5)", () => {
  it("relays the Lyre page's calls to the library and its events to the page", async () => {
    const { wired, invoke, lyre, sent } = setup();
    expect(await invoke("LYRE_API_CALL", lyre, "boards", "list", [])).toEqual({ ok: true, value: "boards.list" });
    wired.onEvent({ type: "changed", areas: ["boards"] });
    expect(sent).toContainEqual({ type: "changed", areas: ["boards"] });
  });

  it("lets the player and the Lyre page prepare files from the library's folders, refreshed when tracks or folders change", async () => {
    const { wired, invoke, lyre, player, service } = setup({ folders: [["/music"], ["/music", "/elsewhere"]] });
    expect(await invoke("MEDIA_PREPARE", player, "file:///music/a.mp3", { keepLocal: false })).toEqual({ url: "file:///music/a.mp3 in /music" });
    wired.onEvent({ type: "changed", areas: ["playlists"] });
    expect(service.mediaFolders).toHaveBeenCalledTimes(1);
    wired.onEvent({ type: "changed", areas: ["tracks"] });
    // The next request waits for the new list, so a file just added is never refused.
    expect(await invoke("MEDIA_PREPARE", lyre, "file:///elsewhere/b.mp3", { keepLocal: false })).toEqual({ url: "file:///elsewhere/b.mp3 in /music,/elsewhere" });
  });

  it("refreshes the folders when the library is back after a restart", async () => {
    const { wired, service, allowed } = setup({ folders: [["/a"], ["/b"]] });
    await wired.ready();
    wired.onEvent({ type: "library-status", ok: true, message: "back" });
    await wired.ready();
    expect(service.mediaFolders).toHaveBeenCalledTimes(2);
    expect(allowed()).toEqual(["/b"]);
  });

  it("brings the old player's library in once, on the Lyre page's first call, without holding that call up", async () => {
    const { invoke, lyre, service, readOldLibrary, wired } = setup();
    const slow = deferred<unknown>();
    readOldLibrary.mockReturnValueOnce(slow.promise as never);
    expect(await invoke("LYRE_API_CALL", lyre, "boards", "list", [])).toMatchObject({ ok: true });
    expect(readOldLibrary).toHaveBeenCalledWith(lyre);
    slow.resolve('{"playlists":"{}"}');
    await invoke("LYRE_API_CALL", lyre, "playlists", "list", []);
    expect(await wired.oldLibraryReport()).toEqual({ status: "moved" });
    expect(service.bringInOldLibrary).toHaveBeenCalledTimes(1);
    expect(service.bringInOldLibrary).toHaveBeenCalledWith('{"playlists":"{}"}');
    expect(readOldLibrary).toHaveBeenCalledTimes(1);
  });

  it("does not bring the old library in when told not to (a seeded test library)", async () => {
    const { invoke, lyre, service, wired } = setup({ bringInOld: false });
    await invoke("LYRE_API_CALL", lyre, "boards", "list", []);
    expect(service.bringInOldLibrary).not.toHaveBeenCalled();
    expect(await wired.oldLibraryReport()).toBeNull();
  });

  it("keeps going when the old library cannot be read", async () => {
    const { invoke, lyre, readOldLibrary, wired } = setup();
    readOldLibrary.mockRejectedValueOnce(new Error("page gone"));
    expect(await invoke("LYRE_API_CALL", lyre, "boards", "list", [])).toMatchObject({ ok: true });
    expect(await wired.oldLibraryReport()).toBeNull();
  });

  it("removes its handlers when disposed", () => {
    const { wired, handlers } = setup();
    wired.dispose();
    expect(handlers.size).toBe(0);
  });
});

describe("wantsSeededLibrary (test builds only)", () => {
  it("seeds only a test build asked for the prototype's data", () => {
    expect(wantsSeededLibrary({ CUE_DESK_LYRE_SEED: "prototype" }, true)).toBe(true);
    expect(wantsSeededLibrary({ CUE_DESK_LYRE_SEED: "prototype" }, false)).toBe(false);
    expect(wantsSeededLibrary({}, true)).toBe(false);
  });
});

describe("MEDIA_PREPARE never waits for ever (security review 1)", () => {
  /** The real service over a scripted library process (as the review's probes did). */
  /** `dieOnFolders(n)`: whether the process stops instead of answering the n-th folder request. */
  async function realService(dieOnFolders: (request: number) => boolean) {
    const { EventEmitter } = await import("events");
    const { LyreLibraryService } = await import("./libraryService");
    let asked = 0;
    class Child extends EventEmitter {
      postMessage(m: { t?: string; id?: number }) {
        setTimeout(() => {
          if (m.t === "init") this.emit("message", { t: "ready" });
          if (m.t === "media-folders") {
            if (dieOnFolders(++asked)) this.emit("exit", 134);
            else this.emit("message", { t: "media-folders", id: m.id, folders: ["/music"] });
          }
        }, 5);
      }
      kill() {
        return true;
      }
    }
    let wiredRef: ReturnType<typeof wireLyreLibrary> | null = null;
    const service = new LyreLibraryService({ fork: () => new Child() as never, folder: "x", host: {}, onEvent: (e) => wiredRef?.onEvent(e), restartDelayMs: 10 });
    const handlers = new Map<string, Handler>();
    const ipc: IpcMainLike = { on: vi.fn(), removeListener: vi.fn(), handle: (c, l) => void handlers.set(c, l), removeHandler: (c) => void handlers.delete(c) };
    const registry = new TrustedContentsRegistry();
    const player = { id: 2, isDestroyed: () => false, mainFrame: { frameTreeNodeId: 20 }, once: (): void => undefined };
    registry.trust(player, "player-view");
    const wired = wireLyreLibrary({
      service,
      ipc: guardIpc(ipc, { registry, warn: () => undefined }),
      send: () => undefined,
      media: (folders) => ({ prepare: async (address) => (folders().length ? { url: address } : { error: "outside" }) }),
      bringInOldLibrary: false,
      readOldLibrary: async () => null,
      folderWaitMs: 200,
      log: () => undefined,
    });
    wiredRef = wired;
    const prepare = () => Promise.resolve(handlers.get("MEDIA_PREPARE")!({ sender: player, senderFrame: player.mainFrame } as never, "file:///music/a.mp3", { keepLocal: false }));
    return { service, wired, prepare };
  }

  const within = <T>(promise: Promise<T>, ms = 1000) =>
    Promise.race([promise, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms))]);

  it("answers a request made between two folder refreshes", async () => {
    const { service, wired, prepare } = await realService(() => false);
    service.start();
    await wired.ready();
    wired.onEvent({ type: "changed", areas: ["tracks"] });
    const answer = prepare();
    wired.onEvent({ type: "changed", areas: ["folders"] });
    expect(await within(answer)).toEqual({ url: "file:///music/a.mp3" });
  });

  it("asks again for the list when the first ask came before the library started (startLibrary wires first)", async () => {
    // No old library to bring in and no change since: nothing else would fetch the list again, and every file was
    // refused as "not answering" (found by the seeded app specs).
    const { service, prepare } = await realService(() => false);
    service.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(await within(prepare())).toEqual({ url: "file:///music/a.mp3" });
  });

  it("still answers after the library has given up, from the last list it gave", async () => {
    const { service, wired, prepare } = await realService((request) => request > 1);
    service.start();
    await wired.ready();
    wired.onEvent({ type: "changed", areas: ["tracks"] });
    await new Promise((r) => setTimeout(r, 400));
    expect(await within(prepare())).toEqual({ url: "file:///music/a.mp3" });
  });

  it("answers in plain words within its time limit when the library never gives a list", async () => {
    const handlers = new Map<string, Handler>();
    const ipc: IpcMainLike = { on: vi.fn(), removeListener: vi.fn(), handle: (c, l) => void handlers.set(c, l), removeHandler: (c) => void handlers.delete(c) };
    const registry = new TrustedContentsRegistry();
    const player = { id: 2, isDestroyed: () => false, mainFrame: { frameTreeNodeId: 20 }, once: (): void => undefined };
    registry.trust(player, "player-view");
    const prepare = vi.fn(async () => ({ url: "x" }));
    wireLyreLibrary({
      service: { call: vi.fn(), mediaFolders: () => new Promise<string[]>(() => undefined), bringInOldLibrary: vi.fn() },
      ipc: guardIpc(ipc, { registry, warn: () => undefined }),
      send: () => undefined,
      media: () => ({ prepare }),
      bringInOldLibrary: false,
      readOldLibrary: async () => null,
      folderWaitMs: 100,
      log: () => undefined,
    });
    const answer = Promise.resolve(handlers.get("MEDIA_PREPARE")!({ sender: player, senderFrame: player.mainFrame } as never, "file:///music/a.mp3", { keepLocal: false }));
    expect(await within(answer, 500)).toEqual({ error: LIBRARY_NOT_ANSWERING });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("MEDIA_PREPARE answers the Lyre page with lyre-media: addresses (security review 6)", () => {
  async function wired() {
    const { MediaGrants } = await import("../media/mediaProtocol");
    const grants = new MediaGrants();
    const handlers = new Map<string, Handler>();
    const ipc: IpcMainLike = { on: vi.fn(), removeListener: vi.fn(), handle: (c, l) => void handlers.set(c, l), removeHandler: (c) => void handlers.delete(c) };
    const registry = new TrustedContentsRegistry();
    const destroyed = new Map<number, () => void>();
    const page = (id: number) => ({
      id,
      isDestroyed: () => false,
      mainFrame: { frameTreeNodeId: id * 10 },
      once: (event: string, listener: () => void): void => void (event === "destroyed" && destroyed.set(id, listener)),
    });
    const lyre = page(1);
    const player = page(2);
    registry.trust(lyre, "lyre-view");
    registry.trust(player, "player-view");
    wireLyreLibrary({
      service: { call: vi.fn(), mediaFolders: async () => ["/music"], bringInOldLibrary: vi.fn() },
      ipc: guardIpc(ipc, { registry, warn: () => undefined }),
      send: () => undefined,
      media: () => ({ prepare: async (address) => (address.includes("bad") ? { error: "Lyre only plays files from your library folders." } : { url: address }) }),
      bringInOldLibrary: false,
      readOldLibrary: async () => null,
      grants,
      isLyrePage: (sender) => registry.roleOf(sender) === "lyre-view",
      log: () => undefined,
    });
    const prepare = (sender: ReturnType<typeof page>, address: string) =>
      Promise.resolve(handlers.get("MEDIA_PREPARE")!({ sender, senderFrame: sender.mainFrame } as never, address, { keepLocal: false })) as Promise<{ url?: string; error?: string }>;
    return { grants, prepare, lyre, player, destroyed };
  }

  it("gives the Lyre page an address for the prepared file only, and the old player its file: address as before", async () => {
    const { grants, prepare, lyre, player } = await wired();
    const answer = await prepare(lyre, "file:///music/a%20b.flac");
    expect(answer.url).toMatch(/^lyre-media:\/\//);
    expect(grants.resolve(answer.url as string)).toBe(path.normalize("/music/a b.flac"));
    expect(await prepare(player, "file:///music/a.flac")).toEqual({ url: "file:///music/a.flac" });
    expect(await prepare(lyre, "file:///music/bad.flac")).toEqual({ error: "Lyre only plays files from your library folders." });
  });

  it("drops the page's addresses when the page goes", async () => {
    const { grants, prepare, lyre, destroyed } = await wired();
    const answer = await prepare(lyre, "file:///music/a.flac");
    destroyed.get(1)?.();
    expect(grants.resolve(answer.url as string)).toBeUndefined();
  });
});
