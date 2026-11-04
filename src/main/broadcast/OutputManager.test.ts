import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceConnectionStatus } from "@discordjs/voice";
import { OutputManager } from "./OutputManager";
import { BotTokenStore, type SafeStorageLike } from "./botTokenStore";
import { JOIN_TIMEOUT_MS, RECONNECT_DELAYS_MS } from "./DiscordBot";
import { FAKE_CHANNELS, FakeDiscord } from "./testing/fakeDiscord";
import { fakeIpcMain, fakePage, fromMainFrame } from "../security/testing/fakeIpc";
import type { OutputsState } from "../../common/outputs";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const TOKEN = "fake-token-SECRET-1234567890";

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
  decryptString: (data) => Buffer.from(data.toString().slice(4), "hex").toString(),
};

let folder: string;
let discord: FakeDiscord;
let manager: OutputManager | undefined;
const window = { webContents: { send: vi.fn(), isDestroyed: () => false } };

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "outputs-"));
  discord = new FakeDiscord();
  fakeIpcMain.reset();
  window.webContents.send.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
  fs.rmSync(folder, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function newManager(storage: SafeStorageLike = safeStorage) {
  const store = new BotTokenStore(BotTokenStore.fileIn(folder), storage);
  manager = new OutputManager(window as never, store, discord.driver);
  return manager;
}

const main = () => fromMainFrame(fakePage("main-window"));

/** Let fake Discord's timers and promises run. */
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

function errorsShown(): string[] {
  return window.webContents.send.mock.calls.filter(([channel]) => channel === "ERROR").map(([, message]) => message);
}

async function connectedBot(m: OutputManager, token = TOKEN) {
  const id = m.state().bots.find((bot) => !bot.hasToken)?.id ?? m.addBot();
  m.setToken(id, token);
  await m.connect(id);
  await settle();
  return id;
}

describe("OutputManager: bot tokens (SEC-5)", () => {
  it("starts with one bot to enter a token for", () => {
    const m = newManager();
    expect(m.state().bots).toEqual([
      expect.objectContaining({ name: "Bot 1", hasToken: false, status: "offline" }),
    ]);
  });

  it("stores a token through IPC and never puts it in the state", async () => {
    const m = newManager();
    const id = m.state().bots[0].id;
    const remembered = await fakeIpcMain.invoke("BOT_SET_TOKEN", main(), id, TOKEN);
    expect(remembered).toBe(true);
    expect(m.state().bots[0]).toMatchObject({ hasToken: true, tokenRemembered: true });
    expect(JSON.stringify(m.state())).not.toContain(TOKEN);
    expect(fs.readFileSync(BotTokenStore.fileIn(folder), "utf8")).not.toContain(TOKEN);
  });

  it("says when a token is kept for this session only", async () => {
    const m = newManager({ ...safeStorage, isEncryptionAvailable: () => false });
    const id = m.state().bots[0].id;
    expect(await fakeIpcMain.invoke("BOT_SET_TOKEN", main(), id, TOKEN)).toBe(false);
    expect(m.state()).toMatchObject({ encryption: false, bots: [{ hasToken: true, tokenRemembered: false }] });
  });

  it("removes a token and logs the bot out", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    fakeIpcMain.deliver("BOT_REMOVE_TOKEN", main(), id);
    expect(m.state().bots[0]).toMatchObject({ hasToken: false, status: "offline" });
  });

  it("takes over the token an older version saved, once, for the first bot", () => {
    const m = newManager();
    fakeIpcMain.deliver("BOT_IMPORT_LEGACY_TOKEN", main(), TOKEN);
    expect(m.state().bots[0].hasToken).toBe(true);
    const id = m.state().bots[0].id;
    fakeIpcMain.deliver("BOT_IMPORT_LEGACY_TOKEN", main(), "fake-other");
    m.setToken(id, TOKEN);
    expect(m.state().bots).toHaveLength(1);
  });

  it("ignores token messages from other pages or with odd values", async () => {
    const m = newManager();
    const id = m.state().bots[0].id;
    fakeIpcMain.deliver("BOT_IMPORT_LEGACY_TOKEN", fromMainFrame(fakePage(null)), TOKEN);
    fakeIpcMain.deliver("BOT_IMPORT_LEGACY_TOKEN", main(), "   ");
    await expect(fakeIpcMain.invoke("BOT_SET_TOKEN", fromMainFrame(fakePage("player-view")), id, TOKEN)).rejects.toThrow();
    await expect(fakeIpcMain.invoke("BOT_SET_TOKEN", main(), "../bot", TOKEN)).rejects.toThrow();
    expect(m.state().bots[0].hasToken).toBe(false);
  });

  it("logs in the bots that have a token when asked at start", async () => {
    const m = newManager();
    m.setToken(m.state().bots[0].id, TOKEN);
    fakeIpcMain.deliver("OUTPUTS_CONNECT_SAVED", main());
    await settle();
    expect(m.state().bots[0]).toMatchObject({ status: "ready", discordName: "Fake Bot 1" });
    expect(m.state().bots[0].guilds[0].voiceChannels.map((channel) => channel.name)).toEqual([
      "Tavern",
      "Dungeon",
      "Stage",
      "Locked Room",
      "Silent Room",
    ]);
  });

  it("reports a refused token", async () => {
    const m = newManager();
    await connectedBot(m, "not-a-real-token");
    expect(m.state().bots[0]).toMatchObject({ status: "error" });
    expect(errorsShown()).toEqual(["Error connecting to bot: An invalid token was provided."]);
  });
});

describe("OutputManager: any number of outputs (OUT-1)", () => {
  it("lets two bots join two channels of the same server, each with its own connection", async () => {
    const m = newManager();
    const changes: boolean[] = [];
    m.on("activeChange", (active) => changes.push(active));
    const first = await connectedBot(m);
    const second = await connectedBot(m, "fake-token-2");
    fakeIpcMain.deliver("BOT_JOIN_CHANNEL", main(), first, FAKE_CHANNELS.tavern.id);
    fakeIpcMain.deliver("BOT_JOIN_CHANNEL", main(), second, FAKE_CHANNELS.dungeon.id);
    await settle();

    expect(discord.connectionsIn(FAKE_CHANNELS.tavern.id)).toHaveLength(1);
    expect(discord.connectionsIn(FAKE_CHANNELS.dungeon.id)).toHaveLength(1);
    expect(discord.connectionsIn(FAKE_CHANNELS.tavern.id)[0].joinConfig.group).toBe(first);
    expect(m.state().bots.map((bot) => bot.voice.map((session) => [session.channelName, session.status]))).toEqual([
      [["Tavern", "connected"]],
      [["Dungeon", "connected"]],
    ]);
    expect(changes).toEqual([true]);
  });

  it("moves a bot within a server instead of joining twice", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    await settle();
    await m.bots.get(id)?.join(FAKE_CHANNELS.dungeon.id);
    await settle();
    expect(discord.connectionsIn(FAKE_CHANNELS.tavern.id)).toHaveLength(0);
    expect(m.state().bots[0].voice.map((session) => session.channelName)).toEqual(["Dungeon"]);
  });

  it("sends every packet to each bot in a channel, except a muted one", async () => {
    const m = newManager();
    const first = await connectedBot(m);
    const second = await connectedBot(m, "fake-token-2");
    await m.bots.get(first)?.join(FAKE_CHANNELS.tavern.id);
    await m.bots.get(second)?.join(FAKE_CHANNELS.dungeon.id);
    await settle();
    const pushed = { first: vi.spyOn(m.bots.get(first)!.feed, "push"), second: vi.spyOn(m.bots.get(second)!.feed, "push") };
    fakeIpcMain.deliver("OUTPUT_SET_MUTED", main(), second, true);
    m.sendPacket(Buffer.from([1, 2, 3]));
    expect(pushed.first).toHaveBeenCalledTimes(1);
    expect(m.bots.get(second)!.feed.muted).toBe(true);
    expect(m.state().bots[1].muted).toBe(true);
  });

  it("switches This Computer off on the first join and back on after the last leave", async () => {
    const m = newManager();
    const local: boolean[] = [];
    m.on("localMutedChange", (muted) => local.push(muted));
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    expect(m.state().local.muted).toBe(true);
    fakeIpcMain.deliver("BOT_LEAVE_CHANNEL", main(), id, FAKE_CHANNELS.tavern.id);
    expect(m.state().local.muted).toBe(false);
    expect(local).toEqual([true, false]);
  });

  it("keeps This Computer as the user set it", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    fakeIpcMain.deliver("OUTPUT_SET_MUTED", main(), "local", false);
    expect(m.state().local.muted).toBe(false);
    m.bots.get(id)?.leave(FAKE_CHANNELS.tavern.id);
    expect(m.state().local.muted).toBe(false);
  });

  it("removes a bot with its connections and token", async () => {
    const m = newManager();
    await connectedBot(m);
    const second = await connectedBot(m, "fake-token-2");
    await m.bots.get(second)?.join(FAKE_CHANNELS.dungeon.id);
    await settle();
    fakeIpcMain.deliver("BOT_REMOVE", main(), second);
    expect(m.state().bots).toHaveLength(1);
    expect(discord.connectionsIn(FAKE_CHANNELS.dungeon.id)).toHaveLength(0);
    expect(m.active).toBe(false);
  });

  it("publishes the state to the main window", async () => {
    const m = newManager();
    m.addBot();
    await settle(5);
    const published = window.webContents.send.mock.calls.filter(([channel]) => channel === "OUTPUTS_STATE");
    expect((published[published.length - 1][1] as OutputsState).bots).toHaveLength(2);
  });
});

describe("DiscordBot: joining that fails is reported (BUG-6)", () => {
  it("says why when the bot may not join a channel", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.locked.id);
    expect(m.state().bots[0].voice).toEqual([
      expect.objectContaining({ channelName: "Locked Room", status: "error" }),
    ]);
    expect(errorsShown()[0]).toMatch(/cannot join “Locked Room”.*Connect permission/);
    expect(m.active).toBe(false);
  });

  it("gives up with a message when joining never completes", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    vi.useFakeTimers();
    await m.bots.get(id)?.join(FAKE_CHANNELS.silent.id);
    expect(m.state().bots[0].voice[0].status).toBe("joining");
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS);
    expect(m.state().bots[0].voice[0]).toMatchObject({ status: "error" });
    expect(errorsShown()[0]).toMatch(/Could not join “Silent Room” within 15 seconds/);
    expect(discord.connectionsIn(FAKE_CHANNELS.silent.id)).toHaveLength(0);
    expect(m.active).toBe(false);
  });

  it("says so when the channel no longer exists", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join("123456");
    expect(errorsShown()[0]).toMatch(/could not find that voice channel/);
  });

  it("asks to connect first when the bot is not connected", async () => {
    const m = newManager();
    await m.bots.get(m.state().bots[0].id)?.join(FAKE_CHANNELS.tavern.id);
    expect(errorsShown()[0]).toMatch(/Connect this bot in Settings/);
  });

  it("stays in its channel when moving to one it may not join", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    await settle();
    await m.bots.get(id)?.join(FAKE_CHANNELS.locked.id);
    expect(m.state().bots[0].voice).toEqual([expect.objectContaining({ channelName: "Tavern", status: "connected" })]);
    expect(errorsShown()[0]).toMatch(/cannot join “Locked Room”/);
  });

  it("can try a failed channel again", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    vi.useFakeTimers();
    await m.bots.get(id)?.join(FAKE_CHANNELS.silent.id);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS);
    vi.useRealTimers();
    await m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    await settle();
    expect(m.state().bots[0].voice).toEqual([expect.objectContaining({ channelName: "Tavern", status: "connected" })]);
  });
});

describe("DiscordBot: leaving a Stage channel (BUG-7)", () => {
  it("closes the voice connection of a Stage channel it leaves", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.stage.id);
    await settle();
    const [connection] = discord.connectionsIn(FAKE_CHANNELS.stage.id);
    expect(connection.state.status).toBe(VoiceConnectionStatus.Ready);
    fakeIpcMain.deliver("BOT_LEAVE_CHANNEL", main(), id, FAKE_CHANNELS.stage.id);
    expect(connection.state.status).toBe(VoiceConnectionStatus.Destroyed);
    expect(m.state().bots[0].voice).toEqual([]);
    expect(m.active).toBe(false);
  });
});

describe("Reconnecting (OUT-2)", () => {
  it("gets a dropped voice connection back by itself when the network returns", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    await settle();
    vi.useFakeTimers();
    discord.setNetworkDown(true);
    expect(m.state().bots[0].voice[0]).toMatchObject({ status: "reconnecting", error: expect.stringMatching(/Trying again in 1 s/) });
    // The broadcast keeps running while it tries.
    expect(m.active).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000 + 20);
    expect(m.state().bots[0].voice[0].status).toBe("reconnecting");
    discord.setNetworkDown(false);
    await vi.advanceTimersByTimeAsync(2_000 + 20);
    expect(m.state().bots[0].voice[0]).toEqual(
      expect.objectContaining({ status: "connected", channelName: "Tavern" }),
    );
    expect(m.state().bots[0].voice[0].error).toBeUndefined();
  });

  it("waits longer between attempts, then shows an error until Reconnect is pressed", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.tavern.id);
    await settle();
    vi.useFakeTimers();
    discord.setNetworkDown(true);
    const waits: string[] = [];
    for (const delay of RECONNECT_DELAYS_MS) {
      waits.push(m.state().bots[0].voice[0].error ?? "");
      await vi.advanceTimersByTimeAsync(delay + 20);
    }
    expect(waits).toEqual(RECONNECT_DELAYS_MS.map((delay) => expect.stringMatching(` in ${delay / 1000} s`)));
    expect(m.state().bots[0].voice[0]).toMatchObject({ status: "error", error: expect.stringMatching(/press Reconnect/) });
    expect(errorsShown()).toContainEqual(expect.stringMatching(/could not get it back/));
    expect(m.active).toBe(false);

    discord.setNetworkDown(false);
    fakeIpcMain.deliver("BOT_RECONNECT", main(), id);
    await vi.advanceTimersByTimeAsync(100);
    expect(m.state().bots[0].voice).toEqual([expect.objectContaining({ channelName: "Tavern", status: "connected" })]);
    expect(m.active).toBe(true);
  });

  it("reports a first login that cannot reach Discord at once (no silent retrying)", async () => {
    const m = newManager();
    const id = m.state().bots[0].id;
    m.setToken(id, TOKEN);
    discord.setNetworkDown(true);
    await m.connect(id);
    expect(m.state().bots[0]).toMatchObject({ status: "error", error: expect.stringMatching(/^Error connecting to bot: /) });
    expect(errorsShown()).toEqual([expect.stringMatching(/ENOTFOUND/)]);
    discord.setNetworkDown(false);
    fakeIpcMain.deliver("BOT_RECONNECT", main(), id);
    await settle();
    expect(m.state().bots[0].status).toBe("ready");
  });

  it("logs in again by itself after losing a working connection, but not with a refused token", async () => {
    const m = newManager();
    await connectedBot(m);
    vi.useFakeTimers();
    discord.setNetworkDown(true);
    discord.clients[0].emit("error", new Error("getaddrinfo ENOTFOUND gateway.discord.gg"));
    await vi.advanceTimersByTimeAsync(1_000 + 50);
    expect(m.state().bots[0]).toMatchObject({ status: "connecting", error: expect.stringMatching(/Cannot reach Discord/) });
    discord.setNetworkDown(false);
    await vi.advanceTimersByTimeAsync(2_000 + 50);
    expect(m.state().bots[0]).toMatchObject({ status: "ready" });
    expect(m.state().bots[0].error).toBeUndefined();

    const refused = Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" });
    const current = discord.clients[discord.clients.length - 1];
    current.emit("error", refused);
    expect(m.state().bots[0].status).toBe("error");
    const logins = discord.clients.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(discord.clients).toHaveLength(logins);
  });

  it("logs in again and rejoins the bot's channels when Reconnect is pressed after a failure", async () => {
    const m = newManager();
    const id = await connectedBot(m);
    await m.bots.get(id)?.join(FAKE_CHANNELS.dungeon.id);
    await settle();
    const client = discord.clients[0];
    client.emit("error", new Error("Shard closed"));
    expect(m.state().bots[0]).toMatchObject({ status: "connecting" });
    // The automatic attempt logs in again and rejoins the channel.
    await settle(1_200);
    expect(m.state().bots[0]).toMatchObject({ status: "ready" });
    expect(m.state().bots[0].voice).toEqual([expect.objectContaining({ channelName: "Dungeon", status: "connected" })]);
  });
});
