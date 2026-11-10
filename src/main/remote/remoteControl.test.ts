import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerRequests } from "./playerRequests";
import { RemoteControl, type RemoteState } from "./remoteControl";
import { RemoteSettingsStore } from "./remoteSettings";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const noEncryption = {
  isEncryptionAvailable: () => false,
  encryptString: (): Buffer => Buffer.alloc(0),
  decryptString: () => "",
};

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let folder: string;
let store: RemoteSettingsStore;
let remote: RemoteControl;
let requests: PlayerRequests;
let changes: RemoteState[];
const sent: string[] = [];
const view = { isDestroyed: () => false, send: (channel: string) => sent.push(channel) };

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-remote-control-"));
  store = new RemoteSettingsStore(RemoteSettingsStore.fileIn(folder), noEncryption);
  requests = new PlayerRequests(50);
  changes = [];
  sent.length = 0;
  remote = new RemoteControl({
    store,
    host: { getView: () => view as never, requests },
    onChange: (state) => changes.push(state),
  });
});

afterEach(async () => {
  await remote.close();
  requests.destroy();
  fs.rmSync(folder, { recursive: true, force: true });
});

const next = (port: number, code: string, address = "127.0.0.1") =>
  fetch(`http://${address}:${port}/v1/playlist/playback/next`, { method: "POST", headers: { authorization: `Bearer ${code}` } });

describe("RemoteControl (SEC-4)", () => {
  it("stays off until it is turned on", async () => {
    const state = await remote.start();
    expect(state).toMatchObject({ enabled: false, running: false, address: "127.0.0.1", port: 3333 });
    expect(remote.listeningAddresses()).toEqual([]);
  });

  it("when turned on listens on 127.0.0.1 only and answers only with the code", async () => {
    const port = await freePort();
    const state = await remote.set({ enabled: true, port });
    expect(state).toMatchObject({ enabled: true, running: true, port, code: store.code(), codeRemembered: false });
    expect(remote.listeningAddresses()).toEqual([`127.0.0.1:${port}`]);

    expect((await next(port, "WRONG")).status).toBe(401);
    expect((await next(port, store.code())).status).toBe(200);
    expect(sent).toEqual(["PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT"]);
  });

  it("starts by itself after a restart when it was left on", async () => {
    const port = await freePort();
    store.update({ enabled: true, port });
    const state = await remote.start();
    expect(state.running).toBe(true);
    expect((await next(port, store.code())).status).toBe(200);
  });

  it("closes the port when turned off, and keeps it closed", async () => {
    const port = await freePort();
    await remote.set({ enabled: true, port });
    const state = await remote.set({ enabled: false });
    expect(state).toMatchObject({ enabled: false, running: false });
    await expect(next(port, store.code())).rejects.toThrow();
  });

  it("a new code works at once and the old one stops working", async () => {
    const port = await freePort();
    await remote.set({ enabled: true, port });
    const old = store.code();
    const state = await remote.newCode();
    expect(state.code).not.toBe(old);
    expect((await next(port, old)).status).toBe(401);
    expect((await next(port, state.code)).status).toBe(200);
  });

  it("moves to a new port while on", async () => {
    const first = await freePort();
    await remote.set({ enabled: true, port: first });
    const second = await freePort();
    await remote.set({ port: second });
    await expect(next(first, store.code())).rejects.toThrow();
    expect((await next(second, store.code())).status).toBe(200);
  });

  it("says in plain words when the port is taken, and is not running", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const { port } = blocker.address() as net.AddressInfo;
    try {
      const state = (await remote.set({ enabled: true, port })) as RemoteState;
      expect(state).toMatchObject({ enabled: true, running: false });
      expect(state.problem).toBe(
        `Another program is already using port ${port}. Choose another port in Settings, or close that program.`,
      );
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("refuses a bad address with its reason and changes nothing", async () => {
    const answer = await remote.set({ enabled: true, address: "attacker.example" });
    expect(answer).toEqual({ error: expect.stringMatching(/address in numbers/) });
    expect(remote.state()).toMatchObject({ enabled: false, running: false, address: "127.0.0.1" });
  });

  it("tells its owner after every change", async () => {
    const port = await freePort();
    await remote.set({ enabled: true, port });
    await remote.set({ enabled: false });
    expect(changes.map((state) => state.running)).toEqual([true, false]);
  });

  it("close() stops listening but keeps the setting on for the next start", async () => {
    const port = await freePort();
    await remote.set({ enabled: true, port });
    await remote.close();
    expect(remote.listeningAddresses()).toEqual([]);
    expect(store.settings().enabled).toBe(true);
  });

  it("says this computer's home-network address, for Settings' Your home network (round 7), or null without one", async () => {
    expect(remote.state().homeAddress).toBeNull();
    const home = new RemoteControl({ store, host: { getView: () => view as never, requests }, homeAddress: () => "192.168.1.20" });
    expect(home.state().homeAddress).toBe("192.168.1.20");
    await home.close();
  });

  it("does not offer an address that is not a private one, whatever it is told", async () => {
    const odd = new RemoteControl({ store, host: { getView: () => view as never, requests }, homeAddress: () => "0.0.0.0" });
    expect(odd.state().homeAddress).toBeNull();
    await odd.close();
  });
});
