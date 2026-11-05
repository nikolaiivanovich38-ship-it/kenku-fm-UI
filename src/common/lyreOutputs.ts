/**
 * w4-outputs: what the new interface's Outputs screen (and the rail's "Outputs (n/m)") learns about the Discord bots.
 * The main process turns its OutputsState into this shape (`lyreOutputsOf`) and sends it to the Lyre page on
 * LYRE_OUTPUTS_STATE; the page changes it with the LYRE_OUTPUT_* channels (src/main/broadcast/lyreOutputsBridge.ts).
 * Never holds a token (SEC-5).
 */
import type { BotState, BotStatus, OutputsState, VoiceSessionState, VoiceStatus } from "./outputs";

/** Main → Lyre page: the outputs, now and on every change. */
export const LYRE_OUTPUTS_STATE = "LYRE_OUTPUTS_STATE";

/** The channel a bot is in (its room), or tried to join and could not. */
export interface LyreBotRoom {
  serverId: string;
  channelId: string;
  status: VoiceStatus;
  /** Plain words when `status` is "error" or "reconnecting". */
  error?: string;
}

export interface LyreBot {
  id: string;
  /** Its Discord name once logged in ("Lyre Table"), else its own ("Bot 2"). */
  name: string;
  /** Logged in to Discord ("ready"), on the way, out, or refused. */
  login: BotStatus;
  /** Plain words for a login problem. */
  error?: string;
  room: LyreBotRoom | null;
  muted: boolean;
  /** The room's volume, 0 to 1. */
  volume: number;
  /** The servers this bot can join channels in. */
  serverIds: string[];
}

export interface LyreVoiceChannel {
  id: string;
  name: string;
  /** People in it now (not bots). */
  members: string[];
}

export interface LyreServer {
  id: string;
  name: string;
  channels: LyreVoiceChannel[];
}

export interface LyreOutputs {
  /** In the bots' order; the first bot in a room plays the table. */
  bots: LyreBot[];
  /** Every server a logged-in bot sees, in the order first seen. */
  servers: LyreServer[];
}

export const NO_OUTPUTS: LyreOutputs = { bots: [], servers: [] };

/** Voice statuses in which the bot is (about to be) heard in its channel. Matches roomsOf in outputs.ts. */
const IN_ROOM: ReadonlySet<VoiceStatus> = new Set(["joining", "connected", "reconnecting"]);

function roomOf(voice: readonly VoiceSessionState[]): LyreBotRoom | null {
  const session = voice.find((candidate) => IN_ROOM.has(candidate.status)) ?? voice.find((candidate) => candidate.status === "error");
  if (!session) return null;
  return {
    serverId: session.guildId,
    channelId: session.channelId,
    status: session.status,
    ...(session.error ? { error: session.error } : {}),
  };
}

function botOf(bot: BotState): LyreBot {
  return {
    id: bot.id,
    name: bot.discordName ?? bot.name,
    login: bot.status,
    ...(bot.error ? { error: bot.error } : {}),
    room: roomOf(bot.voice),
    muted: bot.muted,
    volume: bot.volume ?? 1,
    serverIds: bot.guilds.map((guild) => guild.id),
  };
}

export function lyreOutputsOf(state: OutputsState): LyreOutputs {
  const servers = new Map<string, LyreServer>();
  for (const bot of state.bots) {
    for (const guild of bot.guilds) {
      if (!servers.has(guild.id)) {
        servers.set(guild.id, {
          id: guild.id,
          name: guild.name,
          channels: guild.voiceChannels.map((channel) => ({ id: channel.id, name: channel.name, members: [...(channel.members ?? [])] })),
        });
      }
    }
  }
  return { bots: state.bots.map(botOf), servers: [...servers.values()] };
}

const isText = (value: unknown): value is string => typeof value === "string";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The page's preload accepts only this shape from the main process. */
export function isLyreOutputs(value: unknown): value is LyreOutputs {
  if (!isObject(value) || !Array.isArray(value.bots) || !Array.isArray(value.servers)) return false;
  const botOk = (bot: unknown) =>
    isObject(bot) && isText(bot.id) && isText(bot.name) && isText(bot.login) && typeof bot.muted === "boolean" && typeof bot.volume === "number" && Array.isArray(bot.serverIds) && (bot.room === null || isObject(bot.room));
  const serverOk = (server: unknown) =>
    isObject(server) && isText(server.id) && isText(server.name) && Array.isArray(server.channels) && server.channels.every((c) => isObject(c) && isText(c.id) && isText(c.name) && Array.isArray(c.members));
  return value.bots.every(botOk) && value.servers.every(serverOk);
}
