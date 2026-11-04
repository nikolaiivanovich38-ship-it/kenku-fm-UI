import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordBroadcast } from "./DiscordBroadcast";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
} from "../security/testing/fakeIpc";

const clients = vi.hoisted(() => [] as { login: ReturnType<typeof vi.fn> }[]);

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

vi.mock("discord.js", async () => {
  const { EventEmitter } = await import("events");
  class Client extends EventEmitter {
    login = vi.fn(() => new Promise(() => undefined));
    destroy = vi.fn();
    channels = { fetch: vi.fn().mockRejectedValue(new Error("Unknown Channel")) };
    constructor() {
      super();
      clients.push(this);
    }
  }
  return {
    Client,
    ChannelType: { GuildVoice: 2 },
    Events: { ClientReady: "ready" },
    GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 128 },
  };
});

let broadcast: DiscordBroadcast | undefined;
const window = { webContents: { send: vi.fn() } };

beforeEach(() => {
  fakeIpcMain.reset();
  clients.length = 0;
});

afterEach(() => {
  broadcast?.destroy();
  broadcast = undefined;
});

describe("DiscordBroadcast: who may send (SEC-8)", () => {
  it("connects when the main window asks", () => {
    broadcast = new DiscordBroadcast(window as never);
    fakeIpcMain.deliver("DISCORD_CONNECT", fromMainFrame(fakePage("main-window")), "token");
    expect(clients).toHaveLength(1);
    expect(clients[0].login).toHaveBeenCalledWith("token");
  });

  it("ignores connection requests from a website tab, the player or an embedded frame", () => {
    broadcast = new DiscordBroadcast(window as never);
    for (const event of [
      fromMainFrame(fakePage(null)),
      fromMainFrame(fakePage("player-view")),
      fromSubframe(fakePage("main-window")),
    ]) {
      fakeIpcMain.deliver("DISCORD_CONNECT", event, "token");
      expect(event.reply).not.toHaveBeenCalled();
    }
    expect(clients).toHaveLength(0);
  });

  it("ignores a token that is not text", () => {
    broadcast = new DiscordBroadcast(window as never);
    const event = fakeIpcMain.deliver(
      "DISCORD_CONNECT",
      fromMainFrame(fakePage("main-window")),
      { toString: () => "token" },
    );
    expect(event.reply).not.toHaveBeenCalled();
    expect(clients).toHaveLength(0);
  });

  it("still reports an empty token to the user", () => {
    broadcast = new DiscordBroadcast(window as never);
    const event = fakeIpcMain.deliver("DISCORD_CONNECT", fromMainFrame(fakePage("main-window")), "");
    expect(event.reply).toHaveBeenCalledWith("DISCORD_DISCONNECTED");
    expect(event.reply).toHaveBeenCalledWith("ERROR", "Error connecting to bot: Invalid token");
  });

  it("does not fail when disconnecting or leaving without a bot connected", async () => {
    broadcast = new DiscordBroadcast(window as never);
    const main = fakePage("main-window");
    await expect(broadcast._handleDisconnect(fromMainFrame(main) as never)).resolves.toBeUndefined();
    await expect(
      broadcast._handleLeaveChannel(fromMainFrame(main) as never, "123"),
    ).resolves.toBeUndefined();
  });

  it("does not fail when leaving a channel Discord does not know", async () => {
    broadcast = new DiscordBroadcast(window as never);
    const main = fakePage("main-window");
    fakeIpcMain.deliver("DISCORD_CONNECT", fromMainFrame(main), "token");
    await expect(
      broadcast._handleLeaveChannel(fromMainFrame(main) as never, "123"),
    ).resolves.toBeUndefined();
  });

  it("does not fail when joining a channel Discord does not know", async () => {
    broadcast = new DiscordBroadcast(window as never);
    const main = fakePage("main-window");
    fakeIpcMain.deliver("DISCORD_CONNECT", fromMainFrame(main), "token");
    await expect(
      broadcast._handleJoinChannel(fromMainFrame(main) as never, "123"),
    ).resolves.toBeUndefined();
  });

  it("stops listening when destroyed", () => {
    broadcast = new DiscordBroadcast(window as never);
    broadcast.destroy();
    broadcast = undefined;
    expect(fakeIpcMain.eventNames()).toEqual([]);
  });
});
