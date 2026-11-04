import { BrowserWindow, ipcMain } from "electron";
import { ChannelType, Client, Events } from "discord.js";
import {
  createAudioPlayer,
  NoSubscriberBehavior,
  type VoiceConnection,
} from "@discordjs/voice";
import { TypedEmitter } from "tiny-typed-emitter";
import { guardIpc } from "../security/ipcGuard";
import { defaultDiscordDriver, type DiscordDriver } from "./discordDriver";
import { OpusPacketFeed } from "./opusFeed";

/**
 * Silent 20 ms steps the player sends before it goes idle (half a second).
 * The capture window sends no packets during silence (PERF-4), so after this
 * the bot stops "speaking" in Discord; the next sound starts it again.
 */
export const MAX_MISSED_FRAMES = 25;

interface DiscordBroadcastEvents {
  /** True when the first voice connection starts, false when the last ends. */
  activeChange: (active: boolean) => void;
}

type VoiceChannel = {
  id: string;
  name: string;
  position: number;
};

type Guild = {
  id: string;
  name: string;
  icon: string;
  voiceChannels: VoiceChannel[];
};

export class DiscordBroadcast extends TypedEmitter<DiscordBroadcastEvents> {
  window: BrowserWindow;
  client?: Client;
  audioPlayer = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      maxMissedFrames: MAX_MISSED_FRAMES,
    },
  });
  /** Feeds the broadcast's Opus packets to the audio player. */
  feed = new OpusPacketFeed(this.audioPlayer);
  /** Voice connections by server (Discord allows one per bot and server). */
  connections = new Map<string, VoiceConnection>();
  /** SEC-8: message listeners that only accept the main window. */
  private ipc = guardIpc(ipcMain);

  constructor(
    window: BrowserWindow,
    private readonly driver: DiscordDriver = defaultDiscordDriver(),
  ) {
    super();
    this.window = window;
    this.ipc.on("DISCORD_CONNECT", this._handleConnect);
    this.ipc.on("DISCORD_DISCONNECT", this._handleDisconnect);
    this.ipc.on("DISCORD_JOIN_CHANNEL", this._handleJoinChannel);
    this.ipc.on("DISCORD_LEAVE_CHANNEL", this._handleLeaveChannel);
    this.audioPlayer.on("error", this._handleBroadcastError);
  }

  destroy() {
    this.ipc.dispose();
    this._leaveAll();
    this.feed.dispose();
    this.client?.destroy();
    this.client = undefined;
  }

  get active(): boolean {
    return this.connections.size > 0;
  }

  /** One encoded 20 ms packet of the broadcast mix. */
  sendPacket(packet: Buffer) {
    this.feed.push(packet);
  }

  _setConnection(guildId: string, connection: VoiceConnection | undefined) {
    const wasActive = this.active;
    if (connection) {
      this.connections.set(guildId, connection);
    } else {
      this.connections.delete(guildId);
    }
    if (wasActive !== this.active) {
      if (!this.active) {
        this.feed.stop();
      }
      this.emit("activeChange", this.active);
    }
  }

  _leaveAll() {
    for (const [guildId, connection] of [...this.connections]) {
      try {
        connection.destroy();
      } catch (error) {
        console.error("Unable to leave a voice channel", error);
      }
      this._setConnection(guildId, undefined);
    }
  }

  _handleConnect = async (event: Electron.IpcMainEvent, token: string) => {
    if (!token) {
      event.reply("DISCORD_DISCONNECTED");
      event.reply("ERROR", "Error connecting to bot: Invalid token");
      return;
    }
    if (this.client) {
      this._leaveAll();
      this.client.destroy();
      this.client = undefined;
    }

    try {
      this.client = this.driver.createClient();
      this.client.once(Events.ClientReady, async () => {
        event.reply("DISCORD_READY");
        event.reply("MESSAGE", "Connected");
        const rawGuilds = await this.client.guilds.fetch();
        const guilds: Guild[] = await Promise.all(
          rawGuilds.map(async (baseGuild) => {
            const guild = await baseGuild.fetch();
            const voiceChannels: VoiceChannel[] = [];
            const channels = await guild.channels.fetch();
            channels.forEach((channel) => {
              if (channel && channel.isVoiceBased()) {
                voiceChannels.push({
                  id: channel.id,
                  name: channel.name,
                  position: channel.rawPosition,
                });
              }
            });
            return {
              id: guild.id,
              name: guild.name,
              icon: guild.iconURL(),
              voiceChannels: voiceChannels.sort(
                (a, b) => a.position - b.position,
              ),
            };
          }),
        );
        event.reply("DISCORD_GUILDS", guilds);
      });
      this.client.on("error", (err) => {
        event.reply("DISCORD_DISCONNECTED");
        event.reply("ERROR", `Error connecting to bot: ${err.message}`);
      });
      await this.client.login(token);
    } catch (err) {
      event.reply("DISCORD_DISCONNECTED");
      event.reply("ERROR", `Error connecting to bot: ${err.message}`);
    }
  };

  _handleDisconnect = async (event: Electron.IpcMainEvent) => {
    event.reply("DISCORD_DISCONNECTED");
    event.reply("DISCORD_GUILDS", []);
    event.reply("DISCORD_CHANNEL_JOINED", "local");
    this._leaveAll();
    this.client?.destroy();
    this.client = undefined;
  };

  _handleJoinChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    if (this.client) {
      // SEC-8: an unknown channel id is logged instead of becoming an
      // unhandled error in the main process; nothing else changes.
      const channel = await this.client.channels
        .fetch(channelId)
        .catch((err: unknown): null => {
          console.error(`Unable to find voice channel ${channelId}`, err);
          return null;
        });
      if (channel && channel.isVoiceBased() && channel.joinable) {
        try {
          const connection = this.driver.joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
          });
          connection.subscribe(this.audioPlayer);
          this._setConnection(channel.guild.id, connection);
          event.reply("DISCORD_CHANNEL_JOINED", channelId);
          connection.on("error", (e) => {
            console.error(e);
            connection.destroy();
            this._setConnection(channel.guild.id, undefined);
            event.reply("DISCORD_CHANNEL_LEFT", channelId);
            event.reply(
              "ERROR",
              `Error connecting to voice channel: ${e.message}`,
            );
          });
        } catch (e) {
          console.error(e);
          event.reply("DISCORD_CHANNEL_LEFT", channelId);
          event.reply(
            "ERROR",
            `Error connecting to voice channel: ${e.message}`,
          );
        }
      }
    } else {
      event.reply("DISCORD_CHANNEL_LEFT", channelId);
      event.reply(
        "ERROR",
        `Unable to join voice channel. This channel might be full or this bot might not have permission to join.`,
      );
    }
  };

  /**
   * Leave a voice channel. SEC-8: an unknown channel or a missing bot is
   * logged instead of becoming an unhandled error in the main process.
   */
  _handleLeaveChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    try {
      const channel = await this.client?.channels.fetch(channelId);
      if (!channel) {
        return;
      }
      if (channel.type === ChannelType.GuildVoice) {
        const connection = this.connections.get(channel.guild.id);
        connection?.destroy();
        this._setConnection(channel.guild.id, undefined);
      }
      event.reply("DISCORD_CHANNEL_LEFT", channelId);
    } catch (err) {
      console.error(`Unable to leave voice channel ${channelId}`, err);
    }
  };

  _handleBroadcastError = (error: Error) => {
    this.window.webContents.send("ERROR", error.message);
    console.error(error);
  };
}
