import { protocol, session, type Session } from "electron";
import { getMalformedUserAgent, getUserAgent } from "../userAgent";
import { LOCAL_FILE_PARTITION, TAB_PARTITION } from "./partitions";
import { isPermissionAllowed } from "./permissions";
import { trustedContents } from "./trustedContents";
import { MEDIA_SCHEME, mediaResponse, sharedMediaGrants } from "../media/mediaProtocol";
import { captureTargets } from "./captureTargets";
import {
  LOCAL_FILE_SCHEME,
  isAllowedLocalFileRequest,
  localFileResponse,
  sharedLocalFileServer,
  type LocalFileServer,
} from "./localFileServer";

/**
 * SEC-3: the app's own pages use the default session; website tabs use
 * the separate persistent `TAB_PARTITION` session so they never share
 * cookies or storage with Kenku FM itself. SEC-15: files from the user's
 * computer use `LOCAL_FILE_PARTITION`, apart from both, with the same
 * deny-by-default permission handler as websites.
 *
 * CR51-3 (0.5.1): website tabs and local files are kept for OUT-12 and off, so
 * nothing at start opens their sessions or registers their scheme. To turn them
 * back on, OUT-12 calls `registerAppSchemes({ websiteTabs: true })` instead of
 * `registerAppSchemes()` before the app is ready, and `secureKeptSessions()`
 * after `secureSessions()`, before it makes `BrowserViewManagerMain`.
 */
function keptSessions(): Session[] {
  return [session.fromPartition(TAB_PARTITION), session.fromPartition(LOCAL_FILE_PARTITION)];
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
      isCheck: true,
    }),
  );
}

/**
 * The app's privileged schemes, declared once before the app is ready (Electron keeps only the last list it is given,
 * so every privileged scheme goes in this one call).
 * - Security review 6: `lyre-media:`, the Lyre page's library audio, granted per page by MEDIA_PREPARE
 *   (media/mediaProtocol.ts). corsEnabled: the page (a file: origin) reads it with fetch and plays it through Web
 *   Audio.
 * - WP1 review 1 and 2, kept for OUT-12 (CR51-3: only with `websiteTabs`): files from the user's computer in a tab
 *   of their own are served under `cue-local-file:` (localFileServer.ts): standard (relative links and one origin
 *   per folder work), secure (the page is a secure context, as file: was), fetch and media streaming. It does not
 *   bypass the Content-Security-Policy.
 */
export function registerAppSchemes(options: { websiteTabs?: boolean } = {}): void {
  protocol.registerSchemesAsPrivileged([
    ...(options.websiteTabs
      ? [{ scheme: LOCAL_FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]
      : []),
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

/**
 * The local-files session answers its own scheme and nothing else: file:
 * gets 403 (a page there could otherwise read any file), and any request
 * to another scheme, the web included, is cancelled.
 */
function serveLocalFiles(target: Session, server: LocalFileServer): void {
  target.protocol.handle(LOCAL_FILE_SCHEME, (request) =>
    localFileResponse(server.resolve(request.url), request.headers),
  );
  target.protocol.handle("file", () => new Response("Files open in their own tabs.", { status: 403 }));
  target.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedLocalFileRequest(details.url) });
  });
}

/**
 * Apply permission handlers and the user-agent rewrite to the app's own session (Lyre's pages and the capture
 * window), and answer lyre-media: there. Call once, after `app.whenReady()` and before any window loads.
 */
export function secureSessions(): void {
  installPermissionHandlers(session.defaultSession);
  installUserAgentRewrite(session.defaultSession);
  // Security review 6: only the app's own session (Lyre's pages) answers lyre-media:, and only granted addresses.
  session.defaultSession.protocol.handle(MEDIA_SCHEME, (request) => mediaResponse(sharedMediaGrants(), request));
}

/**
 * Kept for OUT-12 (CR51-3): the same handlers on the website-tab and local-file sessions, and local files served on
 * their own session. Nothing calls it in 0.5.1; OUT-12 calls it once, after `secureSessions()`, before any tab opens.
 */
export function secureKeptSessions(): void {
  for (const target of keptSessions()) {
    installPermissionHandlers(target);
    installUserAgentRewrite(target);
  }
  serveLocalFiles(session.fromPartition(LOCAL_FILE_PARTITION), sharedLocalFileServer());
}

/** Kept for OUT-12: wipe caches and cookies for the app, website tabs and local-file tabs. Nothing calls it in 0.5.1. */
export async function clearBrowsingData(): Promise<void> {
  for (const target of [session.defaultSession, ...keptSessions()]) {
    await target.clearCache();
    await target.clearStorageData({
      storages: ["cookies", "shadercache", "cachestorage"],
    });
  }
}
