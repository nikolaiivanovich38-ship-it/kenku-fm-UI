import { describe, expect, it, vi } from "vitest";

import { createLyreUpdatesBridge } from "./preloadUpdates";

function fakeIpc(answer: unknown) {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  return {
    invoke: vi.fn(async () => answer),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
    emit: (channel: string, ...args: unknown[]) => listeners.get(channel)?.({}, ...args),
    listeners,
  };
}

const ERROR_STATE = { kind: "error", message: "Lyre could not check for updates: this computer seems to be offline.", failedAt: 1 };

describe("the Lyre page's automatic-updates bridge (SEC-14)", () => {
  it("asks with no arguments and passes on a well-formed state", async () => {
    const ipc = fakeIpc(ERROR_STATE);
    expect(await createLyreUpdatesBridge(ipc).get()).toEqual(ERROR_STATE);
    expect(ipc.invoke).toHaveBeenCalledWith("UPDATE_GET");
  });

  it("turns anything else into a plain failure", async () => {
    await expect(createLyreUpdatesBridge(fakeIpc({ kind: "error" })).get()).rejects.toThrow("Lyre did not answer. Try again.");
  });

  it("hears each change until it stops listening, and ignores malformed ones", () => {
    const ipc = fakeIpc(ERROR_STATE);
    const heard = vi.fn();
    const stop = createLyreUpdatesBridge(ipc).onChange(heard);
    ipc.emit("UPDATE_STATE", { kind: "checking" });
    ipc.emit("UPDATE_STATE", { kind: "nonsense" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({ kind: "checking" });
    stop();
    expect(ipc.listeners.has("UPDATE_STATE")).toBe(false);
  });

  it("FND-16: passes on whether a failure is the first to show, and asks to restart into a ready update", () => {
    const ipc = fakeIpc(ERROR_STATE);
    const heard = vi.fn();
    const bridge = createLyreUpdatesBridge(ipc);
    bridge.onChange(heard);
    ipc.emit("UPDATE_STATE", { ...ERROR_STATE, tell: true });
    ipc.emit("UPDATE_STATE", { ...ERROR_STATE, tell: "yes" });
    expect(heard.mock.calls).toEqual([[{ ...ERROR_STATE, tell: true }]]);
    bridge.restart();
    expect(ipc.send).toHaveBeenCalledWith("UPDATE_RESTART");
  });
});
