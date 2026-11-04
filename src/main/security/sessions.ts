import { protocol, session, type Session } from "electron";
import { getMalformedUserAgent, getUserAgent } from "../userAgent";
import { LOCAL_FILE_PARTITION, TAB_PARTITION } from "./partitions";
import { isPermissionAllowed } from "./permissions";
import { trustedContents } from "./trustedContents";
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
 */
function allSessions(): Session[] {
  return [
    session.defaultSession,
    session.fromPartition(TAB_PARTITION),
    session.fromPartition(LOCAL_FILE_PARTITION),
  ];
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
 * WP1 review 1 and 2: files from the user's computer are served under their
 * own scheme (localFileServer.ts). It must be declared before the app is
 * ready: standard (relative links and one origin per folder work), secure
 * (the page is a secure context, as file: was), fetch and media streaming.
 * It does not bypass the Content-Security-Policy.
 */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_FILE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
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
 * Apply permission handlers and the user-agent rewrite to every session the
 * app uses, and serve local files on their own session. Call once, after
 * `app.whenReady()` and before any window loads.
 */
export function secureSessions(): void {
  for (const target of allSessions()) {
    installPermissionHandlers(target);
    installUserAgentRewrite(target);
  }
  serveLocalFiles(session.fromPartition(LOCAL_FILE_PARTITION), sharedLocalFileServer());
}

/** "Clear cache" in Settings: wipe caches and cookies for the app, website tabs and local-file tabs. */
export async function clearBrowsingData(): Promise<void> {
  for (const target of allSessions()) {
    await target.clearCache();
    await target.clearStorageData({
      storages: ["cookies", "shadercache", "cachestorage"],
    });
  }
}
