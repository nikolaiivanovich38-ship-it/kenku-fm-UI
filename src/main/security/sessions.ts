import { session, type Session } from "electron";
import { getMalformedUserAgent, getUserAgent } from "../userAgent";
import { TAB_PARTITION } from "./partitions";
import { isPermissionAllowed } from "./permissions";
import { trustedContents } from "./trustedContents";
import { captureTargets } from "./captureTargets";

/**
 * SEC-3: the app's own pages use the default session; website tabs use
 * the separate persistent `TAB_PARTITION` session so they never share
 * cookies or storage with Kenku FM itself.
 */
function allSessions(): Session[] {
  return [session.defaultSession, session.fromPartition(TAB_PARTITION)];
}

/** Google blocks sign-in from embedded browsers, so it gets a user agent without the Chrome token. */
function installUserAgentRewrite(target: Session): void {
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders["User-Agent"] = details.url.includes("google.com")
      ? getMalformedUserAgent()
      : getUserAgent();
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}

/** SEC-3: deny-by-default permission handlers backed by `isPermissionAllowed`. */
function installPermissionHandlers(target: Session): void {
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes =
      "mediaTypes" in details ? (details.mediaTypes ?? []) : undefined;
    callback(
      isPermissionAllowed({
        role: trustedContents.roleOf(contents),
        permission,
        mediaTypes,
        isMainFrame: details.isMainFrame,
        // Tab capture only when the capture window is the one asking
        // (WP1 review: a website asking for its screen looks the same otherwise).
        isCaptureTarget: captureTargets.isCaptureRequest(
          contents,
          "securityOrigin" in details ? details.securityOrigin : undefined,
        ),
      }),
    );
  });
  target.setPermissionCheckHandler((contents, permission, _origin, details) =>
    isPermissionAllowed({
      role: trustedContents.roleOf(contents),
      permission,
      mediaTypes: details.mediaType ? [details.mediaType] : undefined,
      isMainFrame: details.isMainFrame,
    }),
  );
}

/**
 * Apply permission handlers and the user-agent rewrite to every session the
 * app uses. Call once, after `app.whenReady()` and before any window loads.
 */
export function secureSessions(): void {
  for (const target of allSessions()) {
    installPermissionHandlers(target);
    installUserAgentRewrite(target);
  }
}

/** "Clear cache" in Settings: wipe caches and cookies for the app and for website tabs. */
export async function clearBrowsingData(): Promise<void> {
  for (const target of allSessions()) {
    await target.clearCache();
    await target.clearStorageData({
      storages: ["cookies", "shadercache", "cachestorage"],
    });
  }
}
