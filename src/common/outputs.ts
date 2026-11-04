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
}

export interface BotState {
  id: string;
  /** "Bot 1", "Bot 2", … */
  name: string;
  /** The bot's name in Discord, once connected. */
  discordName?: string;
  hasToken: boolean;
  /** False: the token is kept only until Lyre closes (no secure storage). */
  tokenRemembered: boolean;
  status: BotStatus;
  /** Plain-language reason when `status` is "error". */
  error?: string;
  /**
   * WP1 review 5: why the bot left a voice channel by itself (a moderator
   * moved or disconnected it), until it joins one again.
   */
  notice?: string;
  guilds: GuildInfo[];
  voice: VoiceSessionState[];
  muted: boolean;
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
