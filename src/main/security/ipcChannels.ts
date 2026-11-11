/**
 * SEC-8: every message channel the app's own pages send to the main process,
 * which page may send it and what arguments it carries. Worked out from the
 * preload scripts:
 * - main-window: src/preload.ts and src/preload/managers/BrowserViewManagerPreload.ts
 * - lyre-view: src/lyre/preload.ts
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
  isPlainObject,
  isStringUpTo,
  isWebContentsId,
  noArgs,
  optional,
} from "./ipcArgs";
import { isLyreMethod } from "../../common/lyre/rpc";
import { isApplicationId } from "../../common/lyreOutputs";
import { isGlobalKeysRequest as isGlobalKeysRequestShape } from "../../common/globalKeys";
import type { AppPageRole } from "./permissions";
import { isTitleBarColours } from "../../common/windowFrame";

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

/** w3-shell: the view kind of the new interface page (the "Lyre" tab). */
export const LYRE_VIEW_KIND = "lyre";

const isShortText = isStringUpTo(MAX_SHORT_TEXT);
const isUrl = isStringUpTo(MAX_URL_LENGTH);
const MAIN: readonly AppPageRole[] = ["main-window"];
const bounds = [isFiniteNumber, isFiniteNumber, isFiniteNumber, isFiniteNumber] as const;
const viewIdOnly = argsMatch(isWebContentsId);

// --- WP2 Pipeline / Outputs and bots ---
/** Bot ids are made by the main process (botTokenStore.ts BOT_ID_PATTERN). */
const BOT_ID = /^bot-[0-9a-f-]{36}$/;
const isBotId: ArgCheck = (value) => typeof value === "string" && BOT_ID.test(value);
/** A Discord snowflake id (server, channel). */
const isDiscordId: ArgCheck = (value) => typeof value === "string" && /^\d{1,25}$/.test(value);
/** A bot token: non-empty text, at most MAX_SHORT_TEXT (real ones are ~70 characters). */
const isBotToken: ArgCheck = (value) => isShortText(value) && (value as string).trim() !== "";
// --- w6-contracts ---
/** OUT-8: an Application ID (a Discord id, digits only: isApplicationId), the only part of an invite the page sends. */
const isApplicationIdArg: ArgCheck = (value) => isApplicationId(value);
/** OUT-8: an Application ID as typed (trimmed by the main process, which answers a wrong one in words), or null. */
const isApplicationIdOrNull: ArgCheck = (value) => value === null || (typeof value === "string" && value.length <= 40 && /^\s*\d*\s*$/.test(value));

// --- Rooms and buses ---
/** A volume: a finite number from 0 to 1. */
const isUnitInterval: ArgCheck = (value) => isFiniteNumber(value) && (value as number) >= 0 && (value as number) <= 1;
// --- Files and preview ---
/** MEDIA_PREPARE's options: exactly `{ keepLocal: boolean }`. */
const isPrepareOptions: ArgCheck = (value) =>
  isPlainObject(value) &&
  Object.keys(value as object).length === 1 &&
  isBoolean((value as { keepLocal?: unknown }).keepLocal);

// --- w3-api ---
/**
 * Plain data only (security review 10): null, booleans, finite numbers, text, arrays and plain objects, at most
 * 64 levels deep. Structured clone lets a page send a Map, a Set, a Date or an ArrayBuffer, which JSON measures as {}.
 */
function isPlainData(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 64) return false;
  if (Array.isArray(value)) return value.every((item) => isPlainData(item, depth + 1));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every((item) => isPlainData(item, depth + 1));
}
/** Largest LyreApi call, as JSON: a change to 5,000 tracks is about 0.2 MB, so 8 MB leaves room and stops a flood. */
export const MAX_CALL_BYTES = 8 * 1024 * 1024;
/** LYRE_API_CALL's arguments: area, method (a LyreApi method), and a short list of plain arguments. */
const isLyreCall: ArgsCheck = (args) => {
  if (args.length !== 3 || !isLyreMethod(args[0], args[1]) || !Array.isArray(args[2]) || args[2].length > 4) return false;
  // Security review 10: JSON counts an ArrayBuffer, Map or Date as {}, so only plain data passes.
  if (!isPlainData(args[2])) return false;
  try {
    return JSON.stringify(args[2]).length <= MAX_CALL_BYTES;
  } catch {
    return false;
  }
};

// --- w6-found ---
/**
 * SEC-4 (src/main/remote/remoteSettings.ts): a change to the remote control's settings, a plain object with any of
 * `enabled` (boolean), `address` (text, at most 64 characters) and `port` (a whole number 1 to 65535), and nothing
 * else. The main process then checks the address is an IP address or localhost and the port 1024 to 65535.
 */
const REMOTE_SETTING_CHECKS: Record<string, ArgCheck> = {
  enabled: isBoolean,
  address: isStringUpTo(64),
  port: isIntegerIn(1, 65535),
};
const isRemoteChange: ArgCheck = (value) =>
  isPlainObject(value) &&
  Object.entries(value as Record<string, unknown>).every(
    ([key, item]) => Object.prototype.hasOwnProperty.call(REMOTE_SETTING_CHECKS, key) && REMOTE_SETTING_CHECKS[key](item),
  );

export const IPC_CHANNELS = {
  // FND-16 (0.5.1): website tabs, local files and device capture are kept for OUT-12 (online sources, later) and
  // unreachable. Their channels come only from "main-window", which no page is any more, and nothing makes
  // BrowserViewManagerMain; AudioCaptureManagerMain listens on its channels below, which nothing can send.
  // BrowserViewManagerMain
  BROWSER_VIEW_CREATE_BROWSER_VIEW: {
    from: MAIN,
    // The address may be missing for a bookmark saved without one; that has
    // always opened a blank tab, so it still does. No kind: only website tabs (FND-16).
    args: argsMatch(optional(isUrl), ...bounds),
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

  // AudioCaptureManagerMain, sent by the main window
  AUDIO_CAPTURE_SET_MUTED: { from: MAIN, args: argsMatch(isWebContentsId, isBoolean) },
  AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE: { from: MAIN, args: argsMatch(isShortText) },
  AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE: { from: MAIN, args: argsMatch(isShortText) },
  AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM: { from: MAIN, args: viewIdOnly },
  AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM: { from: MAIN, args: viewIdOnly },
  AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS: { from: MAIN, args: noArgs },

  // The hidden capture window sends nothing over IPC: its audio goes over a
  // private MessageChannelMain port (SEC-2, WP2).


  // --- WP2 Tabs ---
  // SEC-15 (BrowserViewManagerMain): open a file from the user's computer in a
  // tab of its own (invoke; answers the view id, or -1 when refused or the
  // user said no). The main process asks the user itself before opening it.
  BROWSER_VIEW_OPEN_LOCAL_FILE: { from: MAIN, args: argsMatch(isUrl, ...bounds) },
  // Settings > Local files: the remembered folders (invoke; answers the list).
  // A folder path is at most 32767 characters (Windows long paths).
  LOCAL_FILES_LIST_FOLDERS: { from: MAIN, args: noArgs },
  LOCAL_FILES_FORGET_FOLDER: { from: MAIN, args: argsMatch(isStringUpTo(32_767)) },

  // --- Files and preview ---
  // BUG-10 / PLY-11 (src/main/media/mediaIpc.ts): prepare a library file
  // before it plays (invoke; answers { url } or { error }). Arguments: the
  // file address, and { keepLocal: boolean } and nothing else. The address is
  // checked against the library folders by MediaAccess before anything is read.
  // The Lyre page hosts the engine (FND-16: the old player that used it too is gone).
  MEDIA_PREPARE: { from: ["lyre-view"], args: argsMatch(isUrl, isPrepareOptions) },

  // --- w3-api ---
  // src/main/lyreApi/lyreIpc.ts: a LyreApi call from the new interface page (invoke; answers what the library
  // answered, a refusal included). Arguments: the area and method of a LyreApi method (nothing else reaches the
  // library), and the method's arguments as a list of at most 4, at most MAX_CALL_BYTES as JSON.
  LYRE_API_CALL: { from: ["lyre-view"], args: isLyreCall },

  // --- w4-outputs ---
  // src/main/broadcast/lyreOutputsBridge.ts: the Lyre page's Outputs screen. GET answers the bots and the voice
  // channels they can join (src/common/lyreOutputs.ts; never a token); the rest change one bot, named by its id.
  // A channel id is a Discord id; a volume is 0 to 1. No channel connects a bot or touches a token: that stays in
  // the main window's Settings.
  LYRE_OUTPUTS_GET: { from: ["lyre-view"], args: noArgs },
  LYRE_OUTPUT_MOVE: { from: ["lyre-view"], args: argsMatch(isBotId, isDiscordId) },
  LYRE_OUTPUT_LEAVE: { from: ["lyre-view"], args: argsMatch(isBotId) },
  LYRE_OUTPUT_SET_MUTED: { from: ["lyre-view"], args: argsMatch(isBotId, isBoolean) },
  LYRE_OUTPUT_SET_VOLUME: { from: ["lyre-view"], args: argsMatch(isBotId, isUnitInterval) },
  LYRE_OUTPUT_RETRY: { from: ["lyre-view"], args: argsMatch(isBotId) },

  // --- w4-guide ---
  // FND-9 (src/main/diagnostics/diagnosticsBridge.ts): Help › Save diagnostics. SAVE (invoke) asks the game master
  // for a folder in the main process, writes the zip there and answers names only ({ ok, folder, file }); SHOW
  // shows the last saved file in its folder. Neither takes an argument: the page never names a path.
  LYRE_DIAGNOSTICS_SAVE: { from: ["lyre-view"], args: noArgs },
  LYRE_DIAGNOSTICS_SHOW: { from: ["lyre-view"], args: noArgs },

  // --- w6-contracts ---
  // OUT-8 (src/main/broadcast/lyreOutputsBridge.ts): Settings in Lyre. ADD (invoke): a token and an Application ID or
  // null; SET_TOKEN, RENAME, SET_APP_ID, REMOVE, RESTORE (invoke): one bot by its id, then a token, a name or an
  // Application ID (or null); each answers { ok, botId } or { ok: false, message } (the main process checks a token's
  // and an Application ID's shape in plain words). CONNECT, DISCONNECT (send): one bot. OPEN_INVITE (send): an
  // Application ID; the main process makes the invite address itself. No channel sends a token back (SEC-5).
  LYRE_BOT_ADD: { from: ["lyre-view"], args: argsMatch(isBotToken, isApplicationIdOrNull) },
  LYRE_BOT_SET_TOKEN: { from: ["lyre-view"], args: argsMatch(isBotId, isBotToken) },
  LYRE_BOT_RENAME: { from: ["lyre-view"], args: argsMatch(isBotId, isStringUpTo(200)) },
  LYRE_BOT_SET_APP_ID: { from: ["lyre-view"], args: argsMatch(isBotId, isApplicationIdOrNull) },
  LYRE_BOT_REMOVE: { from: ["lyre-view"], args: argsMatch(isBotId) },
  LYRE_BOT_RESTORE: { from: ["lyre-view"], args: argsMatch(isBotId) },
  LYRE_BOT_CONNECT: { from: ["lyre-view"], args: argsMatch(isBotId) },
  LYRE_BOT_DISCONNECT: { from: ["lyre-view"], args: argsMatch(isBotId) },
  LYRE_BOT_OPEN_INVITE: { from: ["lyre-view"], args: argsMatch(isApplicationIdArg) },
  // --- w6-found ---
  // SEC-4 (PlayerManager, src/main/remote/remoteControl.ts): the remote control's settings for Settings (round 7
  // designs the screen). All invoke. GET answers a RemoteState (on, running, address, port, the secret code, whether
  // the code survives a restart, and a plain problem); SET changes some settings and answers the new state or
  // { error }; NEW_CODE replaces the code. Only the Lyre page: the old Settings keeps PLAYER_START/STOP_REMOTE.
  REMOTE_GET: { from: ["lyre-view"], args: noArgs },
  REMOTE_SET: { from: ["lyre-view"], args: argsMatch(isRemoteChange) },
  REMOTE_NEW_CODE: { from: ["lyre-view"], args: noArgs },
  // SEC-14 (LyreManager, src/main/updateStatus.ts): what automatic updates are doing, for Settings (invoke, no
  // arguments; answers an UpdateState from src/common/appUpdates.ts, with any problem in plain words).
  UPDATE_GET: { from: ["lyre-view"], args: noArgs },
  // --- w6-rooms ---
  // UX-12 (LyreManager, src/main/globalKeys.ts): Settings › Keyboard shortcuts › "in other programs too" (invoke). One
  // plain object { on, keys } with keys only for nextScene and fadeAll, each text of at most 40 characters
  // (isGlobalKeysRequest); the main process then refuses keys used for typing (globalKeyProblem) and answers
  // { refused: [{ action, key, message }] }. Each press comes back to the Lyre page as LYRE_GLOBAL_KEY.
  LYRE_GLOBAL_KEYS_SET: { from: ["lyre-view"], args: argsMatch(isGlobalKeysRequestShape) },
  // --- w51-main ---
  // FND-16 (src/main/broadcast/lyreOutputsBridge.ts): Got it on the note in Settings › Discord bots that says Lyre moved
  // the bot token Kenku FM kept in plain text (send, no arguments). The main process remembers it (old-window.json).
  LYRE_BOT_LEGACY_NOTE_SEEN: { from: ["lyre-view"], args: noArgs },
  // FND-16 (src/main/managers/LyreManager.ts): Restart now on Lyre's update note (send, no arguments); acted on only
  // once an update is ready (autoUpdater.quitAndInstall).
  UPDATE_RESTART: { from: ["lyre-view"], args: noArgs },
  // FND-16 step 2 (src/main/window/windowFrame.ts): the colours of the window's own buttons, those of what is under
  // them (send; exactly { color, symbolColor }, each "#rrggbb"), and maximise or put back on a double-click of a drag
  // area that reached the page (send, no arguments).
  LYRE_TITLE_BAR: { from: ["lyre-view"], args: argsMatch(isTitleBarColours) },
  LYRE_WINDOW_MAXIMISE: { from: ["lyre-view"], args: noArgs },
  // FND-16 (src/main/security/appInfoIpc.ts): Settings › Sound to Discord › Empty the audio cache (invoke, no
  // arguments). Replaces LYRE_CLEAR_WEBSITE_DATA; the Website tabs and Local files channels (LYRE_WINDOW_SETTINGS_*,
  // LYRE_LOCAL_FOLDERS_*) went with their boxes.
  LYRE_EMPTY_AUDIO_CACHE: { from: ["lyre-view"], args: noArgs },
} satisfies Record<string, IpcChannelRule>;

export type IpcChannel = keyof typeof IPC_CHANNELS;
