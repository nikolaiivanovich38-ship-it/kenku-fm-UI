/**
 * LyreApi in the page, over the preload's IPC bridge: the contract passes through it (here against the fake on the
 * "main process" side), events arrive, and a fault rejects with the main process's own words.
 */
import { describe, expect, it } from "vitest";

import { lyreApiContract } from "../../common/lyre/contract";
import { createFakeLyreApi } from "../../common/lyre/fake";
import type { LyreApi } from "../../common/lyre/api";
import { ipcLyreApi } from "./ipcClient";
import { createLyreApiBridge, LYRE_API_CALL_CHANNEL, LYRE_API_EVENT_CHANNEL, type IpcRendererLike } from "./preloadApi";

/** ipcRenderer, wired as the main process would be: calls answered by `api`, its events sent back. */
function ipcFor(api: LyreApi, fault?: string): IpcRendererLike {
  const listeners = new Set<(event: unknown, ...args: unknown[]) => void>();
  api.subscribe((event) => setTimeout(() => listeners.forEach((l) => l({}, structuredClone(event))), 0));
  return {
    on: (channel, listener) => channel === LYRE_API_EVENT_CHANNEL && listeners.add(listener),
    off: (_channel, listener) => listeners.delete(listener as never),
    invoke: async (channel, area, method, args) => {
      if (channel !== LYRE_API_CALL_CHANNEL) throw new Error("wrong channel");
      if (fault) throw new Error(`Error invoking remote method 'LYRE_API_CALL': Error: ${fault}`);
      const target = (api as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[area as string];
      return structuredClone(await target[method as string](...(structuredClone(args) as unknown[])));
    },
  };
}

lyreApiContract("in-memory fake through the page's IPC bridge", () => ({
  api: ipcLyreApi(createLyreApiBridge(ipcFor(createFakeLyreApi({ missingTrackIds: ["t43"], folderFiles: { "D:\\Moved": ["07 Memories of Mother.flac"] } })))),
  newAudioFiles: ["D:\\Incoming\\Ambience\\harbour_night.wav", "D:\\Incoming\\Dune\\02 Leaving Caladan.flac"],
  notAudioFile: "D:\\Incoming\\notes.txt",
  missingTrackId: "t43",
  relinkFolder: "D:\\Moved",
  folderToWatch: "H:\\Audio\\Incoming",
}));

describe("the page's IPC bridge", () => {
  it("rejects a fault with the main process's own words", async () => {
    const api = ipcLyreApi(createLyreApiBridge(ipcFor(createFakeLyreApi(), "Lyre's library stopped unexpectedly and is starting again.")));
    await expect(api.boards.list()).rejects.toThrow(/^Lyre's library stopped unexpectedly and is starting again\.$/);
  });

  it("passes only events through, and stops on unsubscribe", async () => {
    const listeners: ((event: unknown, ...args: unknown[]) => void)[] = [];
    const bridge = createLyreApiBridge({ on: (_c, l) => listeners.push(l), off: () => listeners.splice(0), invoke: async () => null });
    const seen: unknown[] = [];
    const stop = bridge.onEvent((e) => seen.push(e));
    listeners.forEach((l) => l({}, "not an event"));
    listeners.forEach((l) => l({}, { type: "changed", areas: ["boards"] }));
    expect(seen).toEqual([{ type: "changed", areas: ["boards"] }]);
    stop();
    expect(listeners).toHaveLength(0);
  });
});
