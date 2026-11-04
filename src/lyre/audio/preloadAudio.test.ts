import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYER_AUDIO_PORT_MESSAGE } from "../../player/engine/rooms/browserBridge";
import { createLyreAudioBridge, LYRE_AUDIO_PORT_CHANNEL, LYRE_ROOMS_CHANNEL, PORT_MESSAGE } from "./preloadAudio";

vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

class FakeIpc extends EventEmitter {
  invoke = vi.fn(async () => ({ url: "file:///ready.ogg" }));
  deliverPort(port: unknown) {
    this.emit(LYRE_AUDIO_PORT_CHANNEL, { ports: port ? [port] : [] });
  }
  deliverRooms(rooms: unknown) {
    this.emit(LYRE_ROOMS_CHANNEL, {}, rooms);
  }
}

const port = (name: string) => ({ name, close: vi.fn() });

let ipc: FakeIpc;
let posted: { message: unknown; ports: unknown[] }[];
let bridge: ReturnType<typeof createLyreAudioBridge>;

beforeEach(() => {
  ipc = new FakeIpc();
  posted = [];
  bridge = createLyreAudioBridge(ipc as never, {
    postMessage: (message: unknown, _origin: string, ports: unknown[]) => posted.push({ message, ports }),
  } as never);
});

describe("the new page's preload side of the player audio channel", () => {
  it("uses the same channel names and page message as the main process and the engine", async () => {
    const { PLAYER_AUDIO_PORT, PLAYER_ROOMS } = await import("../../main/broadcast/playerAudioBridge");
    expect(LYRE_AUDIO_PORT_CHANNEL).toBe(PLAYER_AUDIO_PORT);
    expect(LYRE_ROOMS_CHANNEL).toBe(PLAYER_ROOMS);
    expect(PORT_MESSAGE).toBe(PLAYER_AUDIO_PORT_MESSAGE);
  });

  it("holds the channel's end until the page asks, then posts it and every newer one to the page", () => {
    const a = port("a");
    ipc.deliverPort(a);
    expect(posted).toEqual([]);
    bridge.connect();
    expect(posted).toEqual([{ message: PORT_MESSAGE, ports: [a] }]);
    const b = port("b");
    ipc.deliverPort(b);
    expect(posted[1]).toEqual({ message: PORT_MESSAGE, ports: [b] });
  });

  it("closes an unused end when a newer one arrives, and ignores a message with no end", () => {
    const a = port("a");
    ipc.deliverPort(a);
    ipc.deliverPort(port("b"));
    expect(a.close).toHaveBeenCalled();
    ipc.deliverPort(null);
    bridge.connect();
    expect(posted).toHaveLength(1);
  });

  it("tells the page the rooms now and on every change, and drops anything that is not a list of rooms", () => {
    ipc.deliverRooms([{ botId: "bot-a", name: "Tavern", extra: "dropped" }]);
    const heard: unknown[] = [];
    const stop = bridge.onRooms((rooms) => heard.push(rooms));
    expect(heard).toEqual([[{ botId: "bot-a", name: "Tavern" }]]);
    ipc.deliverRooms([{ botId: 3 }]);
    ipc.deliverRooms("nonsense");
    ipc.deliverRooms([]);
    expect(heard).toEqual([[{ botId: "bot-a", name: "Tavern" }], []]);
    stop();
    ipc.deliverRooms([{ botId: "bot-b", name: "Dungeon" }]);
    expect(heard).toHaveLength(2);
  });

  it("asks the main process to prepare a file before it plays", async () => {
    expect(await bridge.media.prepare("file:///a.flac", { keepLocal: true })).toEqual({ url: "file:///ready.ogg" });
    expect(ipc.invoke).toHaveBeenCalledWith("MEDIA_PREPARE", "file:///a.flac", { keepLocal: true });
  });
});
