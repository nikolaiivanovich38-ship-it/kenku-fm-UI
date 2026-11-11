import { describe, expect, it, vi } from "vitest";

import { createLyreRemoteBridge } from "./preloadRemote";

const STATE = {
  enabled: true,
  running: true,
  address: "127.0.0.1",
  port: 3333,
  code: "K7QD-92XF",
  codeRemembered: true,
  homeAddress: "192.168.1.20",
};

function fakeIpc(answer: unknown = STATE) {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  return {
    invoke: vi.fn(async () => answer),
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
    emit: (channel: string, ...args: unknown[]) => listeners.get(channel)?.({}, ...args),
    listeners,
  };
}

describe("the Lyre page's remote-control settings bridge (SEC-4)", () => {
  it("gets, sets and renews the code through the three channels, passing only the change", async () => {
    const ipc = fakeIpc();
    const remote = createLyreRemoteBridge(ipc);
    expect(await remote.get()).toEqual(STATE);
    expect(ipc.invoke).toHaveBeenLastCalledWith("REMOTE_GET");
    await remote.set({ enabled: false, port: 4000 });
    expect(ipc.invoke).toHaveBeenLastCalledWith("REMOTE_SET", { enabled: false, port: 4000 });
    await remote.newCode();
    expect(ipc.invoke).toHaveBeenLastCalledWith("REMOTE_NEW_CODE");
  });

  it("passes on a refusal's reason", async () => {
    const remote = createLyreRemoteBridge(fakeIpc({ error: "Choose a port number from 1024 to 65535, for example 3333." }));
    expect(await remote.set({ port: 80 })).toEqual({ error: "Choose a port number from 1024 to 65535, for example 3333." });
  });

  it("turns a malformed answer into a plain failure", async () => {
    const remote = createLyreRemoteBridge(fakeIpc({ enabled: "yes" }));
    await expect(remote.get()).rejects.toThrow("Lyre did not answer. Try again.");
  });

  it("passes the home-network address (round 7) only as text or null", async () => {
    expect(await createLyreRemoteBridge(fakeIpc({ ...STATE, homeAddress: null })).get()).toMatchObject({ homeAddress: null });
    await expect(createLyreRemoteBridge(fakeIpc({ ...STATE, homeAddress: 42 })).get()).rejects.toThrow("Lyre did not answer");
    await expect(createLyreRemoteBridge(fakeIpc({ ...STATE, homeAddress: undefined })).get()).rejects.toThrow("Lyre did not answer");
  });

  it("tells the page when the state changes, until it stops listening", () => {
    const ipc = fakeIpc();
    const remote = createLyreRemoteBridge(ipc);
    const heard = vi.fn();
    const stop = remote.onChange(heard);
    ipc.emit("REMOTE_STATE", STATE);
    ipc.emit("REMOTE_STATE", { nonsense: true });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(STATE);
    stop();
    expect(ipc.listeners.has("REMOTE_STATE")).toBe(false);
  });
});
