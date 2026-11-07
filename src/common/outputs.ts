import type { Room } from "./domain/types";

/**
 * OUT-1: what the main process tells the main window about the outputs
 * (pushed on "OUTPUTS_STATE", fetched with OUTPUTS_GET_STATE). Never holds a
 * bot token (SEC-5).
 */

/** The local speakers' output id; Discord bots use their bot id. */
export const LOCAL_OUTPUT_ID = "local";

export type BotStatus = "offline" | "connecting" | "ready" | "error";
/** OUT-2: "reconnecting" while it tries again after the connection dropped. */
export type VoiceStatus = "joining" | "connected" | "reconnecting" | "error";

export interface VoiceChannelInfo {
  id: string;
  name: string;
  /** w4-outputs: the people (not bots) in the channel now, by their name in that server. */
  members?: string[];
}

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  voiceChannels: VoiceChannelInfo[];
}

/** One bot's voice connection in one server (Discord allows one per server). */
export interface VoiceSessionState {
  guildId: string;
  channelId: string;
  channelName: string;
  status: VoiceStatus;
  /** Plain-language reason when `status` is "error" or "reconnecting". */
  error?: string;
  /** UX finding 6: while reconnecting, when the next attempt is due (ms since 1970). */
  retryAt?: number;
}

export interface BotState {
  id: string;
  /** "Bot 1", "Bot 2", … */
  name: string;
  /** The bot's name in Discord, once connected. */
  discordName?: string;
  /** w6-rooms (OUT-8): its Discord name at the last login with this token, kept while it is disconnected. */
  lastDiscordName?: string;
  hasToken: boolean;
  /** False: the token is kept only until Lyre closes (no secure storage). */
  tokenRemembered: boolean;
  /** OUT-8: the last four characters of its token, so the game master can tell tokens apart; never more (SEC-5). */
  tokenEnd?: string;
  /** OUT-8: the bot's Application ID (General Information in the Discord Developer Portal), for its invite link only. */
  applicationId?: string;
  status: BotStatus;
  /** Plain-language reason when `status` is "error" (or why it is logging in again). */
  error?: string;
  /**
   * WP1 review 5: why the bot left a voice channel by itself (a moderator
   * moved or disconnected it), until it joins one again.
   */
  notice?: string;
  /** UX finding 6: while logging in again by itself, when the next attempt is due (ms since 1970). */
  retryAt?: number;
  guilds: GuildInfo[];
  voice: VoiceSessionState[];
  muted: boolean;
  /**
   * OUT-5: the volume of this bot's room, 0 to 1 (everything sent to it:
   * Lyre's player and the tabs routed there); missing means 1. Muting is `muted`.
   */
  volume?: number;
}

export interface OutputsState {
  /** Whether tokens can be saved encrypted on this computer. */
  encryption: boolean;
  /**
   * WP1 review 11: a token saved by an older version was moved over in this
   * session but can only be kept until Lyre closes (no encryption).
   */
  legacyTokenSessionOnly?: boolean;
  local: { muted: boolean };
  bots: BotState[];
  /** OUT-5: every bot in a voice channel, first room (the table) first (`roomsOf(bots)`). */
  rooms?: Room[];
}

export const EMPTY_OUTPUTS_STATE: OutputsState = {
  encryption: true,
  local: { muted: false },
  bots: [],
};

/** Shown name of a bot: its Discord name when known. */
export function botLabel(bot: Pick<BotState, "name" | "discordName">): string {
  return bot.discordName ? `${bot.discordName} (${bot.name})` : bot.name;
}

/** Voice statuses in which a bot is (about to be) heard in its channel, so it is a room. */
const IN_ROOM: ReadonlySet<VoiceStatus> = new Set(["joining", "connected", "reconnecting"]);

/**
 * OUT-5: every bot in a voice channel is a room, named after its channel, in
 * the bots' order (the first is the table). A bot in two servers is one room
 * (it has one mix), named after its first channel.
 */
export function roomsOf(bots: readonly Pick<BotState, "id" | "voice">[]): Room[] {
  const rooms: Room[] = [];
  for (const bot of bots) {
    const session = bot.voice.find((candidate) => IN_ROOM.has(candidate.status));
    if (session) {
      rooms.push({ botId: bot.id, name: session.channelName });
    }
  }
  return rooms;
}

/**
 * OUT-5: where a captured source (a website tab, an input device) is sent:
 * every room, the first room (the table), or one room (a room that has gone
 * means the first room, as `roomsFor` does).
 */
export type CaptureRoute = "all" | "table" | { room: string };

/**
 * Where tabs and input devices go until routed otherwise. "all" keeps what
 * Lyre 0.2 does (every bot hears the tabs; the WP2 tests rely on it) while the
 * old interface, which cannot route, is in use. The design (wave 3) sends tabs
 * to the table: `AudioCaptureManagerMain.setDefaultRoute("table")`.
 */
export const DEFAULT_CAPTURE_ROUTE: CaptureRoute = "all";

/** Longest room id the capture window may name (bot ids are 40 characters). */
export const MAX_ROOM_ID_LENGTH = 64;

/** A well-formed route, as the capture window and main process accept it. */
export function isCaptureRoute(value: unknown): value is CaptureRoute {
  if (value === "all" || value === "table") {
    return true;
  }
  const room = (value as { room?: unknown } | null)?.room;
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof room === "string" &&
    room.length > 0 &&
    room.length <= MAX_ROOM_ID_LENGTH
  );
}
