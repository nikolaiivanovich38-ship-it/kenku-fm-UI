/**
 * SEC-3: which browser permissions each kind of page may use.
 *
 * Electron grants every permission request unless the app installs a
 * handler. Kenku FM's own pages need very little (audio capture, copying ids
 * to the clipboard) and website tabs need even less, so everything is denied
 * unless it appears in the allow-list below. Kept free of Electron imports so
 * the rules can be unit-tested.
 */

/** Kenku FM's own pages. A `null` role means "not one of ours" (a website tab). */
export type AppPageRole = "main-window" | "audio-capture" | "player-view";

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
}

/**
 * Permissions granted to each app page. "media" means audio only: video is
 * never granted (see `isAudioOnly`).
 * - main-window: lists input devices (with names) for the external-input feature.
 * - audio-capture: captures tab audio and external input devices for Discord.
 * - player-view: copies playlist / sound ids to the clipboard.
 */
const APP_PAGE_PERMISSIONS: Record<AppPageRole, ReadonlySet<string>> = {
  "main-window": new Set(["media"]),
  "audio-capture": new Set(["media"]),
  "player-view": new Set(["clipboard-sanitized-write"]),
};

/**
 * Permissions granted to website tabs:
 * - fullscreen: full-screen video players (YouTube etc.).
 * - mediaKeySystem: DRM-protected music services (Widevine).
 * Microphone, camera, notifications, location, external apps, etc. are refused.
 */
const TAB_PERMISSIONS: ReadonlySet<string> = new Set([
  "fullscreen",
  "mediaKeySystem",
]);

function isAudioOnly(mediaTypes: readonly string[] | undefined): boolean {
  return !(mediaTypes ?? []).includes("video");
}

/**
 * SEC-3: decide one permission request or check. Deny by default.
 * App pages only get their permissions from their own top-level frame, never
 * from an embedded frame.
 */
export function isPermissionAllowed({
  role,
  permission,
  mediaTypes,
  isMainFrame = true,
}: PermissionQuery): boolean {
  if (role === null) {
    return TAB_PERMISSIONS.has(permission);
  }
  if (!isMainFrame) {
    return false;
  }
  if (!APP_PAGE_PERMISSIONS[role].has(permission)) {
    return false;
  }
  if (permission === "media") {
    return isAudioOnly(mediaTypes);
  }
  return true;
}
