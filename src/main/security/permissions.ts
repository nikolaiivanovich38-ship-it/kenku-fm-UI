/**
 * SEC-3: which browser permissions each kind of page may use.
 *
 * Electron grants every permission request unless the app installs a
 * handler. Lyre's own pages need very little (audio capture, copying text
 * to the clipboard) and website tabs need even less, so everything is denied
 * unless it appears in the allow-list below. Kept free of Electron imports so
 * the rules can be unit-tested.
 */

/**
 * Lyre's own pages. A `null` role means "not one of ours" (a website tab).
 * "lyre-view" is the new interface's page (wave 3, src/lyre).
 */
export type AppPageRole = "main-window" | "audio-capture" | "lyre-view";

/** Media types as reported by Electron's request ("audio"/"video") and check ("unknown") handlers. */
export type MediaType = "audio" | "video" | "unknown";

export interface PermissionQuery {
  /** Role of the requesting page, or null for anything not registered as trusted. */
  role: AppPageRole | null;
  /** Electron permission name, e.g. "media", "notifications". */
  permission: string;
  /** For "media": which devices are wanted. */
  mediaTypes?: readonly string[];
  /** Whether the request comes from the page itself rather than an embedded frame. Defaults to true. */
  isMainFrame?: boolean;
  /** Whether the app has chosen to capture this page's audio (see captureTargets.ts). */
  isCaptureTarget?: boolean;
  /**
   * A permission check (Chromium asking whether the page already has it, from
   * Electron's check handler) rather than a request (the page asking for it).
   */
  isCheck?: boolean;
}

/**
 * Permissions granted to each app page. "media" means audio only: video is
 * never granted (see `isAudioOnly`).
 * - main-window: lists input devices (with names) for the external-input feature.
 * - audio-capture: captures tab audio and external input devices for Discord.
 * - lyre-view: writes text to the clipboard (Copy path, Copy code; never reads it). Without this Chromium refused
 *   navigator.clipboard.writeText and nothing was copied (Nik, 0.5.0). See APP_PAGE_CHECKS for its device choice.
 */
const APP_PAGE_PERMISSIONS: Record<AppPageRole, ReadonlySet<string>> = {
  "main-window": new Set(["media"]),
  "audio-capture": new Set(["media"]),
  "lyre-view": new Set(["clipboard-sanitized-write"]),
};

/**
 * --- Rooms and buses --- PRV-2: permissions an app page gets only as a check,
 * never as a request.
 * - lyre-view: "speaker-selection" lets it see the sound output devices'
 *   names (enumerateDevices) and play on one with setSinkId (PRV-2). Probed on
 *   Electron 44 (WP2 wave 2, for the old player): both ask only this check;
 *   without it setSinkId on a chosen device fails with "No permission to use
 *   requested device". The page still gets no microphone or camera ("media"
 *   stays refused), and no `selectAudioOutput` picker (that is a request).
 */
const APP_PAGE_CHECKS: Record<AppPageRole, ReadonlySet<string>> = {
  "main-window": new Set(),
  "audio-capture": new Set(),
  "lyre-view": new Set(["speaker-selection"]),
};

/**
 * --- w3-host --- Pages whose sound must never be recorded by tab capture.
 * The new interface's page sends each room's mix to Discord over the private
 * player channel (RoomStreams); recording the page as well would play every
 * room into every room and twice. AudioCaptureManagerMain already refuses to
 * capture it; this refuses Chromium's capture request too.
 */
const NEVER_CAPTURED: ReadonlySet<AppPageRole> = new Set(["lyre-view"]);

/**
 * Permissions granted to website tabs:
 * - fullscreen: full-screen video players (YouTube etc.).
 * Microphone, camera, notifications, location, external apps, DRM
 * (mediaKeySystem: standard Electron has no Widevine), etc. are refused.
 */
const TAB_PERMISSIONS: ReadonlySet<string> = new Set(["fullscreen"]);

/**
 * Tab capture for Discord: Chromium asks the captured page for "media" with
 * no media types. Granted only to the page itself (not an embedded frame) and
 * only while the app is capturing it. A permission check (no media types
 * reported) or a request for the microphone or camera never matches.
 */
function isTabCaptureOfChosenPage({
  permission,
  mediaTypes,
  isMainFrame = true,
  isCaptureTarget = false,
}: PermissionQuery): boolean {
  return (
    permission === "media" &&
    isCaptureTarget &&
    isMainFrame &&
    mediaTypes !== undefined &&
    mediaTypes.length === 0
  );
}

/**
 * Audio devices only. `undefined` is a permission check that names no media
 * type (device enumeration). SEC-16: an empty list is refused, because
 * Chromium reports screen and desktop capture (chromeMediaSource "desktop",
 * getDisplayMedia) as a request with no media types, while an input device,
 * with or without a deviceId constraint, arrives as ["audio"] (probed on
 * Electron 44 during WP2).
 */
function isAudioOnly(mediaTypes: readonly string[] | undefined): boolean {
  if (mediaTypes === undefined) {
    return true;
  }
  return mediaTypes.length > 0 && !mediaTypes.includes("video");
}

/**
 * SEC-3: decide one permission request or check. Deny by default.
 * App pages only get their permissions from their own top-level frame, never
 * from an embedded frame.
 */
export function isPermissionAllowed(query: PermissionQuery): boolean {
  const { role, permission, mediaTypes, isMainFrame = true } = query;
  if (role !== null && NEVER_CAPTURED.has(role) && permission === "media") {
    return false;
  }
  if (isTabCaptureOfChosenPage(query)) {
    return true;
  }
  if (role === null) {
    return TAB_PERMISSIONS.has(permission);
  }
  if (!isMainFrame) {
    return false;
  }
  if (query.isCheck && APP_PAGE_CHECKS[role].has(permission)) {
    return true;
  }
  if (!APP_PAGE_PERMISSIONS[role].has(permission)) {
    return false;
  }
  if (permission === "media") {
    return isAudioOnly(mediaTypes);
  }
  return true;
}
