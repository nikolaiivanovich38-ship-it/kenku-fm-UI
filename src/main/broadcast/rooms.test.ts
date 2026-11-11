/**
 * OUT-5, OUT-6: rooms on the main process. Every bot in a voice channel is a
 * room; each room's encoded mix goes to its own bot; a bot can be moved to
 * another voice channel during play; each room has a volume.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputManager } from "./OutputManager";
import { oldWindowCall } from "./testing/oldWindowCalls";
import { BotTokenStore, type SafeStorageLike } from "./botTokenStore";
import { FAKE_CHANNELS, FAKE_OTHER_SERVER, FakeDiscord } from "./testing/fakeDiscord";
import { fakeIpcMain } from "../security/testing/fakeIpc";
import type { Room } from "../../common/domain";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
  decryptString: (data) => Buffer.from(data.toString().slice(4), "hex").toString(),
};

let folder: string;
let discord: FakeDiscord;
let manager: OutputManager | undefined;
/** The one-time problems the manager reported ("problem"; until 0.5.1 the old main window showed them). */
let problems: [string, unknown][] = [];
const window = { webContents: { send: vi.fn(), isDestroyed: () => false } };

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "rooms-"));
  discord = new FakeDiscord({ otherServer: true });
  fakeIpcMain.reset();
  window.webContents.send.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
  fs.rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function newManager() {
  manager = new OutputManager(new BotTokenStore(BotTokenStore.fileIn(folder), safeStorage), discord.driver);
  problems = [];
  manager.on("problem", (message, cause) => problems.push([message, cause]));
  return manager;
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

function errorsShown(): string[] {
  return problems.map(([message]) => message);
}

async function connectedBot(m: OutputManager, token: string) {
  const id = m.state().bots.find((bot) => !bot.hasToken)?.id ?? m.addBot();
  m.setToken(id, token);
  await m.connect(id);
  await settle();
  return id;
}

/** Two bots: the first in the Tavern (the table), the second in the Dungeon. */
async function twoRooms() {
  const m = newManager();
  const table = await connectedBot(m, "fake-token-1");
  const side = await connectedBot(m, "fake-token-2");
  await m.bots.get(table)!.join(FAKE_CHANNELS.tavern.id);
  await m.bots.get(side)!.join(FAKE_CHANNELS.dungeon.id);
  await settle();
  return { m, table, side };
}

describe("Rooms (OUT-5): every bot in a voice channel is a room", () => {
  it("lists a room per bot in a voice channel, named after the channel, first bot first", async () => {
    const { m, table, side } = await twoRooms();
    expect(m.rooms()).toEqual<Room[]>([
      { botId: table, name: "Tavern" },
      { botId: side, name: "Dungeon" },
    ]);
  });

  it("a room appears when its bot joins and disappears when it leaves", async () => {
    const m = newManager();
    const seen: Room[][] = [];
    m.on("roomsChange", (rooms) => seen.push(rooms));
    const id = await connectedBot(m, "fake-token-1");
    await m.bots.get(id)!.join(FAKE_CHANNELS.tavern.id);
    await settle();
    m.bots.get(id)!.leave(FAKE_CHANNELS.tavern.id);
    expect(seen).toEqual([[{ botId: id, name: "Tavern" }], []]);
  });

  it("puts the rooms in the outputs state for the window", async () => {
    const { m, table } = await twoRooms();
    expect(m.state().rooms?.[0]).toEqual({ botId: table, name: "Tavern" });
  });

  it("drops a removed bot's room", async () => {
    const { m, table, side } = await twoRooms();
    oldWindowCall(manager!, "BOT_REMOVE", side);
    expect(m.rooms()).toEqual([{ botId: table, name: "Tavern" }]);
  });
});

describe("One mix per room (OUT-5): each room's packets go to its own bot", () => {
  it("sends a room's packet to that room's bot only", async () => {
    const { m, table, side } = await twoRooms();
    const pushed = { table: vi.spyOn(m.bots.get(table)!.feed, "push"), side: vi.spyOn(m.bots.get(side)!.feed, "push") };
    m.sendPacket(Buffer.from([1, 2, 3]), side);
    expect(pushed.side).toHaveBeenCalledTimes(1);
    expect(pushed.table).not.toHaveBeenCalled();
  });

  it("sends a packet with no room to the first room (the table), not to every bot", async () => {
    const { m, table, side } = await twoRooms();
    const pushed = { table: vi.spyOn(m.bots.get(table)!.feed, "push"), side: vi.spyOn(m.bots.get(side)!.feed, "push") };
    m.sendPacket(Buffer.from([1, 2, 3]));
    expect(pushed.table).toHaveBeenCalledTimes(1);
    expect(pushed.side).not.toHaveBeenCalled();
  });

  it("drops packets for a room that has gone instead of playing them elsewhere", async () => {
    const { m, table, side } = await twoRooms();
    const pushed = vi.spyOn(m.bots.get(table)!.feed, "push");
    m.bots.get(side)!.leave(FAKE_CHANNELS.dungeon.id);
    m.sendPacket(Buffer.from([1, 2, 3]), side);
    m.sendPacket(Buffer.from([1, 2, 3]), "bot-unknown");
    expect(pushed).not.toHaveBeenCalled();
  });

  it("keeps per-bot mute (WP2): a muted room's packets are not played", async () => {
    const { m, side } = await twoRooms();
    oldWindowCall(manager!, "OUTPUT_SET_MUTED", side, true);
    const before = discord.connectionsIn(FAKE_CHANNELS.dungeon.id)[0].packets.length;
    m.sendPacket(Buffer.from([1, 2, 3, 4]), side);
    await settle(60);
    expect(discord.connectionsIn(FAKE_CHANNELS.dungeon.id)[0].packets.filter((p) => p.data.length > 3).length).toBe(
      before,
    );
  });
});

describe("Room volume (OUT-5)", () => {
  it("sets a room's volume from the main window and says so to the capture side", async () => {
    const { m, side } = await twoRooms();
    const changes: [string, number][] = [];
    m.on("roomVolumeChange", (id, volume) => changes.push([id, volume]));
    oldWindowCall(manager!, "ROOM_SET_VOLUME", side, 0.4);
    expect(m.state().bots.find((bot) => bot.id === side)?.volume).toBe(0.4);
    expect(changes).toEqual([[side, 0.4]]);
    expect(m.roomVolume(side)).toBe(0.4);
  });

  it("starts every room at full volume", async () => {
    const { m, table } = await twoRooms();
    expect(m.roomVolume(table)).toBe(1);
  });

});

describe("Moving a bot to another channel during play (OUT-6)", () => {
  it("moves a bot within a server: same room, new name, the broadcast never stops", async () => {
    const { m, side } = await twoRooms();
    const active: boolean[] = [];
    m.on("activeChange", (value) => active.push(value));
    oldWindowCall(manager!, "BOT_MOVE_TO_CHANNEL", side, FAKE_CHANNELS.stage.id);
    await settle();
    expect(m.rooms()[1]).toEqual({ botId: side, name: "Stage" });
    expect(discord.connectionsIn(FAKE_CHANNELS.dungeon.id)).toHaveLength(0);
    expect(discord.connectionsIn(FAKE_CHANNELS.stage.id)).toHaveLength(1);
    expect(active).toEqual([]);
  });

  it("moves a bot to another server: it leaves the first server's channel once it is joining the new one", async () => {
    const { m, side } = await twoRooms();
    const active: boolean[] = [];
    m.on("activeChange", (value) => active.push(value));
    await m.moveBot(side, FAKE_OTHER_SERVER.hall.id);
    await settle();
    expect(m.state().bots[1].voice.map((session) => [session.channelName, session.status])).toEqual([
      ["Hall", "connected"],
    ]);
    expect(discord.connectionsIn(FAKE_CHANNELS.dungeon.id)).toHaveLength(0);
    expect(m.rooms()[1]).toEqual({ botId: side, name: "Hall" });
    expect(active).toEqual([]);
  });

  it("stays where it is when the new channel cannot be joined, and says why", async () => {
    const { m, side } = await twoRooms();
    await m.moveBot(side, FAKE_CHANNELS.locked.id);
    await settle();
    expect(m.rooms()[1]).toEqual({ botId: side, name: "Dungeon" });
    expect(errorsShown().some((message) => /cannot join .Locked Room/.test(message))).toBe(true);
  });

  it("keeps the room in another server when the new server's channel cannot be found", async () => {
    const { m, side } = await twoRooms();
    await m.moveBot(side, "999");
    await settle();
    expect(m.rooms()[1]).toEqual({ botId: side, name: "Dungeon" });
  });

  it("does nothing for a bot already in that channel", async () => {
    const { m, side } = await twoRooms();
    const before = discord.connections.length;
    await m.moveBot(side, FAKE_CHANNELS.dungeon.id);
    expect(discord.connections.length).toBe(before);
    expect(m.rooms()[1].name).toBe("Dungeon");
  });

  it("joins the channel when the bot was in none", async () => {
    const m = newManager();
    const id = await connectedBot(m, "fake-token-1");
    await m.moveBot(id, FAKE_CHANNELS.tavern.id);
    await settle();
    expect(m.rooms()).toEqual([{ botId: id, name: "Tavern" }]);
  });

  it("asks to connect a bot first", async () => {
    const m = newManager();
    await m.moveBot(m.state().bots[0].id, FAKE_CHANNELS.tavern.id);
    expect(errorsShown()).toContain("Connect this bot in Settings before choosing a voice channel.");
  });

});
