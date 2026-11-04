/**
 * SEC-8: every message channel the app's own pages send to the main process,
 * which page may send it and what arguments it carries. Worked out from the
 * preload scripts:
 * - main-window: src/preload.ts and src/preload/managers/BrowserViewManagerPreload.ts
 * - player-view: src/player/preload.ts
 * - audio-capture: src/audioCapture/preload.ts and src/preload/managers/AudioCaptureManagerPreload.ts
 * Website tabs have no preload and never appear here. docs/security.md has the
 * same table in plain language; keep the two in step.
 */
import {
  type ArgCheck,
  type ArgsCheck,
  MAX_URL_LENGTH,
  argsMatch,
  isBoolean,
  isFiniteNumber,
  isIntegerIn,
  isOneOf,
  isPlainObject,
  isStringUpTo,
  isWebContentsId,
  noArgs,
  optional,
} from "./ipcArgs";
import type { AppPageRole } from "./permissions";

export interface IpcChannelRule {
  /** Pages allowed to send on this channel. */
  from: readonly AppPageRole[];
  /** Expected arguments after the event. */
  args: ArgsCheck;
  /**
   * Only for channels the page calls with `sendSync`: the answer a refused
   * message gets, so the sender is not left waiting.
   */
  refusedReturnValue?: unknown;
}

/** Returned to the renderer instead of a view id when a view request is refused. */
export const REFUSED_VIEW_ID = -1;

/**
 * Upper bound for short text the user types or picks (Discord bot token,
 * remote address and port, Discord channel ids, audio device ids). Real values
 * are under 100 characters.
 */
export const MAX_SHORT_TEXT = 4096;

/** The only view kind the main window may request besides a plain website tab. */
export const PLAYER_VIEW_KIND = "player";

/** Correlates a remote API request with the player's reply (PERF-9). */
const isRequestId = isIntegerIn(1, Number.MAX_SAFE_INTEGER);
const isShortText = isStringUpTo(MAX_SHORT_TEXT);
const isUrl = isStringUpTo(MAX_URL_LENGTH);
const MAIN: readonly AppPageRole[] = ["main-window"];
const PLAYER: readonly AppPageRole[] = ["player-view"];
const bounds = [isFiniteNumber, isFiniteNumber, isFiniteNumber, isFiniteNumber] as const;
const viewIdOnly = argsMatch(isWebContentsId);

// --- WP2 Pipeline / Outputs and bots ---
/** Bot ids are made by the main process (botTokenStore.ts BOT_ID_PATTERN). */
const BOT_ID = /^bot-[0-9a-f-]{36}$/;
const isBotId: ArgCheck = (value) => typeof value === "string" && BOT_ID.test(value);
/** "local" (this computer's speakers) or a bot id. */
const isOutputId: ArgCheck = (value) => value === "local" || isBotId(value);
/** A Discord snowflake id (server, channel). */
const isDiscordId: ArgCheck = (value) => typeof value === "string" && /^\d{1,25}$/.test(value);
/** A bot token: non-empty text, at most MAX_SHORT_TEXT (real ones are ~70 characters). */
const isBotToken: ArgCheck = (value) => isShortText(value) && (value as string).trim() !== "";

export const IPC_CHANNELS = {
  // src/index.ts
  GET_VERSION: { from: MAIN, args: noArgs, refusedReturnValue: "" },
  GET_PLATFORM: { from: MAIN, args: noArgs, refusedReturnValue: "" },
  CLEAR_CACHE: { from: MAIN, args: noArgs },

  // WindowManager
  WINDOW_TOGGLE_MAXIMIZE: { from: MAIN, args: noArgs },
  WINDOW_MINIMIZE: { from: MAIN, args: noArgs },
  WINDOW_CLOSE: { from: MAIN, args: noArgs },

  // BrowserViewManagerMain
  BROWSER_VIEW_CREATE_BROWSER_VIEW: {
    from: MAIN,
    // The address may be missing for a bookmark saved without one; that has
    // always opened a blank tab, so it still does.
    args: argsMatch(optional(isUrl), ...bounds, optional(isOneOf(PLAYER_VIEW_KIND))),
    refusedReturnValue: REFUSED_VIEW_ID,
  },
  BROWSER_VIEW_REMOVE_BROWSER_VIEW: { from: MAIN, args: viewIdOnly },
  BROWSER_VIEW_REMOVE_ALL_BROWSER_VIEWS: { from: MAIN, args: noArgs },
  BROWSER_VIEW_HIDE_BROWSER_VIEW: { from: MAIN, args: viewIdOnly },
  BROWSER_VIEW_SHOW_BROWSER_VIEW: { from: MAIN, args: viewIdOnly },
  BROWSER_VIEW_SET_BROWSER_VIEW_BOUNDS: {
    from: MAIN,
    args: argsMatch(isWebContentsId, ...bounds),
  },
  BROWSER_VIEW_LOAD_URL: { from: MAIN, args: argsMatch(isWebContentsId, isUrl) },
  BROWSER_VIEW_GO_FORWARD: { from: MAIN, args: viewIdOnly },
  BROWSER_VIEW_GO_BACK: { from: MAIN, args: viewIdOnly },
  BROWSER_VIEW_RELOAD: { from: MAIN, args: viewIdOnly },

  // PlayerManager
  PLAYER_GET_URL: { from: MAIN, args: noArgs, refusedReturnValue: "" },
  PLAYER_REGISTER_VIEW: { from: MAIN, args: viewIdOnly },
  PLAYER_START_REMOTE: { from: MAIN, args: argsMatch(isShortText, isShortText) },
  PLAYER_STOP_REMOTE: { from: MAIN, args: noArgs },

  // AudioCaptureManagerMain, sent by the main window
  AUDIO_CAPTURE_SET_MUTED: { from: MAIN, args: argsMatch(isWebContentsId, isBoolean) },
  AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE: { from: MAIN, args: argsMatch(isShortText) },
  AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE: { from: MAIN, args: argsMatch(isShortText) },
  AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM: { from: MAIN, args: viewIdOnly },
  AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM: { from: MAIN, args: viewIdOnly },
  AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS: { from: MAIN, args: noArgs },

  // The hidden capture window sends nothing over IPC: its audio goes over a
  // private MessageChannelMain port (SEC-2, WP2).

  // Remote API replies from the player view (src/main/remote)
  PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY: { from: PLAYER, args: argsMatch(isPlainObject, isRequestId) },
  PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY: { from: PLAYER, args: argsMatch(isPlainObject, isRequestId) },
  PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REPLY: { from: PLAYER, args: argsMatch(isPlainObject, isRequestId) },
  PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REPLY: { from: PLAYER, args: argsMatch(isPlainObject, isRequestId) },

  // --- Kenku FM backgrounds (fix/kenku-backgrounds) ---
  // src/main/legacyBackgrounds: the player asks (sync, while it loads) for the
  // background pictures in <userData>/backgrounds. A refusal gets no pictures,
  // so the player shows its blank background.
  PLAYER_GET_BACKGROUNDS: { from: PLAYER, args: noArgs, refusedReturnValue: {} },

  // --- WP2 Tabs ---
  // SEC-15 (BrowserViewManagerMain): open a file from the user's computer in a
  // tab of its own (invoke; answers the view id, or -1 when refused or the
  // user said no). The main process asks the user itself before opening it.
  BROWSER_VIEW_OPEN_LOCAL_FILE: { from: MAIN, args: argsMatch(isUrl, ...bounds) },
  // Settings > Local files: the remembered folders (invoke; answers the list).
  // A folder path is at most 32767 characters (Windows long paths).
  LOCAL_FILES_LIST_FOLDERS: { from: MAIN, args: noArgs },
  LOCAL_FILES_FORGET_FOLDER: { from: MAIN, args: argsMatch(isStringUpTo(32_767)) },

  // --- WP2 Pipeline / Outputs and bots ---
  // PERF-4: the streaming mode is applied when a broadcast starts (capture
  // no longer starts at launch, so AUDIO_CAPTURE_START is gone).
  AUDIO_CAPTURE_SET_STREAMING_MODE: { from: MAIN, args: argsMatch(isOneOf("lowLatency", "performance")) },
  // SEC-5 / OUT-1: outputs and Discord bots (OutputManager). Replace the old
  // DISCORD_* channels and AUDIO_CAPTURE_SET_LOOPBACK. No channel returns a token.
  OUTPUTS_GET_STATE: { from: MAIN, args: noArgs },
  OUTPUTS_CONNECT_SAVED: { from: MAIN, args: noArgs },
  BOT_ADD: { from: MAIN, args: noArgs },
  BOT_REMOVE: { from: MAIN, args: argsMatch(isBotId) },
  BOT_SET_TOKEN: { from: MAIN, args: argsMatch(isBotId, isBotToken) },
  BOT_REMOVE_TOKEN: { from: MAIN, args: argsMatch(isBotId) },
  BOT_IMPORT_LEGACY_TOKEN: { from: MAIN, args: argsMatch(isBotToken) },
  BOT_CONNECT: { from: MAIN, args: argsMatch(isBotId) },
  BOT_DISCONNECT: { from: MAIN, args: argsMatch(isBotId) },
  BOT_JOIN_CHANNEL: { from: MAIN, args: argsMatch(isBotId, isDiscordId) },
  BOT_LEAVE_CHANNEL: { from: MAIN, args: argsMatch(isBotId, isDiscordId) },
  OUTPUT_SET_MUTED: { from: MAIN, args: argsMatch(isOutputId, isBoolean) },
  // OUT-2: try a failed bot or voice connection again.
  BOT_RECONNECT: { from: MAIN, args: argsMatch(isBotId) },

  // --- Wave 1 core fixes (wave1-corefix) ---
  // PERF-6 (review 7): the player's answer to PLAYER_SAVE_NOW (sent by
  // PlayerManager before the window closes): its waiting changes are saved.
  PLAYER_SAVED: { from: PLAYER, args: noArgs },
} satisfies Record<string, IpcChannelRule>;

export type IpcChannel = keyof typeof IPC_CHANNELS;
