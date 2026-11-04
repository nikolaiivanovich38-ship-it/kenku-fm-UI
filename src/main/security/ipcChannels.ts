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

export const IPC_CHANNELS = {
  // src/index.ts
  GET_VERSION: { from: MAIN, args: noArgs, refusedReturnValue: "" },
  GET_PLATFORM: { from: MAIN, args: noArgs, refusedReturnValue: "" },
  CLEAR_CACHE: { from: MAIN, args: noArgs },

  // WindowManager
  WINDOW_TOGGLE_MAXIMIZE: { from: MAIN, args: noArgs },
  WINDOW_MINIMIZE: { from: MAIN, args: noArgs },
  WINDOW_CLOSE: { from: MAIN, args: noArgs },

  // DiscordBroadcast
  DISCORD_CONNECT: { from: MAIN, args: argsMatch(isShortText) },
  DISCORD_DISCONNECT: { from: MAIN, args: noArgs },
  DISCORD_JOIN_CHANNEL: { from: MAIN, args: argsMatch(isShortText) },
  DISCORD_LEAVE_CHANNEL: { from: MAIN, args: argsMatch(isShortText) },

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
  AUDIO_CAPTURE_SET_LOOPBACK: { from: MAIN, args: argsMatch(isBoolean) },
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

  // --- WP2 Pipeline / Outputs and bots ---
  // PERF-4: the streaming mode is applied when a broadcast starts (capture
  // no longer starts at launch, so AUDIO_CAPTURE_START is gone).
  AUDIO_CAPTURE_SET_STREAMING_MODE: { from: MAIN, args: argsMatch(isOneOf("lowLatency", "performance")) },
} satisfies Record<string, IpcChannelRule>;

export type IpcChannel = keyof typeof IPC_CHANNELS;
