import { TypedEmitter } from "tiny-typed-emitter";
import type { ErrorCause } from "../../common/errorCause";
import type { Room } from "../../common/domain/types";
import { LOCAL_OUTPUT_ID, roomsOf, type OutputsState } from "../../common/outputs";
import { applicationIdProblem, isApplicationId, tokenProblem, type LyreBotResult } from "../../common/lyreOutputs";
import type { BotTokenStore, RemovedBot } from "./botTokenStore";
import { defaultDiscordDriver, type DiscordDriver } from "./discordDriver";
import { DiscordBot, isTokenProblem } from "./DiscordBot";
import type { FeedTiming } from "./opusFeed";
import { RetryClock } from "./retryClock";

/** w51-audio: how often the log says whether the bots' players had holes. */
export const AUDIO_TIMING_LOG_MS = 60_000;

const GONE: LyreBotResult = { ok: false, message: "That bot is no longer in Lyre." };

/** UX finding 5: what Discord refusing a token means, and what to do, in plain words. */
export const TOKEN_REFUSED =
  "Discord didn't accept this token. Copy it again from the Bot page in the Discord Developer Portal.";

/** A bot's error in plain words: Discord's own wording for a refused token is replaced. */
export function plainBotError(error: string | undefined): string | undefined {
  if (error?.startsWith("Error connecting to bot: ") && isTokenProblem(new Error(error))) {
    return TOKEN_REFUSED;
  }
  return error;
}

/** What became of a token taken over from Kenku FM (importLegacyToken). */
export type LegacyTokenOutcome = "saved" | "session-only" | "not-saved" | "kept-own";

interface OutputManagerEvents {
  /** True when the first output joins a voice channel, false when the last leaves (PERF-4). */
  activeChange: (active: boolean) => void;
  /** "This Computer" switched off (true) or on. */
  localMutedChange: (muted: boolean) => void;
  /** OUT-5: a bot joined, left or moved: the rooms, first room (the table) first. */
  roomsChange: (rooms: Room[]) => void;
  /** OUT-5: a room's volume, 0 to 1, changed in the window. */
  roomVolumeChange: (roomId: string, volume: number) => void;
  /** w4-outputs: the state, once per tick of changes, for the Lyre page (LyreOutputsBridge). */
  stateChange: (state: OutputsState) => void;
  /** FND-16: the game master closed the note about the token moved from Kenku FM (SessionManager remembers it). */
  legacyTokenNoteSeen: () => void;
  /**
   * A one-time problem in plain words (no token, a join refused), and which bot it is about. Until 0.5.1 the old main
   * window showed it; the Lyre page shows each bot's lasting problem from its state on Rooms and in Settings.
   */
  problem: (message: string, cause?: ErrorCause) => void;
}

/**
 * OUT-1: every output the broadcast goes to: this computer's speakers and
 * any number of Discord bots, each with its own token (SEC-5), client and
 * voice connections. Each can be muted.
 *
 * OUT-5: every bot in a voice channel is a room, named after its channel
 * (`rooms()`), and hears its own mix: the capture window encodes one stream
 * per room and `sendPacket(packet, roomId)` gives it to that room's bot only.
 * OUT-6: `moveBot` moves a bot to another voice channel during play; its
 * room (and what it plays) stays.
 *
 * The Lyre page learns the state through LyreOutputsBridge (never a token)
 * and changes it there (LYRE_BOT_*, LYRE_OUTPUT_*). FND-16: the old main
 * window's channels (OUTPUTS_*, BOT_*, OUTPUT_*) went with it.
 */
export class OutputManager extends TypedEmitter<OutputManagerEvents> {
  readonly bots = new Map<string, DiscordBot>();
  private localMuted = false;
  /** "This Computer" was switched off by the first join, not by the user. */
  private localMutedByJoin = false;
  private wasActive = false;
  private publishQueued = false;
  /** An older version's token was taken over this session, for this session only. */
  private legacyTokenSessionOnly = false;
  /** FND-16: Settings shows the note about the token moved from Kenku FM. */
  private legacyTokenNote = false;
  /** UX finding 6: when each waiting bot or voice connection tries again. */
  private retries = new RetryClock();
  /** OUT-5: the rooms last announced, to tell when they change. */
  private lastRooms: Room[] = [];
  /** OUT-5: room volumes by bot id; a bot not listed is at full volume. */
  private volumes = new Map<string, number>();
  /** w51-audio: each bot's counts at the last log line, and the minute timer (running only while packets flow). */
  private timingLogged = new Map<string, FeedTiming>();
  private timingTimer?: ReturnType<typeof setInterval>;
  /** OUT-8: bots taken out by Remove, kept in memory (never written) until the app closes, for Remove's Undo. */
  private removed = new Map<string, { record: RemovedBot; channelId: string | null; volume: number | undefined; muted: boolean }>();

  constructor(
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
  }

  destroy(): void {
    if (this.timingTimer) clearInterval(this.timingTimer);
    this.timingTimer = undefined;
    for (const bot of this.bots.values()) {
      bot.destroy();
    }
    this.bots.clear();
    this.updateRooms();
    this.updateActive();
  }

  state(): OutputsState {
    const summaries = new Map(this.tokens.list().map((summary) => [summary.id, summary]));
    return {
      encryption: this.tokens.encryption,
      ...(this.legacyTokenSessionOnly ? { legacyTokenSessionOnly: true } : {}),
      ...(this.legacyTokenNote ? { legacyTokenNote: true as const } : {}),
      local: { muted: this.localMuted },
      bots: [...this.bots.values()].map((bot) => {
        const summary = summaries.get(bot.id);
        return {
          id: bot.id,
          name: summary?.name ?? "Bot",
          ...(bot.discordName ? { discordName: bot.discordName } : {}),
          ...(bot.lastDiscordName ? { lastDiscordName: bot.lastDiscordName } : {}),
          hasToken: summary?.hasToken ?? false,
          tokenRemembered: summary?.tokenRemembered ?? false,
          ...(summary?.tokenEnd ? { tokenEnd: summary.tokenEnd } : {}),
          ...(summary?.applicationId ? { applicationId: summary.applicationId } : {}),
          status: bot.status,
          ...(bot.error ? { error: plainBotError(bot.error) } : {}),
          ...(bot.notice ? { notice: bot.notice } : {}),
          ...(this.retries.get(bot.id) ? { retryAt: this.retries.get(bot.id) } : {}),
          guilds: bot.guilds,
          voice: bot.voice().map((session) => {
            const retryAt = this.retries.get(`${bot.id}:${session.guildId}`);
            return retryAt ? { ...session, retryAt } : session;
          }),
          muted: bot.muted,
          volume: this.roomVolume(bot.id),
        };
      }),
      rooms: this.rooms(),
    };
  }

  /** OUT-5: every bot in a voice channel, in the bots' order; the first is the table. */
  rooms(): Room[] {
    return roomsOf([...this.bots.values()].map((bot) => ({ id: bot.id, voice: bot.voice() })));
  }

  /**
   * One encoded packet of a room's mix, for that room's bot only (OUT-5).
   * A packet without a room is the table's: it goes to the first room. A
   * packet for a room that has gone is dropped, not played somewhere else.
   */
  sendPacket(packet: Buffer, roomId?: string): void {
    const rooms = this.rooms();
    const target = roomId === undefined ? rooms[0]?.botId : rooms.find((room) => room.botId === roomId)?.botId;
    if (target) {
      this.bots.get(target)?.sendPacket(packet);
      this.timingTimer ??= setInterval(() => this.logAudioTiming(), AUDIO_TIMING_LOG_MS);
    }
  }

  /** w51-audio: per bot, the packets its player was given, its holes and its drops (Save diagnostics, tests). */
  audioTiming(): Record<string, FeedTiming> {
    return Object.fromEntries([...this.bots].map(([id, bot]) => [id, bot.feed.timing()]));
  }

  /**
   * w51-audio: once a minute while packets flow, a warning in the log (so in Help › Save diagnostics) for each bot
   * whose player found no packet ready (a hole the players heard) or dropped some; nothing when all was well. The
   * timer stops after a minute without packets.
   */
  private logAudioTiming(): void {
    const parts: string[] = [];
    let packets = 0;
    for (const [id, now] of Object.entries(this.audioTiming())) {
      const before = this.timingLogged.get(id) ?? { packets: 0, holes: 0, dropped: 0 };
      const minute = { packets: now.packets - before.packets, holes: now.holes - before.holes, dropped: now.dropped - before.dropped };
      packets += minute.packets;
      if (minute.holes > 0 || minute.dropped > 0) {
        const bot = this.bots.get(id);
        const name = bot?.discordName ?? bot?.lastDiscordName ?? id;
        parts.push(`bot ${name}: ${minute.packets} packets, ${minute.holes} holes (20 ms of silence each), ${minute.dropped} dropped to keep the delay short`);
      }
      this.timingLogged.set(id, now);
    }
    if (parts.length > 0) console.warn(`Audio timing, last minute: ${parts.join("; ")}`);
    if (packets === 0 && this.timingTimer) {
      clearInterval(this.timingTimer);
      this.timingTimer = undefined;
    }
  }

  /** OUT-5: a room's volume, 0 to 1. */
  roomVolume(id: string): number {
    return this.volumes.get(id) ?? 1;
  }

  /** OUT-5: the window's volume slider for a room (a bot); applied by the capture window. */
  setRoomVolume(id: string, volume: number): void {
    if (!this.bots.has(id) || !Number.isFinite(volume)) {
      return;
    }
    const clamped = Math.max(0, Math.min(1, volume));
    this.volumes.set(id, clamped);
    this.emit("roomVolumeChange", id, clamped);
    this.publish();
  }

  /**
   * OUT-6: move a bot to another voice channel during play. Within a server
   * Discord moves it; in another server it joins there first and leaves its
   * other channels once the new one is joining, so its room (and the
   * broadcast) never goes away in between. If the new channel cannot be
   * joined the bot stays where it was, and the failure is shown as for a join.
   */
  async moveBot(id: string, channelId: string): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) {
      return;
    }
    if (bot.voice().some((session) => session.channelId === channelId && session.status !== "error")) {
      return;
    }
    const before = bot.voice().filter((session) => session.channelId !== channelId);
    await bot.join(channelId);
    const moved = bot.voice().find((session) => session.channelId === channelId);
    if (!moved || moved.status === "error") {
      if (moved && before.length > 0) {
        // A failed join in another server would show as a broken second room; the bot stays put.
        bot.leave(channelId);
      }
      return;
    }
    for (const session of before) {
      if (session.guildId !== moved.guildId) {
        bot.leave(session.channelId);
      }
    }
  }

  /** w4-outputs: take a bot out of every voice channel it is in (the Outputs screen's Leave). */
  leaveAll(id: string): void {
    const bot = this.bots.get(id);
    for (const session of bot?.voice() ?? []) {
      bot?.leave(session.channelId);
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
    this.volumes.delete(id);
    this.retries.forget(id);
    this.tokens.removeBot(id);
    this.updateRooms();
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

  // ---------- OUT-8: Settings in Lyre (the Lyre page, through lyreOutputsBridge.ts) ----------

  /**
   * Add a bot: its token (stored encrypted, SEC-5) and, when given, its Application ID; it logs in at once. The
   * shapes are checked first, so Discord only ever sees a token that could be one.
   */
  addBotWithToken(token: string, applicationId: string | null): LyreBotResult {
    const problem = tokenProblem(String(token)) ?? (applicationId === null ? null : applicationIdProblem(String(applicationId)));
    if (problem) return { ok: false, message: problem };
    const id = this.addBot();
    this.tokens.setToken(id, token.trim());
    if (applicationId !== null) this.tokens.setApplicationId(id, applicationId.trim());
    this.publish();
    void this.connect(id);
    return { ok: true, botId: id };
  }

  /** Replace…: a new token for the bot; it logs in again with it. */
  replaceToken(id: string, token: string): LyreBotResult {
    const bot = this.bots.get(id);
    if (!bot) return GONE;
    const problem = tokenProblem(String(token));
    if (problem) return { ok: false, message: problem };
    bot.disconnect();
    this.tokens.setToken(id, token.trim());
    this.publish();
    void this.connect(id);
    return { ok: true, botId: id };
  }

  renameBot(id: string, name: string): LyreBotResult {
    if (!this.bots.has(id)) return GONE;
    if (!this.tokens.rename(id, name)) return { ok: false, message: "Give the bot a name." };
    this.publish();
    return { ok: true, botId: id };
  }

  /** The bot's Application ID (null: none), for its invite link. */
  setApplicationId(id: string, applicationId: string | null): LyreBotResult {
    if (!this.bots.has(id)) return GONE;
    const problem = applicationId === null ? null : applicationIdProblem(String(applicationId));
    if (problem) return { ok: false, message: problem };
    this.tokens.setApplicationId(id, applicationId === null ? null : applicationId.trim());
    this.publish();
    return { ok: true, botId: id };
  }

  /** Remove (with Undo): the bot leaves its voice channel and logs out; restoreBot puts it back. The last bot stays. */
  removeBotForUndo(id: string): LyreBotResult {
    const bot = this.bots.get(id);
    if (!bot) return GONE;
    if (this.bots.size <= 1) return { ok: false, message: "Lyre needs one bot at least: replace its token instead." };
    const channelId = bot.voice().find((session) => session.status !== "error")?.channelId ?? null;
    const volume = this.volumes.get(id);
    const record = this.tokens.takeOut(id);
    if (!record) return GONE;
    this.removed.set(id, { record, channelId, volume, muted: bot.muted });
    bot.destroy();
    this.bots.delete(id);
    this.volumes.delete(id);
    this.retries.forget(id);
    this.updateRooms();
    this.updateActive();
    this.publish();
    return { ok: true, botId: id };
  }

  /** Remove's Undo: the bot back in its place, logged in again and back in the voice channel it was in. */
  restoreBot(id: string): LyreBotResult {
    const kept = this.removed.get(id);
    if (!kept || this.bots.has(id)) return { ok: false, message: "There is nothing to put back." };
    this.removed.delete(id);
    this.tokens.putBack(kept.record);
    // The bots' order is the store's: rebuild the map in that order with the bot in its old place.
    const order = this.tokens.list().map((b) => b.id);
    const bot = this.createBot(id);
    bot.muted = kept.muted;
    const entries = order.map((botId) => [botId, this.bots.get(botId) ?? bot] as const);
    this.bots.clear();
    for (const [botId, b] of entries) this.bots.set(botId, b);
    if (kept.volume !== undefined) this.volumes.set(id, kept.volume);
    this.publish();
    if (this.tokens.token(id)) {
      void this.connect(id).then(() => {
        if (!kept.channelId) return;
        const join = () => {
          if (bot.status !== "ready") return;
          bot.off("change", join);
          void this.moveBot(id, kept.channelId!);
        };
        bot.on("change", join);
        join();
      });
    }
    return { ok: true, botId: id };
  }

  /** Disconnect in Settings: the bot logs out (and leaves its voice channel); Connect logs it in again. */
  disconnect(id: string): void {
    this.bots.get(id)?.disconnect();
  }

  /**
   * OUT-8, test builds: the fake Discord admits a bot whose invite Lyre opened. False with the real driver: the caller
   * opens the invite in the browser.
   */
  inviteOpenedByDriver(applicationId: string): boolean {
    if (!isApplicationId(applicationId) || !this.driver.inviteOpened) return false;
    this.driver.inviteOpened(applicationId);
    return true;
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
   * SEC-5, FND-16: the token Kenku FM / Cue Desk 0.1 kept in plain text in the old main window's storage, handed over
   * once by the one-time move (legacy/oldWindowMove.ts). It becomes the first bot's token unless that bot already has
   * one. The answer tells the move whether the plain copy may go (CR51-1):
   * - "saved": encrypted and written to disk;
   * - "session-only": this computer cannot encrypt, so it is kept until Lyre closes;
   * - "not-saved": encrypted, but the file could not be written (kept until Lyre closes; the move tries again);
   * - "kept-own": the first bot already had a token, so this one was not used (nothing needs its plain copy).
   */
  importLegacyToken(token: string): LegacyTokenOutcome {
    const first = [...this.bots.keys()][0] ?? this.addBot();
    if (this.tokens.token(first)) return "kept-own";
    const remembered = this.tokens.setToken(first, token.trim());
    // WP1 review 11: the user never typed this token, so say it will be gone after a restart.
    this.legacyTokenSessionOnly = !remembered;
    this.publish();
    // The one-time move reads the old storage once the page has loaded, which can be after the start-up logins
    // (connectSaved, at ready-to-show) have run: log this bot in now, as Kenku FM did.
    void this.connect(first);
    if (remembered) return "saved";
    return this.tokens.encryption ? "not-saved" : "session-only";
  }

  /** FND-16: show (or stop showing) the note in Settings › Discord bots about the token moved from Kenku FM. */
  setLegacyTokenNote(show: boolean): void {
    if (this.legacyTokenNote === show) return;
    this.legacyTokenNote = show;
    this.publish();
  }

  /** FND-16: Got it on that note: it goes, and the listener remembers it for the next start. */
  legacyTokenNoteSeen(): void {
    const wasShown = this.legacyTokenNote;
    this.setLegacyTokenNote(false);
    if (wasShown) this.emit("legacyTokenNoteSeen");
  }

  async connect(id: string): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) {
      return;
    }
    const token = this.tokens.token(id);
    if (!token) {
      this.showError("This bot has no token yet. Paste one in Settings first.", { kind: "output", id });
      return;
    }
    await bot.connect(token);
  }

  /** OUT-2: the Reconnect button. */
  async reconnect(id: string): Promise<void> {
    const bot = this.bots.get(id);
    const token = this.tokens.token(id);
    if (!bot) {
      return;
    }
    if (!token) {
      this.showError("This bot has no token. Enter one in Settings.", { kind: "output", id });
      return;
    }
    await bot.reconnect(token);
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
      this.noteRetries(id, bot);
      // Rooms first, so the capture window knows them when the broadcast starts.
      this.updateRooms();
      this.updateActive();
      this.publish();
    });
    bot.on("failure", (message) => this.handleFailure(id, bot, message));
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

  /** OUT-5: announce the rooms when a bot joined, left or moved. */
  private updateRooms() {
    const rooms = this.rooms();
    const same =
      rooms.length === this.lastRooms.length &&
      rooms.every((room, i) => room.botId === this.lastRooms[i].botId && room.name === this.lastRooms[i].name);
    if (!same) {
      this.lastRooms = rooms;
      this.emit("roomsChange", rooms);
    }
  }

  /** UX finding 6: note when each wait of this bot started, as soon as it starts. */
  private noteRetries(id: string, bot: DiscordBot) {
    this.retries.update(id, bot.status === "connecting" ? bot.error : undefined);
    const sessions = bot.voice();
    // A voice connection that has gone leaves no stale countdown for the next one.
    this.retries.forget(id, sessions.map((session) => `${id}:${session.guildId}`));
    for (const session of sessions) {
      this.retries.update(`${id}:${session.guildId}`, session.status === "reconnecting" ? session.error : undefined);
    }
  }

  /**
   * A bot reports a failure. UX finding 5: a token Discord refused is
   * forgotten (it will not start working by itself, and keeping it showed
   * "Saved" for a token that does not work) and explained in plain words.
   */
  private handleFailure(id: string, bot: DiscordBot, message: string) {
    if (bot.status === "error" && message === bot.error && plainBotError(message) === TOKEN_REFUSED) {
      this.tokens.removeToken(id);
      this.publish();
    }
    // UX finding 4: the window closes the message once this bot's problem is fixed.
    this.showError(plainBotError(message) ?? message, { kind: "output", id });
  }

  private showError(message: string, cause?: ErrorCause) {
    this.emit("problem", message, cause);
  }

  /** Send the state once per tick, however many changes happened. */
  private publish() {
    if (this.publishQueued) {
      return;
    }
    this.publishQueued = true;
    setImmediate(() => {
      this.publishQueued = false;
      this.emit("stateChange", this.state());
    });
  }
}
