import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../security/ipcChannels";
import { guardIpc, IpcMainLike, IpcSenderEvent } from "../security/ipcGuard";
import { TrustedContentsRegistry } from "../security/trustedContents";
import { registerMediaIpc } from "./mediaIpc";

type Handler = (event: IpcSenderEvent, ...args: unknown[]) => unknown;

function setup() {
  const handlers = new Map<string, Handler>();
  const ipc: IpcMainLike = {
    on: vi.fn(),
    removeListener: vi.fn(),
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel),
  };
  const registry = new TrustedContentsRegistry();
  const page = (id: number) => ({ id, isDestroyed: () => false, mainFrame: { frameTreeNodeId: id * 10 }, once: (): void => undefined });
  const player = page(1);
  const mainWindow = page(2);
  const lyre = page(3);
  registry.trust(player, "lyre-view");
  registry.trust(mainWindow, "main-window");
  registry.trust(lyre, "lyre-view");
  const guard = guardIpc(ipc, { registry, warn: () => undefined });
  const media = { prepare: vi.fn(async () => ({ url: "file:///cache/x.flac" })) };
  const unregister = registerMediaIpc(guard, media, () => undefined);
  const send = (sender: ReturnType<typeof page>, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get("MEDIA_PREPARE")!({ sender, senderFrame: sender.mainFrame }, ...args));
  return { handlers, media, player, mainWindow, lyre, send, unregister };
}

describe("MEDIA_PREPARE (BUG-10, PLY-11)", () => {
  it("answers the player with the address to play", async () => {
    const { media, player, send } = setup();
    expect(await send(player, "file:///music/old.wma", { keepLocal: false })).toEqual({ url: "file:///cache/x.flac" });
    expect(media.prepare).toHaveBeenCalledWith("file:///music/old.wma", { keepLocal: false }, expect.objectContaining({ id: expect.any(Number) }));
  });

  it("answers the new interface page too, which hosts the engine in wave 3", async () => {
    const { media, lyre, send } = setup();
    expect(await send(lyre, "file:///music/old.wma", { keepLocal: true })).toEqual({ url: "file:///cache/x.flac" });
    expect(media.prepare).toHaveBeenCalledWith("file:///music/old.wma", { keepLocal: true }, expect.objectContaining({ id: expect.any(Number) }));
  });

  it("is refused from any other page", async () => {
    const { mainWindow, send, media } = setup();
    await expect(send(mainWindow, "file:///music/old.wma", { keepLocal: false })).rejects.toThrow("refused");
    expect(media.prepare).not.toHaveBeenCalled();
  });

  it("checks its arguments: an address and only the keepLocal choice", async () => {
    const { player, send, media } = setup();
    for (const args of [
      [42, { keepLocal: false }],
      ["file:///a.wma"],
      ["file:///a.wma", { keepLocal: "yes" }],
      ["file:///a.wma", { keepLocal: true, output: "C:\\Windows" }],
      ["file:///a.wma", null],
      ["x".repeat(IPC_MAX + 1), { keepLocal: false }],
      ["file:///a.wma", { keepLocal: false }, "extra"],
    ]) {
      await expect(send(player, ...args), JSON.stringify(args).slice(0, 80)).rejects.toThrow("refused");
    }
    expect(media.prepare).not.toHaveBeenCalled();
  });

  it("answers a plain message instead of failing when preparing throws", async () => {
    const { media, player, send } = setup();
    media.prepare.mockRejectedValueOnce(new Error("EACCES: permission denied, open 'C:\\secret'"));
    expect(await send(player, "file:///music/a.wma", { keepLocal: false })).toEqual({ error: "This file could not be prepared for playing." });
  });

  it("is listed for the Lyre page only, and removed again on dispose", () => {
    expect(IPC_CHANNELS.MEDIA_PREPARE.from).toEqual(["lyre-view"]);
    const { handlers, unregister } = setup();
    unregister();
    expect(handlers.has("MEDIA_PREPARE")).toBe(false);
  });
});

const IPC_MAX = 2 * 1024 * 1024;
