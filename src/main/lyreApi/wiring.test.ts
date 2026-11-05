/**
 * The main process's wiring of the library (WP5, wave 3 step 2): page calls reach the library service, its
 * events reach the Lyre page, the player may read files from the library's folders only (and waits for the
 * up-to-date list), and the old player's library is brought in once, on the new interface's first call.
 */
import { describe, expect, it, vi } from "vitest";

import type { LyreEvent } from "../../common/lyre/api";
import { guardIpc, type IpcMainLike, type IpcSenderEvent } from "../security/ipcGuard";
import { TrustedContentsRegistry } from "../security/trustedContents";
import type { MediaPreparer } from "../media/mediaIpc";
import { wantsSeededLibrary, wireLyreLibrary, type WiredService } from "./wiring";

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
