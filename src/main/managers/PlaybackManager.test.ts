/**
 * OUT-5: PlaybackManager joins the outputs to the capture window: the rooms
 * and their volumes go to the capture window, and each room's packets come
 * back to that room's bot.
 */
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({ outputs: [] as unknown[], capture: [] as unknown[], bridges: [] as unknown[], lyreOutputs: [] as unknown[] }));

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/lyre-test" }, safeStorage: {} }));
vi.mock("../broadcast/botTokenStore", () => ({
  BotTokenStore: class {
    static fileIn() {
      return "/tmp/lyre-test/discord-bots.json";
    }
  },
}));
vi.mock("../broadcast/OutputManager", async () => {
  const { EventEmitter } = await import("events");
  return {
    OutputManager: class extends EventEmitter {
      sendPacket = vi.fn();
      rooms = vi.fn(() => []);
      roomVolume = vi.fn(() => 1);
      destroy = vi.fn();
      constructor() {
        super();
        made.outputs.push(this);
      }
    },
  };
});
vi.mock("../broadcast/playerAudioBridge", () => ({
  PlayerAudioBridge: class {
    setCapture = vi.fn();
    setPlayer = vi.fn();
    setLyre = vi.fn();
    setRooms = vi.fn();
    destroy = vi.fn();
    constructor() {
      made.bridges.push(this);
    }
  },
}));
vi.mock("../broadcast/lyreOutputsBridge", () => ({
  LyreOutputsBridge: class {
    setView = vi.fn();
    destroy = vi.fn();
    constructor(readonly outputs: unknown) {
      made.lyreOutputs.push(this);
    }
  },
}));
vi.mock("./AudioCaptureManagerMain", async () => {
  const { EventEmitter } = await import("events");
  return {
    AudioCaptureManagerMain: class extends EventEmitter {
      startBroadcast = vi.fn();
      stopBroadcast = vi.fn();
      setLocalMuted = vi.fn();
      setRooms = vi.fn();
      setRoomVolume = vi.fn();
      destroy = vi.fn();
      _browserWindow = { webContents: { id: 42 } };
      constructor() {
        super();
        made.capture.push(this);
      }
    },
  };
});

import { PlaybackManager } from "./PlaybackManager";

type Mocked = EventEmitter & Record<string, ReturnType<typeof vi.fn>>;

let outputs: Mocked;
let capture: Mocked;
let bridge: Record<string, ReturnType<typeof vi.fn>>;
let playback: PlaybackManager;

beforeEach(() => {
  made.outputs.length = 0;
  made.capture.length = 0;
  made.bridges.length = 0;
  made.lyreOutputs.length = 0;
  playback = new PlaybackManager({} as never);
  outputs = made.outputs[0] as Mocked;
  capture = made.capture[0] as Mocked;
  bridge = made.bridges[0] as typeof bridge;
});

describe("PlaybackManager rooms (OUT-5)", () => {
  it("sends each room's packet to that room's bot", () => {
    const packet = Buffer.from([1, 2, 3]);
    capture.emit("packet", packet, "bot-b");
    capture.emit("packet", packet, undefined);
    expect(outputs.sendPacket.mock.calls).toEqual([
      [packet, "bot-b"],
      [packet, undefined],
    ]);
  });

  it("tells the capture window the rooms whenever they change", () => {
    outputs.emit("roomsChange", [
      { botId: "bot-a", name: "Tavern" },
      { botId: "bot-b", name: "Dungeon" },
    ]);
    expect(capture.setRooms).toHaveBeenCalledWith(["bot-a", "bot-b"]);
  });

  it("passes a room's volume on to the capture window", () => {
    outputs.emit("roomVolumeChange", "bot-b", 0.3);
    expect(capture.setRoomVolume).toHaveBeenCalledWith("bot-b", 0.3);
  });

  it("still starts and stops the broadcast with the first join and the last leave (PERF-4)", () => {
    outputs.emit("activeChange", true);
    outputs.emit("activeChange", false);
    expect(capture.startBroadcast).toHaveBeenCalledTimes(1);
    expect(capture.stopBroadcast).toHaveBeenCalledTimes(1);
  });
});

describe("PlaybackManager player channel (OUT-5, PRV-1)", () => {
  it("joins the capture window to the player channel", () => {
    expect(bridge.setCapture).toHaveBeenCalledWith({ id: 42 });
  });

  it("gives the registered player page the other end", () => {
    const view = { id: 7 };
    playback.setPlayerView(view as never);
    expect(bridge.setPlayer).toHaveBeenCalledWith(view);
  });

  it("tells the player page the rooms", () => {
    const rooms = [{ botId: "bot-a", name: "Tavern" }];
    outputs.emit("roomsChange", rooms);
    expect(bridge.setRooms).toHaveBeenCalledWith(rooms);
  });

  it("closes the channel when destroyed", () => {
    playback.destroy();
    expect(bridge.destroy).toHaveBeenCalled();
  });
});

describe("PlaybackManager and the Lyre page's Outputs screen (w4-outputs)", () => {
  it("gives the Lyre page the outputs when it opens, and stops when destroyed", () => {
    const lyre = made.lyreOutputs[0] as { outputs: unknown; setView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    expect(lyre.outputs).toBe(outputs);
    const view = { id: 9 };
    playback.setLyreView(view as never);
    expect(lyre.setView).toHaveBeenCalledWith(view);
    playback.destroy();
    expect(lyre.destroy).toHaveBeenCalled();
  });
});
