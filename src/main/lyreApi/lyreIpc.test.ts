/**
 * LYRE_API_CALL (SEC-8): only the Lyre page may call the library, only LyreApi's own methods, with a list of
 * arguments of sensible size; the call reaches the library service unchanged and its answer comes back.
 */
import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../security/ipcChannels";
import { guardIpc, type IpcMainLike, type IpcSenderEvent } from "../security/ipcGuard";
import { TrustedContentsRegistry } from "../security/trustedContents";
import { MAX_CALL_BYTES, registerLyreApiIpc } from "./lyreIpc";

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
  const lyre = page(1);
  const player = page(2);
  registry.trust(lyre, "lyre-view");
  registry.trust(player, "audio-capture");
  const call = vi.fn(async (area: string, method: string, args: unknown[]) => ({ ok: true, value: [area, method, args], changed: [], undoLabel: null }));
  const unregister = registerLyreApiIpc(guardIpc(ipc, { registry, warn: () => undefined }), call);
  const send = (sender: ReturnType<typeof page>, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get("LYRE_API_CALL")!({ sender, senderFrame: sender.mainFrame }, ...args));
  return { handlers, call, lyre, player, send, unregister };
}

describe("LYRE_API_CALL (WP5)", () => {
  it("passes the Lyre page's call to the library and answers what the library answered", async () => {
    const { lyre, send, call } = setup();
    expect(await send(lyre, "playlists", "addTracks", ["p1", ["t1", "t2"], 0])).toMatchObject({ ok: true, value: ["playlists", "addTracks", ["p1", ["t1", "t2"], 0]] });
    expect(call).toHaveBeenCalledWith("playlists", "addTracks", ["p1", ["t1", "t2"], 0]);
  });

  it("is refused from any other page", async () => {
    const { player, send, call } = setup();
    await expect(send(player, "boards", "list", [])).rejects.toThrow("refused");
    expect(call).not.toHaveBeenCalled();
  });

  it("checks its arguments: a LyreApi method, and a list of arguments of sensible size", async () => {
    const { lyre, send, call } = setup();
    for (const args of [
      ["boards", "constructor", []],
      ["__proto__", "list", []],
      ["boards", "list"],
      ["boards", "list", "not a list"],
      ["boards", "list", [], "extra"],
      ["tags", "tagTracks", [{ trackIds: ["x".repeat(MAX_CALL_BYTES)] }]],
    ]) {
      await expect(send(lyre, ...args), JSON.stringify(args).slice(0, 60)).rejects.toThrow("refused");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses values that are not plain data, which JSON would count as {} (security review 10)", async () => {
    const { lyre, send, call } = setup();
    for (const value of [new ArrayBuffer(64), new Map([["a", 1]]), new Set([1]), new Uint8Array(4), new Date(0), { nested: new Map() }, [new ArrayBuffer(1)]]) {
      await expect(send(lyre, "library", "updateTrack", ["t1", value]), Object.prototype.toString.call(value)).rejects.toThrow("refused");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("lets a 5,000-track change through", async () => {
    const { lyre, send } = setup();
    const trackIds = Array.from({ length: 5000 }, (_, i) => `track-${i}-0123456789abcdef`);
    await expect(send(lyre, "tags", "tagTracks", [{ trackIds, add: [{ group: "mood", value: "Eerie" }] }])).resolves.toMatchObject({ ok: true });
  });

  it("is listed for the Lyre page only, and removed again on dispose", () => {
    expect(IPC_CHANNELS.LYRE_API_CALL.from).toEqual(["lyre-view"]);
    const { handlers, unregister } = setup();
    unregister();
    expect(handlers.has("LYRE_API_CALL")).toBe(false);
  });
});
