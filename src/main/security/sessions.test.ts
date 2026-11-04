import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBrowsingData, secureSessions } from "./sessions";
import { trustedContents } from "./trustedContents";
import { captureTargets } from "./captureTargets";
import { LOCAL_FILE_PARTITION, TAB_PARTITION } from "./partitions";

type RequestHandler = (
  contents: { id: number },
  permission: string,
  callback: (granted: boolean) => void,
  details: { isMainFrame: boolean; mediaTypes?: string[]; securityOrigin?: string },
) => void;
type CheckHandler = (
  contents: { id: number } | null,
  permission: string,
  origin: string,
  details: { isMainFrame: boolean; mediaType?: string },
) => boolean;
type HeadersListener = (
  details: { url: string; requestHeaders: Record<string, string> },
  callback: (response: { cancel: boolean; requestHeaders: Record<string, string> }) => void,
) => void;

const fakeSession = (name: string) => {
  const s = {
    name,
    requestHandler: undefined as RequestHandler | undefined,
    checkHandler: undefined as CheckHandler | undefined,
    headersListener: undefined as HeadersListener | undefined,
    setPermissionRequestHandler: (h: RequestHandler) => {
      s.requestHandler = h;
    },
    setPermissionCheckHandler: (h: CheckHandler) => {
      s.checkHandler = h;
    },
    webRequest: {
      onBeforeSendHeaders: (h: HeadersListener) => {
        s.headersListener = h;
      },
    },
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
  };
  return s;
};

type FakeSession = ReturnType<typeof fakeSession>;

const sessions = vi.hoisted(() => ({
  default: undefined as unknown as FakeSession,
  tabs: undefined as unknown as FakeSession,
  localFiles: undefined as unknown as FakeSession,
}));

vi.mock("electron", () => ({
  session: {
    get defaultSession() {
      return sessions.default;
    },
    fromPartition: (partition: string) => {
      if (partition === "persist:tabs") {
        return sessions.tabs;
      }
      if (partition === "persist:local-files") {
        return sessions.localFiles;
      }
      throw new Error(`unexpected partition ${partition}`);
    },
  },
}));

beforeEach(() => {
  sessions.default = fakeSession("default");
  sessions.tabs = fakeSession("tabs");
  sessions.localFiles = fakeSession("localFiles");
});

function request(
  s: ReturnType<typeof fakeSession>,
  contents: { id: number },
  permission: string,
  details: { isMainFrame: boolean; mediaTypes?: string[]; securityOrigin?: string } = {
    isMainFrame: true,
  },
) {
  let granted: boolean | undefined;
  s.requestHandler?.(contents, permission, (g) => (granted = g), details);
  return granted;
}

describe("session hardening (SEC-3)", () => {
  it("keeps the tab partition name in one place", () => {
    expect(TAB_PARTITION).toBe("persist:tabs");
  });

  it("keeps local-file tabs in a partition of their own (SEC-15)", () => {
    expect(LOCAL_FILE_PARTITION).toBe("persist:local-files");
    expect(LOCAL_FILE_PARTITION).not.toBe(TAB_PARTITION);
  });

  it("gives local-file tabs the same deny-by-default handlers as websites (SEC-15)", () => {
    secureSessions();
    const s = sessions.localFiles;
    expect(s.requestHandler).toBeTypeOf("function");
    expect(s.headersListener).toBeTypeOf("function");
    const file = { id: 779 };
    expect(request(s, file, "media", { isMainFrame: true, mediaTypes: ["audio"] })).toBe(false);
    expect(request(s, file, "notifications")).toBe(false);
    expect(request(s, file, "fullscreen")).toBe(true);
  });

  it("installs permission handlers on the app session and the tab session", () => {
    secureSessions();
    for (const s of [sessions.default, sessions.tabs]) {
      expect(s.requestHandler).toBeTypeOf("function");
      expect(s.checkHandler).toBeTypeOf("function");
      expect(s.headersListener).toBeTypeOf("function");
    }
  });

  it("lets the audio capture window capture audio", () => {
    secureSessions();
    const capture = { id: 501, once: vi.fn() };
    trustedContents.trust(capture, "audio-capture");
    expect(
      request(sessions.default, capture, "media", { isMainFrame: true, mediaTypes: ["audio"] }),
    ).toBe(true);
    expect(
      sessions.default.checkHandler?.(capture, "media", "file://", {
        isMainFrame: true,
        mediaType: "audio",
      }),
    ).toBe(true);
  });

  it("refuses the app's own windows screen recording (SEC-16)", () => {
    secureSessions();
    const capture = { id: 502, once: vi.fn() };
    const main = { id: 503, once: vi.fn() };
    trustedContents.trust(capture, "audio-capture");
    trustedContents.trust(main, "main-window");
    for (const page of [capture, main]) {
      // chromeMediaSource "desktop" from the page itself: no media types.
      expect(
        request(sessions.default, page, "media", {
          isMainFrame: true,
          mediaTypes: [],
          securityOrigin: "file:///",
        }),
      ).toBe(false);
      // An input device chosen by id still works.
      expect(
        request(sessions.default, page, "media", { isMainFrame: true, mediaTypes: ["audio"] }),
      ).toBe(true);
    }
  });

  it("refuses a website the microphone, notifications and external apps", () => {
    secureSessions();
    const site = { id: 777 };
    for (const s of [sessions.default, sessions.tabs]) {
      expect(request(s, site, "media", { isMainFrame: true, mediaTypes: ["audio"] })).toBe(false);
      expect(request(s, site, "notifications")).toBe(false);
      expect(request(s, site, "openExternal")).toBe(false);
      expect(
        s.checkHandler?.(site, "media", "https://evil.example", {
          isMainFrame: true,
          mediaType: "audio",
        }),
      ).toBe(false);
      expect(s.checkHandler?.(null, "geolocation", "", { isMainFrame: true })).toBe(false);
    }
  });

  it("still lets websites go full screen", () => {
    secureSessions();
    expect(request(sessions.tabs, { id: 778 }, "fullscreen")).toBe(true);
    expect(request(sessions.tabs, { id: 778 }, "mediaKeySystem")).toBe(false);
  });

  it("lets the app capture the audio of a tab or the player it chose (Discord)", () => {
    secureSessions();
    const tab = { id: 880, once: vi.fn() };
    const player = { id: 881, once: vi.fn() };
    trustedContents.trust(player, "player-view");
    // The capture window calls getUserMedia, so the request names its origin.
    captureTargets.setCapturer("file:///app/audio_capture_window/index.html");
    const tabCapture = { isMainFrame: true, mediaTypes: [] as string[], securityOrigin: "file:///" };
    expect(request(sessions.tabs, tab, "media", tabCapture)).toBe(false);
    expect(request(sessions.default, player, "media", tabCapture)).toBe(false);
    captureTargets.allow(tab);
    captureTargets.allow(player);
    expect(request(sessions.tabs, tab, "media", tabCapture)).toBe(true);
    expect(request(sessions.default, player, "media", tabCapture)).toBe(true);
    captureTargets.revokeAll();
    expect(request(sessions.tabs, tab, "media", tabCapture)).toBe(false);
  });

  it("refuses a captured website its own screen or desktop audio (WP1 review)", () => {
    secureSessions();
    const tab = { id: 882, once: vi.fn() };
    captureTargets.setCapturer("file:///app/audio_capture_window/index.html");
    captureTargets.allow(tab);
    // getUserMedia({ chromeMediaSource: "desktop" }) or getDisplayMedia from
    // the site itself: same permission and media types, the site's origin.
    expect(
      request(sessions.tabs, tab, "media", {
        isMainFrame: true,
        mediaTypes: [],
        securityOrigin: "https://evil.example/",
      }),
    ).toBe(false);
    captureTargets.revokeAll();
  });

  it("rewrites the user agent on both sessions, with the Google sign-in workaround", () => {
    secureSessions();
    for (const s of [sessions.default, sessions.tabs]) {
      const respond = vi.fn();
      s.headersListener?.(
        { url: "https://accounts.google.com/", requestHeaders: { "User-Agent": "Electron" } },
        respond,
      );
      const google = respond.mock.calls[0][0].requestHeaders["User-Agent"];
      expect(google).not.toContain("Electron");
      expect(google).not.toContain("Chrome/");

      s.headersListener?.(
        { url: "https://www.youtube.com/", requestHeaders: { "User-Agent": "Electron" } },
        respond,
      );
      expect(respond.mock.calls[1][0]).toEqual({
        cancel: false,
        requestHeaders: { "User-Agent": expect.stringContaining("Chrome/") },
      });
    }
  });
});

describe("clearBrowsingData", () => {
  it("clears the app session, the tab session and the local-file session", async () => {
    await clearBrowsingData();
    for (const s of [sessions.default, sessions.tabs, sessions.localFiles]) {
      expect(s.clearCache).toHaveBeenCalled();
      expect(s.clearStorageData).toHaveBeenCalledWith({
        storages: ["cookies", "shadercache", "cachestorage"],
      });
    }
  });
});
