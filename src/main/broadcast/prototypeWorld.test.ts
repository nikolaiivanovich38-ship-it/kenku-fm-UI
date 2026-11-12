/**
 * w4-outputs, test builds only: the acceptance specs (e2e/specs) run the app on the prototype's Discord: two servers,
 * six voice channels with the prototype's people, two bots (Lyre Table in Table, Lyre Side in no room) at 85 %, and a
 * hook for "a bot joins from Discord" (joinRoom) and "every bot leaves" (leaveAllRooms).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputManager } from "./OutputManager";
import { BotTokenStore, type SafeStorageLike } from "./botTokenStore";
import { wantsFakeDiscord } from "./discordDriver";
import { FakeDiscord } from "./testing/fakeDiscord";
import { PROTOTYPE_WORLD, outputsTestHook, seedPrototypeOutputs } from "./testing/prototypeWorld";
import { fakeIpcMain } from "../security/testing/fakeIpc";
import { lyreOutputsOf } from "../../common/lyreOutputs";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => false,
  encryptString: (text) => Buffer.from(text),
  decryptString: (data) => data.toString(),
};

let folder: string;
let manager: OutputManager;
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "proto-world-"));
  fakeIpcMain.reset();
  manager = new OutputManager(new BotTokenStore(BotTokenStore.fileIn(folder), safeStorage), new FakeDiscord({ world: PROTOTYPE_WORLD }).driver);
});

afterEach(() => {
  manager.destroy();
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("the prototype's Discord for the acceptance specs (test builds only)", () => {
  it("is switched on by CUE_DESK_FAKE_DISCORD=prototype in test builds only", () => {
    expect(wantsFakeDiscord({ CUE_DESK_FAKE_DISCORD: "prototype" }, true)).toBe(true);
    expect(wantsFakeDiscord({ CUE_DESK_FAKE_DISCORD: "1" }, true)).toBe(true);
    expect(wantsFakeDiscord({ CUE_DESK_FAKE_DISCORD: "prototype" }, false)).toBe(false);
  });

  it("starts with Lyre Table in Table and Lyre Side in no room, both at 85 %, on the prototype's servers", async () => {
    seedPrototypeOutputs(manager);
    await settle();
    const outputs = lyreOutputsOf(manager.state());
    expect(outputs.bots.map((b) => [b.name, b.room?.channelId ?? null, b.room?.status ?? null, b.volume])).toEqual([
      ["Lyre Table", "1011", "connected", 0.85],
      ["Lyre Side", null, null, 0.85],
    ]);
    expect(outputs.servers.map((s) => [s.name, s.channels.map((c) => c.name)])).toEqual([
      ["The Gull and Lantern", ["Table", "Side room", "Whispers", "AFK"]],
      ["Night court", ["Elysium", "Private audience"]],
    ]);
    expect(outputs.servers[0].channels[0].members).toEqual(["Nik", "Aster", "Bram", "Corin", "Dalia"]);
    expect(outputs.servers[0].channels[3].members).toEqual(["Ezra"]);
  });

  it("joins a bot to a channel by their names, as if from Discord, and takes every bot out", async () => {
    seedPrototypeOutputs(manager);
    await settle();
    const hook = outputsTestHook(manager);
    await hook.join("Lyre Side", "Whispers");
    expect(manager.rooms().map((r) => r.name)).toEqual(["Table", "Whispers"]);
    await expect(hook.join("Lyre Side", "Nowhere")).rejects.toThrow("No voice channel called Nowhere");
    hook.leaveAll();
    expect(manager.rooms()).toEqual([]);
  });
});
