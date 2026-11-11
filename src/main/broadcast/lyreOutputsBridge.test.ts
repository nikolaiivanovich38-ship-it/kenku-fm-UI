/**
 * w4-outputs: the Lyre page's Outputs screen reads the bots and moves, mutes and turns them up or down through
 * LyreOutputsBridge, on channels only the Lyre page may use (SEC-8).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputManager } from "./OutputManager";
import { BotTokenStore, type SafeStorageLike } from "./botTokenStore";
import { LyreOutputsBridge } from "./lyreOutputsBridge";
import { FakeDiscord, type FakeWorld } from "./testing/fakeDiscord";
import type { DiscordDriver } from "./discordDriver";
import { fakeIpcMain, fakePage, fromMainFrame, type FakePage } from "../security/testing/fakeIpc";
import { LYRE_OUTPUTS_STATE, type LyreBotResult, type LyreOutputs } from "../../common/lyreOutputs";

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
        { id: "1011", name: "Table", members: ["Nik"] },
        { id: "1012", name: "Side room" },
      ],
    },
  ],
  usernames: { "fake-a": "Lyre Table", "fake-b": "Lyre Side" },
};

/** As the real driver: no test hook for invites, so an invite opens in the browser. */
function withoutInviteHook(driver: DiscordDriver): DiscordDriver {
  return { createClient: driver.createClient, joinVoiceChannel: driver.joinVoiceChannel };
}

let folder: string;
let manager: OutputManager;
let bridge: LyreOutputsBridge;
let lyre: FakePage;
let opened: string[];
const window = { webContents: { send: vi.fn(), isDestroyed: () => false } };
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const fromLyre = () => fromMainFrame(lyre);

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-outputs-"));
  fakeIpcMain.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  manager = new OutputManager(window as never, new BotTokenStore(BotTokenStore.fileIn(folder), safeStorage), withoutInviteHook(new FakeDiscord({ world: WORLD }).driver));
  opened = [];
  bridge = new LyreOutputsBridge(manager, { openExternal: async (url) => void opened.push(url) });
  lyre = fakePage("lyre-view");
});

afterEach(() => {
  bridge.destroy();
  manager.destroy();
  fs.rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function twoBots(): Promise<[string, string]> {
  const a = manager.state().bots[0].id;
  const b = manager.addBot();
  manager.setToken(a, "fake-a");
  manager.setToken(b, "fake-b");
  await Promise.all([manager.connect(a), manager.connect(b)]);
  await settle();
  return [a, b];
}

const pushed = (): LyreOutputs[] => lyre.send.mock.calls.filter(([channel]) => channel === LYRE_OUTPUTS_STATE).map(([, state]) => state as LyreOutputs);
const last = (): LyreOutputs | undefined => pushed()[pushed().length - 1];

describe("LyreOutputsBridge (w4-outputs)", () => {
  it("answers the Lyre page with the bots and servers, never a token", async () => {
    const [a] = await twoBots();
    const outputs = (await fakeIpcMain.invoke("LYRE_OUTPUTS_GET", fromLyre())) as LyreOutputs;
    expect(outputs.bots.map((bot) => bot.name)).toEqual(["Lyre Table", "Lyre Side"]);
    expect(outputs.bots[0]).toMatchObject({ id: a, login: "ready", room: null });
    expect(outputs.servers[0].channels.map((c) => c.name)).toEqual(["Table", "Side room"]);
    expect(JSON.stringify(outputs)).not.toContain("fake-a");
  });

  it("refuses other pages and wrong arguments", async () => {
    const [a] = await twoBots();
    await expect(fakeIpcMain.invoke("LYRE_OUTPUTS_GET", fromMainFrame(fakePage("main-window")))).rejects.toThrow();
    await expect(fakeIpcMain.invoke("LYRE_OUTPUTS_GET", fromMainFrame(fakePage("player-view")))).rejects.toThrow();
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromMainFrame(fakePage(null)), a, "1011");
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromLyre(), "../bot", "1011");
    fakeIpcMain.deliver("LYRE_OUTPUT_SET_VOLUME", fromLyre(), a, 2);
    fakeIpcMain.deliver("LYRE_OUTPUT_SET_MUTED", fromLyre(), a, "yes");
    await settle();
    expect(manager.state().bots[0]).toMatchObject({ voice: [], volume: 1, muted: false });
  });

  it("moves a bot into a room and out again, and swaps by moving both", async () => {
    const [a, b] = await twoBots();
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromLyre(), a, "1011");
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromLyre(), b, "1012");
    await settle();
    expect(manager.rooms()).toEqual([
      { botId: a, name: "Table" },
      { botId: b, name: "Side room" },
    ]);
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromLyre(), a, "1012");
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromLyre(), b, "1011");
    await settle();
    expect(manager.rooms()).toEqual([
      { botId: a, name: "Side room" },
      { botId: b, name: "Table" },
    ]);
    fakeIpcMain.deliver("LYRE_OUTPUT_LEAVE", fromLyre(), a);
    await settle();
    expect(manager.rooms()).toEqual([{ botId: b, name: "Table" }]);
  });

  it("mutes a room and sets its volume", async () => {
    const [a] = await twoBots();
    fakeIpcMain.deliver("LYRE_OUTPUT_SET_MUTED", fromLyre(), a, true);
    fakeIpcMain.deliver("LYRE_OUTPUT_SET_VOLUME", fromLyre(), a, 0.8);
    await settle();
    expect(manager.state().bots[0]).toMatchObject({ muted: true, volume: 0.8 });
  });

  it("sends the outputs to the Lyre page on every change once the page is open, and stops when it closes", async () => {
    bridge.setView(lyre as never);
    const [a] = await twoBots();
    expect(last()?.bots.map((bot) => bot.login)).toEqual(["ready", "ready"]);
    fakeIpcMain.deliver("LYRE_OUTPUT_MOVE", fromLyre(), a, "1011");
    await settle();
    expect(last()?.bots[0].room).toEqual({ serverId: "1001", channelId: "1011", status: "connected" });
    lyre.destroy();
    const before = lyre.send.mock.calls.length;
    fakeIpcMain.deliver("LYRE_OUTPUT_SET_MUTED", fromMainFrame(fakePage("lyre-view")), a, true);
    await settle();
    expect(lyre.send.mock.calls.length).toBe(before);
  });

  it("Try again joins a channel that failed once more", async () => {
    const [a] = await twoBots();
    const reconnect = vi.spyOn(manager, "reconnect");
    fakeIpcMain.deliver("LYRE_OUTPUT_RETRY", fromLyre(), a);
    expect(reconnect).toHaveBeenCalledWith(a);
  });
});

describe("LyreOutputsBridge: Settings in Lyre (OUT-8)", () => {
  it("adds a bot with its token and Application ID, answering in plain words; the page sees only the token's last four characters", async () => {
    await twoBots();
    bridge.setView(lyre as never);
    const added = (await fakeIpcMain.invoke("LYRE_BOT_ADD", fromLyre(), "fake-c.third-part.abcd", "123456789012345678")) as LyreBotResult;
    expect(added).toEqual({ ok: true, botId: expect.any(String) });
    await settle();
    const bot = last()!.bots.find((b) => added.ok && b.id === added.botId)!;
    expect(bot).toMatchObject({ tokenEnd: "abcd", applicationId: "123456789012345678", inviteUrl: expect.stringContaining("client_id=123456789012345678") });
    expect(JSON.stringify(pushed())).not.toContain("third-part");
    expect(await fakeIpcMain.invoke("LYRE_BOT_ADD", fromLyre(), "not a token", null)).toEqual({ ok: false, message: expect.stringContaining("Reset Token") });
  });

  it("replaces a token, renames, sets the Application ID, connects and disconnects a bot", async () => {
    const [, b] = await twoBots();
    expect(await fakeIpcMain.invoke("LYRE_BOT_SET_TOKEN", fromLyre(), b, "fake-b.new-part.wxyz")).toEqual({ ok: true, botId: b });
    expect(await fakeIpcMain.invoke("LYRE_BOT_RENAME", fromLyre(), b, "Side")).toEqual({ ok: true, botId: b });
    expect(await fakeIpcMain.invoke("LYRE_BOT_SET_APP_ID", fromLyre(), b, "123456789012345678")).toEqual({ ok: true, botId: b });
    await settle();
    expect(manager.state().bots[1]).toMatchObject({ name: "Side", tokenEnd: "wxyz", applicationId: "123456789012345678", status: "ready" });
    fakeIpcMain.deliver("LYRE_BOT_DISCONNECT", fromLyre(), b);
    await settle();
    expect(manager.state().bots[1].status).toBe("offline");
    fakeIpcMain.deliver("LYRE_BOT_CONNECT", fromLyre(), b);
    await settle();
    expect(manager.state().bots[1].status).toBe("ready");
  });

  it("removes a bot and puts it back with Undo", async () => {
    const [a, b] = await twoBots();
    expect(await fakeIpcMain.invoke("LYRE_BOT_REMOVE", fromLyre(), b)).toEqual({ ok: true, botId: b });
    expect(manager.state().bots.map((x) => x.id)).toEqual([a]);
    expect(await fakeIpcMain.invoke("LYRE_BOT_REMOVE", fromLyre(), a)).toEqual({ ok: false, message: expect.stringContaining("one bot at least") });
    expect(await fakeIpcMain.invoke("LYRE_BOT_RESTORE", fromLyre(), b)).toEqual({ ok: true, botId: b });
    expect(manager.state().bots.map((x) => x.id)).toEqual([a, b]);
  });

  it("opens a bot's invite in the browser, made in the main process from the Application ID alone", async () => {
    fakeIpcMain.deliver("LYRE_BOT_OPEN_INVITE", fromLyre(), "123456789012345678");
    await settle();
    expect(opened).toEqual(["https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=3146752"]);
  });

  it("refuses other pages and arguments that are not a bot, a token, a name or an Application ID", async () => {
    const [a] = await twoBots();
    await expect(fakeIpcMain.invoke("LYRE_BOT_ADD", fromMainFrame(fakePage("main-window")), "fake-x.y.z", null)).rejects.toThrow();
    await expect(fakeIpcMain.invoke("LYRE_BOT_ADD", fromLyre(), 42, null)).rejects.toThrow();
    await expect(fakeIpcMain.invoke("LYRE_BOT_SET_TOKEN", fromLyre(), "../bot", "fake-x.y.z")).rejects.toThrow();
    await expect(fakeIpcMain.invoke("LYRE_BOT_RENAME", fromLyre(), a, "x".repeat(5000))).rejects.toThrow();
    await expect(fakeIpcMain.invoke("LYRE_BOT_SET_APP_ID", fromLyre(), a, "https://evil.example")).rejects.toThrow();
    fakeIpcMain.deliver("LYRE_BOT_OPEN_INVITE", fromLyre(), "123&scope=admin");
    fakeIpcMain.deliver("LYRE_BOT_OPEN_INVITE", fromMainFrame(fakePage("player-view")), "123456789012345678");
    await settle();
    expect(opened).toEqual([]);
  });
});
