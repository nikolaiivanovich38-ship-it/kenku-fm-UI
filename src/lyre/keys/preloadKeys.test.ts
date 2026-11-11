import { describe, expect, it, vi } from "vitest";

import { createLyreKeysBridge } from "./preloadKeys";

function fakeIpc(answer: unknown = { refused: [] }) {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  return {
    invoke: vi.fn(async () => answer),
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
    emit: (channel: string, ...args: unknown[]) => listeners.get(channel)?.({}, ...args),
    listeners,
  };
}

describe("the Lyre page's bridge for keys in other programs (UX-12)", () => {
  it("asks the main process to register the two keys, and passes back its refusals", async () => {
    const refused = [{ action: "nextScene", key: "F9", message: "Another program already uses F9 everywhere, so Next scene works only in Lyre." }];
    const ipc = fakeIpc({ refused });
    const keys = createLyreKeysBridge(ipc);
    expect(await keys.setGlobal({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } })).toEqual({ refused });
    expect(ipc.invoke).toHaveBeenCalledWith("LYRE_GLOBAL_KEYS_SET", { on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } });
  });

  it("turns an answer of another shape into a plain failure", async () => {
    await expect(createLyreKeysBridge(fakeIpc({ refused: [{ action: "undo" }] })).setGlobal({ on: false, keys: {} })).rejects.toThrow("Lyre did not answer");
  });

  it("passes on each press of the two actions only, until it stops listening", () => {
    const ipc = fakeIpc();
    const keys = createLyreKeysBridge(ipc);
    const heard = vi.fn();
    const stop = keys.onGlobal(heard);
    ipc.emit("LYRE_GLOBAL_KEY", "nextScene");
    ipc.emit("LYRE_GLOBAL_KEY", "rm -rf");
    ipc.emit("LYRE_GLOBAL_KEY", "fadeAll");
    expect(heard.mock.calls).toEqual([["nextScene"], ["fadeAll"]]);
    stop();
    expect(ipc.listeners.has("LYRE_GLOBAL_KEY")).toBe(false);
  });
});
