/**
 * LyreApi across a message port, as the library's utility process serves it to the main process: the contract
 * passes through the port unchanged, faults reject, unknown methods never reach the API, and the library can ask
 * the caller's side to show a chooser.
 */
import { MessageChannel, type MessagePort } from "worker_threads";
import { afterEach, describe, expect, it } from "vitest";

import { lyreApiContract, valueOf } from "./contract";
import { createFakeLyreApi } from "./fake";
import { isLyreMethod, lyreApiOverPort, serveLyreApi, type PortLike } from "./rpc";
import type { LyreApi } from "./api";

const open: MessagePort[] = [];
function portLike(port: MessagePort): PortLike {
  open.push(port);
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      const handler = (data: unknown) => listener(data);
      port.on("message", handler);
      return () => port.off("message", handler);
    },
  };
}
function connect(api: LyreApi, host: Record<string, (...args: unknown[]) => unknown> = {}) {
  const { port1, port2 } = new MessageChannel();
  const server = serveLyreApi(api, portLike(port1));
  const client = lyreApiOverPort(portLike(port2), host);
  return { server, client };
}
afterEach(() => {
  open.splice(0).forEach((p) => p.close());
});

lyreApiContract("in-memory fake across a message port", () => {
  const { client, server } = connect(
    createFakeLyreApi({ missingTrackIds: ["t43"], folderFiles: { "D:\\Moved": ["07 Memories of Mother.flac"] } }),
  );
  return {
    api: client.api,
    newAudioFiles: ["D:\\Incoming\\Ambience\\harbour_night.wav", "D:\\Incoming\\Dune\\02 Leaving Caladan.flac"],
    notAudioFile: "D:\\Incoming\\notes.txt",
    missingTrackId: "t43",
    relinkFolder: "D:\\Moved",
    folderToWatch: "H:\\Audio\\Incoming",
    close: () => {
      client.close();
      server.close();
    },
  };
});

describe("the message protocol", () => {
  it("knows LyreApi's methods and nothing else", () => {
    expect(isLyreMethod("playlists", "addTracks")).toBe(true);
    expect(isLyreMethod("playlists", "constructor")).toBe(false);
    expect(isLyreMethod("__proto__", "toString")).toBe(false);
    expect(isLyreMethod("subscribe", "x")).toBe(false);
  });

  it("refuses a call to a method LyreApi does not have, and passes a fault on as a rejection", async () => {
    const api = createFakeLyreApi();
    const broken: LyreApi = { ...api, boards: { ...api.boards, list: async () => Promise.reject(new Error("disk I/O error")) } };
    const { port1, port2 } = new MessageChannel();
    serveLyreApi(broken, portLike(port1));
    const client = lyreApiOverPort(portLike(port2));
    await expect(client.api.boards.list()).rejects.toThrow("disk I/O error");
    const answer = new Promise((resolve) => port2.once("message", resolve));
    port2.postMessage({ t: "call", id: 99, area: "boards", method: "constructor", args: [] });
    expect(await answer).toMatchObject({ t: "fault", id: 99, message: expect.stringContaining("no boards.constructor") });
  });

  it("lets the library ask the caller's side for host work, and fails waiting calls when the library stops", async () => {
    const { server, client } = connect(createFakeLyreApi(), { chooseFolder: async () => "D:\\Albums" });
    expect(await server.askHost("chooseFolder", [])).toBe("D:\\Albums");
    await expect(server.askHost("formatDisk", [])).rejects.toThrow("cannot formatDisk");
    const { client: lost } = connect({ ...createFakeLyreApi(), campaigns: { ...createFakeLyreApi().campaigns, list: () => new Promise(() => undefined) } });
    const waiting = lost.api.campaigns.list();
    lost.failPending("Lyre's library stopped. It is starting again.");
    await expect(waiting).rejects.toThrow("starting again");
    expect(valueOf(await client.api.boards.rename("combat", "Fight")).name).toBe("Fight");
  });
});
