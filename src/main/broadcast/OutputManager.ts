import { ipcMain, type BrowserWindow } from "electron";
import { TypedEmitter } from "tiny-typed-emitter";
import { LOCAL_OUTPUT_ID, type OutputsState } from "../../common/outputs";
import { guardIpc } from "../security/ipcGuard";
import type { BotTokenStore } from "./botTokenStore";
import { defaultDiscordDriver, type DiscordDriver } from "./discordDriver";
import { DiscordBot } from "./DiscordBot";

interface OutputManagerEvents {
  /** True when the first output joins a voice channel, false when the last leaves (PERF-4). */
  activeChange: (active: boolean) => void;
  /** "This Computer" switched off (true) or on. */
  localMutedChange: (muted: boolean) => void;
}

/** The parts of the main window the manager uses. */
type WindowLike = Pick<BrowserWindow, "webContents">;

/**
 * OUT-1: every output the broadcast goes to: this computer's speakers and
 * any number of Discord bots, each with its own token (SEC-5), client and
 * voice connections. All outputs hear the same mix; each can be muted.
 *
 * The main window learns the state through "OUTPUTS_STATE" (never a token)
 * and changes it through the BOT_* and OUTPUT_* channels.
 */
export class OutputManager extends TypedEmitter<OutputManagerEvents> {
  readonly bots = new Map<string, DiscordBot>();
  private localMuted = false;
  /** "This Computer" was switched off by the first join, not by the user. */
  private localMutedByJoin = false;
  private wasActive = false;
  private publishQueued = false;
  private ipc = guardIpc(ipcMain);

  constructor(
    private readonly window: WindowLike,
    private readonly tokens: BotTokenStore,
    private readonly driver: DiscordDriver = defaultDiscordDriver(),
  ) {
    super();
    // There is always at least one bot to enter a token for.
    if (tokens.list().length === 0) {
      tokens.addBot();
    }
    for (const bot of tokens.list()) {
      this.createBot(bot.id);
    }
    this.ipc.handle("OUTPUTS_GET_STATE", () => this.state());
    this.ipc.on("OUTPUTS_CONNECT_SAVED", () => this.connectSaved());
    this.ipc.handle("BOT_ADD", () => this.addBot());
    this.ipc.on("BOT_REMOVE", (_event, id: string) => this.removeBot(id));
    this.ipc.handle("BOT_SET_TOKEN", (_event, id: string, token: string) => this.setToken(id, token));
    this.ipc.on("BOT_REMOVE_TOKEN", (_event, id: string) => this.removeToken(id));
    this.ipc.on("BOT_IMPORT_LEGACY_TOKEN", (_event, token: string) => this.importLegacyToken(token));
    this.ipc.on("BOT_CONNECT", (_event, id: string) => void this.connect(id));
    this.ipc.on("BOT_DISCONNECT", (_event, id: string) => this.bots.get(id)?.disconnect());
    this.ipc.on("BOT_JOIN_CHANNEL", (_event, id: string, channelId: string) => void this.bots.get(id)?.join(channelId));
    this.ipc.on("BOT_LEAVE_CHANNEL", (_event, id: string, channelId: string) => this.bots.get(id)?.leave(channelId));
    this.ipc.on("OUTPUT_SET_MUTED", (_event, outputId: string, muted: boolean) => this.setMuted(outputId, muted));
  }

  destroy(): void {
    this.ipc.dispose();
    for (const bot of this.bots.values()) {
      bot.destroy();
    }
    this.bots.clear();
    this.updateActive();
  }

  state(): OutputsState {
    const summaries = new Map(this.tokens.list().map((summary) => [summary.id, summary]));
    return {
      encryption: this.tokens.encryption,
      local: { muted: this.localMuted },
      bots: [...this.bots.values()].map((bot) => {
        const summary = summaries.get(bot.id);
        return {
          id: bot.id,
          name: summary?.name ?? "Bot",
          ...(bot.discordName ? { discordName: bot.discordName } : {}),
          hasToken: summary?.hasToken ?? false,
          tokenRemembered: summary?.tokenRemembered ?? false,
          status: bot.status,
          ...(bot.error ? { error: bot.error } : {}),
          guilds: bot.guilds,
          voice: bot.voice(),
          muted: bot.muted,
        };
      }),
    };
  }

  /** One encoded packet of the mix, for every bot in a voice channel. */
  sendPacket(packet: Buffer): void {
    for (const bot of this.bots.values()) {
      bot.sendPacket(packet);
    }
  }

  get active(): boolean {
    return [...this.bots.values()].some((bot) => bot.active);
  }

  /** At start (the Settings panel mounts), log in every bot that has a token, as before. */
  connectSaved(): void {
    for (const bot of this.bots.values()) {
      if (bot.status === "offline" && this.tokens.token(bot.id)) {
        void this.connect(bot.id);
      }
    }
  }

  addBot(): string {
    const id = this.tokens.addBot();
    this.createBot(id);
    this.publish();
    return id;
  }

  removeBot(id: string): void {
    const bot = this.bots.get(id);
    if (!bot) {
      return;
    }
    bot.destroy();
    this.bots.delete(id);
    this.tokens.removeBot(id);
    this.updateActive();
    this.publish();
  }

  /** SEC-5: store a token (encrypted, or for this session only). Returns whether it is remembered. */
  setToken(id: string, token: string): boolean {
    if (!this.bots.has(id)) {
      return false;
    }
    const remembered = this.tokens.setToken(id, token.trim());
    this.publish();
    return remembered;
  }

  removeToken(id: string): void {
    const bot = this.bots.get(id);
    if (!bot) {
      return;
    }
    bot.disconnect();
    this.tokens.removeToken(id);
    this.publish();
  }

  /**
   * SEC-5: the token Kenku FM / Cue Desk 0.1 kept in the main window's
   * storage, handed over once by the storage migration. It becomes the first
   * bot's token unless that bot already has one.
   */
  importLegacyToken(token: string): void {
    const first = [...this.bots.keys()][0] ?? this.addBot();
    if (!this.tokens.token(first)) {
      this.tokens.setToken(first, token.trim());
      this.publish();
    }
  }

  async connect(id: string): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) {
      return;
    }
    const token = this.tokens.token(id);
    if (!token) {
      this.showError("Error connecting to bot: Invalid token");
      return;
    }
    await bot.connect(token);
  }

  setMuted(outputId: string, muted: boolean): void {
    if (outputId === LOCAL_OUTPUT_ID) {
      this.localMutedByJoin = false;
      this.setLocalMuted(muted);
    } else {
      const bot = this.bots.get(outputId);
      if (bot) {
        bot.muted = muted;
      }
    }
    this.publish();
  }

  private setLocalMuted(muted: boolean) {
    if (this.localMuted !== muted) {
      this.localMuted = muted;
      this.emit("localMutedChange", muted);
    }
  }

  private createBot(id: string): DiscordBot {
    const bot = new DiscordBot(id, this.driver);
    bot.on("change", () => {
      this.updateActive();
      this.publish();
    });
    bot.on("failure", (message) => this.showError(message));
    this.bots.set(id, bot);
    return bot;
  }

  /**
   * Start or stop the broadcast as the first output joins or the last leaves.
   * As in Kenku FM's single-output mode, joining Discord switches "This
   * Computer" off (you hear the bot in Discord; both would echo), and leaving
   * the last channel switches it back on unless you changed it yourself.
   */
  private updateActive() {
    const active = this.active;
    if (active === this.wasActive) {
      return;
    }
    this.wasActive = active;
    if (active && !this.localMuted) {
      this.localMutedByJoin = true;
      this.setLocalMuted(true);
    } else if (!active && this.localMutedByJoin) {
      this.localMutedByJoin = false;
      this.setLocalMuted(false);
    }
    this.emit("activeChange", active);
  }

  private showError(message: string) {
    if (!this.window.webContents.isDestroyed()) {
      this.window.webContents.send("ERROR", message);
    }
  }

  /** Send the state once per tick, however many changes happened. */
  private publish() {
    if (this.publishQueued) {
      return;
    }
    this.publishQueued = true;
    setImmediate(() => {
      this.publishQueued = false;
      if (!this.window.webContents.isDestroyed()) {
        this.window.webContents.send("OUTPUTS_STATE", this.state());
      }
    });
  }
}
