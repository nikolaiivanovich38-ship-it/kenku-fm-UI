import { Events, type Client } from "discord.js";
import {
  createAudioPlayer,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  type VoiceConnection,
  type VoiceConnectionState,
} from "@discordjs/voice";
import { TypedEmitter } from "tiny-typed-emitter";
import type { BotStatus, GuildInfo, VoiceSessionState } from "../../common/outputs";
import type { DiscordDriver } from "./discordDriver";
import { OpusPacketFeed } from "./opusFeed";

/**
 * Silent 20 ms steps the player sends before it goes idle (half a second).
 * The capture window sends no packets during silence (PERF-4), so after this
 * the bot stops "speaking" in Discord; the next sound starts it again.
 */
export const MAX_MISSED_FRAMES = 25;

/**
 * BUG-6: how long joining a voice channel may take. Before, a join that never
 * completed (for example without the Speak permission, or a blocked voice
 * server) left the interface saying "connecting" for ever.
 */
export const JOIN_TIMEOUT_MS = 15_000;

interface DiscordBotEvents {
  /** Anything shown in the interface changed. */
  change: () => void;
  /**
   * Something failed; the message is for the user, in plain language. (Not
   * called "error": an EventEmitter throws an "error" nobody listens to.)
   */
  failure: (message: string) => void;
}

/** One voice connection of this bot, in one server. */
interface VoiceSession extends VoiceSessionState {
  connection?: VoiceConnection;
  timer?: ReturnType<typeof setTimeout>;
}

/** Statuses during which the bot is (about to be) in a voice channel. */
const LIVE_VOICE: ReadonlySet<string> = new Set(["joining", "connected", "reconnecting"]);

/**
 * OUT-1: one Discord bot output, with its own client, audio player and voice
 * connections. Discord lets a bot sit in one voice channel per server, so a
 * second room in the same server needs a second bot (a second DiscordBot).
 */
export class DiscordBot extends TypedEmitter<DiscordBotEvents> {
  status: BotStatus = "offline";
  error?: string;
  discordName?: string;
  guilds: GuildInfo[] = [];
  readonly player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      maxMissedFrames: MAX_MISSED_FRAMES,
    },
  });
  readonly feed = new OpusPacketFeed(this.player);
  private client?: Client;
  /** Voice sessions by server id. */
  private sessions = new Map<string, VoiceSession>();

  constructor(
    readonly id: string,
    private readonly driver: DiscordDriver,
  ) {
    super();
    this.player.on("error", (error) => {
      console.error(error);
      this.emit("failure", error.message);
    });
  }

  get muted(): boolean {
    return this.feed.muted;
  }

  set muted(muted: boolean) {
    this.feed.muted = muted;
    this.emit("change");
  }

  /** True while the bot is in, or joining, a voice channel. */
  get active(): boolean {
    return [...this.sessions.values()].some((session) => LIVE_VOICE.has(session.status));
  }

  voice(): VoiceSessionState[] {
    return [...this.sessions.values()].map(({ guildId, channelId, channelName, status, error }) => ({
      guildId,
      channelId,
      channelName,
      status,
      ...(error ? { error } : {}),
    }));
  }

  sendPacket(packet: Buffer): void {
    if (this.active) {
      this.feed.push(packet);
    }
  }

  /** Log in with a token. An earlier connection is closed first. */
  async connect(token: string): Promise<void> {
    this.closeClient();
    this.status = "connecting";
    this.error = undefined;
    this.emit("change");

    let client: Client;
    try {
      client = this.driver.createClient();
    } catch (error) {
      this.fail(`Error connecting to bot: ${messageOf(error)}`);
      return;
    }
    this.client = client;
    client.once(Events.ClientReady, () => {
      void this.handleReady(client);
    });
    client.on("error", (error) => {
      if (this.client === client) {
        this.fail(`Error connecting to bot: ${error.message}`);
      }
    });
    try {
      await client.login(token);
    } catch (error) {
      if (this.client === client) {
        this.fail(`Error connecting to bot: ${messageOf(error)}`);
      }
    }
  }

  private async handleReady(client: Client) {
    if (this.client !== client) {
      return;
    }
    this.discordName = client.user?.username;
    this.status = "ready";
    this.emit("change");
    try {
      const guilds = await fetchGuilds(client);
      if (this.client === client) {
        this.guilds = guilds;
        this.emit("change");
      }
    } catch (error) {
      console.error("Unable to list Discord servers", error);
    }
  }

  /** Leave every voice channel and log out. */
  disconnect(): void {
    this.closeClient();
    this.status = "offline";
    this.error = undefined;
    this.emit("change");
  }

  private closeClient() {
    this.leaveAll();
    const client = this.client;
    this.client = undefined;
    this.guilds = [];
    this.discordName = undefined;
    if (client) {
      void Promise.resolve(client.destroy()).catch((error: unknown) => console.error(error));
    }
  }

  private fail(message: string) {
    this.status = "error";
    this.error = message;
    this.leaveAll();
    this.emit("change");
    this.emit("failure", message);
  }

  /**
   * Join a voice channel. In a server where this bot is already in another
   * channel it moves there (Discord allows one channel per server and bot).
   * BUG-6: every failure ends in an error the user can read.
   */
  async join(channelId: string): Promise<void> {
    const client = this.client;
    if (!client || this.status !== "ready") {
      this.emit("failure", "Connect this bot in Settings before choosing a voice channel.");
      return;
    }
    const channel = await client.channels.fetch(channelId).catch((error: unknown): null => {
      console.error(`Unable to find voice channel ${channelId}`, error);
      return null;
    });
    if (this.client !== client) {
      return;
    }
    if (!channel || !channel.isVoiceBased()) {
      this.emit("failure", "Discord could not find that voice channel. It may have been deleted; reconnect the bot to refresh the list.");
      return;
    }
    const guildId = channel.guild.id;
    const existing = this.sessions.get(guildId);
    if (existing?.channelId === channelId && LIVE_VOICE.has(existing.status)) {
      return;
    }
    if (existing) {
      this.endSession(existing);
    }
    const session: VoiceSession = {
      guildId,
      channelId,
      channelName: channel.name,
      status: "joining",
    };
    this.sessions.set(guildId, session);
    if (!channel.joinable) {
      this.voiceFail(
        session,
        `${this.discordName ?? "The bot"} cannot join “${channel.name}”: the channel is full, or the bot lacks the Connect permission there. Check the channel's permissions in Discord.`,
      );
      return;
    }
    this.emit("change");
    try {
      const connection = this.driver.joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        // OUT-1: each bot keeps its own connections; without a group two bots
        // in one server would share (and replace) one connection.
        group: this.id,
      });
      session.connection = connection;
      connection.subscribe(this.player);
      connection.on("stateChange", (_old, state) => this.handleVoiceState(session, connection, state));
      connection.on("error", (error) => {
        console.error(error);
        this.voiceFail(session, `Error connecting to voice channel “${channel.name}”: ${error.message}`);
      });
      session.timer = setTimeout(() => {
        session.timer = undefined;
        if (session.status === "joining") {
          this.voiceFail(
            session,
            `Could not join “${channel.name}” within ${JOIN_TIMEOUT_MS / 1000} seconds. Check that the bot has the Connect and Speak permissions there, then try again.`,
          );
        }
      }, JOIN_TIMEOUT_MS);
      if (connection.state.status === VoiceConnectionStatus.Ready) {
        this.handleVoiceState(session, connection, connection.state);
      }
    } catch (error) {
      this.voiceFail(session, `Error connecting to voice channel “${channel.name}”: ${messageOf(error)}`);
    }
  }

  protected handleVoiceState(session: VoiceSession, connection: VoiceConnection, state: VoiceConnectionState) {
    if (session.connection !== connection || this.sessions.get(session.guildId) !== session) {
      return;
    }
    switch (state.status) {
      case VoiceConnectionStatus.Ready:
        clearTimer(session);
        session.status = "connected";
        session.error = undefined;
        this.emit("change");
        break;
      case VoiceConnectionStatus.Disconnected:
        this.voiceFail(session, `Lost the connection to voice channel “${session.channelName}”.`);
        break;
      case VoiceConnectionStatus.Destroyed:
        // Ended by Discord (for example the channel was deleted).
        session.connection = undefined;
        this.removeSession(session);
        break;
    }
  }

  protected voiceFail(session: VoiceSession, message: string) {
    clearTimer(session);
    session.status = "error";
    session.error = message;
    destroyConnection(session);
    this.emit("change");
    this.emit("failure", message);
  }

  /**
   * Leave a voice channel. BUG-7: the connection is destroyed whatever the
   * channel's type; before, only plain voice channels were left and a Stage
   * channel stayed connected while the interface said "left".
   */
  leave(channelId: string): void {
    const session = [...this.sessions.values()].find((candidate) => candidate.channelId === channelId);
    if (session) {
      this.removeSession(session);
    }
  }

  private removeSession(session: VoiceSession) {
    this.endSession(session);
    this.sessions.delete(session.guildId);
    if (!this.active) {
      this.feed.stop();
    }
    this.emit("change");
  }

  private endSession(session: VoiceSession) {
    clearTimer(session);
    destroyConnection(session);
  }

  private leaveAll() {
    for (const session of this.sessions.values()) {
      this.endSession(session);
    }
    this.sessions.clear();
    this.feed.stop();
  }

  destroy(): void {
    this.closeClient();
    this.feed.dispose();
    this.removeAllListeners();
  }
}

function clearTimer(session: VoiceSession) {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = undefined;
  }
}

function destroyConnection(session: VoiceSession) {
  const connection = session.connection;
  session.connection = undefined;
  if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
    try {
      connection.destroy();
    } catch (error) {
      console.error("Unable to leave a voice channel", error);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The bot's servers and their voice channels, in Discord's order. */
async function fetchGuilds(client: Client): Promise<GuildInfo[]> {
  const rawGuilds = await client.guilds.fetch();
  return Promise.all(
    rawGuilds.map(async (baseGuild) => {
      const guild = await baseGuild.fetch();
      const voiceChannels: { id: string; name: string; position: number }[] = [];
      const channels = await guild.channels.fetch();
      channels.forEach((channel) => {
        if (channel && channel.isVoiceBased()) {
          voiceChannels.push({ id: channel.id, name: channel.name, position: channel.rawPosition });
        }
      });
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        voiceChannels: voiceChannels
          .sort((a, b) => a.position - b.position)
          .map(({ id, name }) => ({ id, name })),
      };
    }),
  );
}
