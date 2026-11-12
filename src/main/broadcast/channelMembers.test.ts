/**
 * w4-outputs: the Outputs screen shows who is in each voice channel ("5 people: Nik, Aster, …"), from the people
 * Discord reports in it (bots left out), kept up to date as people come and go. Also the fake Discord's "world"
 * (servers, channels, people, bot names) that the acceptance specs use.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputManager } from "./OutputManager";
import { BotTokenStore, type SafeStorageLike } from "./botTokenStore";
import { FakeDiscord, type FakeWorld } from "./testing/fakeDiscord";
import { fakeIpcMain } from "../security/testing/fakeIpc";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text),
  decryptString: (data) => data.toString(),
};

const WORLD: FakeWorld = {
  guilds: [
    {
      id: "1001",
      name: "The Gull and Lantern",
      channels: [
        { id: "1011", name: "Table", members: ["Nik", "Aster"] },
        { id: "1012", name: "Side room" },
      ],
    },
    { id: "1002", name: "Night court", channels: [{ id: "1021", name: "Elysium" }] },
  ],
  usernames: { "fake-lyre-table": "Lyre Table" },
};

let folder: string;
let manager: OutputManager | undefined;
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "members-"));
  fakeIpcMain.reset();
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
  fs.rmSync(folder, { recursive: true, force: true });
});

async function connected(discord: FakeDiscord, token: string) {
  manager = new OutputManager(new BotTokenStore(BotTokenStore.fileIn(folder), safeStorage), discord.driver);
  const id = manager.state().bots[0].id;
  manager.setToken(id, token);
  await manager.connect(id);
  await settle();
  return { m: manager, id };
}

describe("voice channel members (w4-outputs)", () => {
  it("lists every server of the fake's world with each channel's people, and names the bot by its token", async () => {
    const { m } = await connected(new FakeDiscord({ world: WORLD }), "fake-lyre-table");
    const bot = m.state().bots[0];
    expect(bot.discordName).toBe("Lyre Table");
    expect(bot.guilds).toEqual([
      {
        id: "1001",
        name: "The Gull and Lantern",
        icon: null,
        voiceChannels: [
          { id: "1011", name: "Table", members: ["Nik", "Aster"] },
          { id: "1012", name: "Side room", members: [] },
        ],
      },
      { id: "1002", name: "Night court", icon: null, voiceChannels: [{ id: "1021", name: "Elysium", members: [] }] },
    ]);
  });

  it("leaves bots out of a channel's people, and follows people coming and going", async () => {
    const discord = new FakeDiscord({ world: WORLD });
    const { m, id } = await connected(discord, "fake-lyre-table");
    await m.moveBot(id, "1011");
    await settle();
    discord.setMembers("1012", ["Bram"]);
    await settle(400);
    const channels = m.state().bots[0].guilds[0].voiceChannels;
    expect(channels).toEqual([
      { id: "1011", name: "Table", members: ["Nik", "Aster"] },
      { id: "1012", name: "Side room", members: ["Bram"] },
    ]);
  });

  it("the default fake still has the one test server, its channels empty", async () => {
    const { m } = await connected(new FakeDiscord(), "fake-token-1");
    const bot = m.state().bots[0];
    expect(bot.discordName).toBe("Fake Bot 1");
    expect(bot.guilds.map((g) => g.name)).toEqual(["Test Server"]);
    expect(bot.guilds[0].voiceChannels[0]).toEqual({ id: "901", name: "Tavern", members: [] });
  });
});
