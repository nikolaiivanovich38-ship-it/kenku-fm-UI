import { describe, expect, it } from "vitest";
import {
  checkExternalUrl,
  checkTabUrl,
  checkLocalFileUrl,
  checkTypedTabUrl,
  isLocalFile,
  isRefused,
  prependHttp,
} from "./urlPolicy";

describe("checkTabUrl (SEC-6)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc"],
    ["https://example.com", "https://example.com/"],
    ["HTTPS://EXAMPLE.COM/Path", "https://example.com/Path"],
    ["  https://example.com/  ", "https://example.com/"],
    ["https://example.com:8443/a#b", "https://example.com:8443/a#b"],
  ])("allows secure web page %j", (raw, expected) => {
    expect(checkTabUrl(raw)).toEqual({ ok: true, url: expected, insecure: false });
  });

  it("allows http but flags it as insecure", () => {
    expect(checkTabUrl("http://127.0.0.1:3333/")).toEqual({
      ok: true,
      url: "http://127.0.0.1:3333/",
      insecure: true,
    });
    expect(checkTabUrl("HTTP://example.com")).toMatchObject({ ok: true, insecure: true });
  });

  it("converts international domain names to their ASCII form", () => {
    expect(checkTabUrl("https://bücher.de/")).toEqual({
      ok: true,
      url: "https://xn--bcher-kva.de/",
      insecure: false,
    });
  });

  it.each([
    "file:///etc/passwd",
    "FILE:///C:/Windows/win.ini",
    " file:///etc/passwd",
    "file:",
    "\tfile:///etc/passwd\n",
    "chrome://settings",
    "chrome-extension://abc/x.html",
    "devtools://devtools/bundled/inspector.html",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "java\tscript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/uuid",
    "about:blank",
    "about:srcdoc",
    "view-source:https://example.com",
    "ftp://example.com/file",
    "ws://localhost:1234",
    "mailto:someone@example.com",
    "steam://run/1",
    "spotify:track:123",
    "kenku://anything",
  ])("rejects non-web scheme %j", (raw) => {
    const result = checkTabUrl(raw);
    expect(result.ok).toBe(false);
    if (isRefused(result)) {
      expect(result.code).toBe("scheme");
      expect(result.reason).toMatch(/https:\/\/ or http:\/\//);
    }
  });

  it.each([
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "http://:pass@example.com/",
    "https://example.com@evil.com/",
  ])("rejects credentials in %j", (raw) => {
    expect(checkTabUrl(raw)).toMatchObject({ ok: false, code: "credentials" });
  });

  it.each(["", "   ", "\n"])("rejects empty input %j", (raw) => {
    expect(checkTabUrl(raw)).toMatchObject({ ok: false, code: "empty" });
  });

  it.each([
    "not a url",
    "example.com",
    "//example.com",
    "https://",
    "http://exa mple.com",
    "https://[::1",
    "http://%zz",
  ])("rejects garbage %j", (raw) => {
    expect(checkTabUrl(raw)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("rejects non-string input", () => {
    expect(checkTabUrl(undefined as unknown as string)).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(checkTabUrl({ href: "https://x" } as unknown as string)).toMatchObject({
      ok: false,
    });
  });

  it("rejects absurdly long addresses", () => {
    const raw = `https://example.com/${"a".repeat(2 * 1024 * 1024)}`;
    expect(checkTabUrl(raw)).toMatchObject({ ok: false, code: "too-long" });
  });

  it("rejects an address that only becomes too long once normalised", () => {
    // Each "é" in the path is percent-encoded to six characters.
    const raw = `https://example.com/${"é".repeat(1024 * 1024)}`;
    expect(raw.length).toBeLessThan(2 * 1024 * 1024);
    expect(checkTabUrl(raw)).toMatchObject({ ok: false, code: "too-long" });
  });

  it("gives plain-language reasons", () => {
    const result = checkTabUrl("garbage here");
    expect(result.ok).toBe(false);
    if (isRefused(result)) {
      expect(result.reason).toMatch(/web address/i);
    }
  });
});

describe("prependHttp", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["  www.youtube.com/watch?v=1 ", "https://www.youtube.com/watch?v=1"],
    ["localhost:3000", "https://localhost:3000"],
    ["https://example.com", "https://example.com"],
    ["http://example.com", "http://example.com"],
    ["javascript:alert(1)", "javascript:alert(1)"],
    ["file:///etc/passwd", "file:///etc/passwd"],
    ["./relative", "./relative"],
    ["chrome-extension://abc/x.html", "chrome-extension://abc/x.html"],
    ["view-source:https://example.com", "view-source:https://example.com"],
    ["ms-settings:privacy", "ms-settings:privacy"],
    ["example.com:8080/path", "https://example.com:8080/path"],
    ["192.168.1.10:3000", "https://192.168.1.10:3000"],
  ])("%j -> %j", (raw, expected) => {
    expect(prependHttp(raw)).toBe(expected);
  });
});

describe("checkTypedTabUrl", () => {
  it("adds https:// to a bare host before validating", () => {
    expect(checkTypedTabUrl("youtube.com")).toEqual({
      ok: true,
      url: "https://youtube.com/",
      insecure: false,
    });
  });

  it("still rejects dangerous schemes typed by hand", () => {
    expect(checkTypedTabUrl(" javascript:alert(1)")).toMatchObject({ ok: false });
    expect(checkTypedTabUrl("user:pass@example.com")).toMatchObject({ ok: false });
  });

  it("rejects empty input", () => {
    expect(checkTypedTabUrl("  ")).toMatchObject({ ok: false, code: "empty" });
    expect(checkTypedTabUrl("\u200B")).toMatchObject({ ok: false, code: "empty" });
  });

  it("ignores invisible formatting characters pasted with the address", () => {
    expect(checkTypedTabUrl("\u200Byoutube.com\uFEFF ")).toEqual({
      ok: true,
      url: "https://youtube.com/",
      insecure: false,
    });
    expect(checkTypedTabUrl("you\u200Btube.com")).toMatchObject({
      ok: true,
      url: "https://youtube.com/",
    });
  });

  it("refuses a scheme hidden behind an invisible character", () => {
    expect(checkTypedTabUrl("\u200Bjavascript:alert(1)")).toMatchObject({
      ok: false,
      code: "scheme",
    });
  });

  it("refuses other browser schemes instead of treating them as a host", () => {
    expect(checkTypedTabUrl("chrome-extension://abc/x.html")).toMatchObject({
      ok: false,
      code: "scheme",
    });
  });

  it("still treats host:port as a host", () => {
    expect(checkTypedTabUrl("example.com:8080")).toMatchObject({
      ok: true,
      url: "https://example.com:8080/",
    });
  });
});

describe("checkExternalUrl (SEC-10)", () => {
  it("allows https links", () => {
    expect(checkExternalUrl("https://kenku.fm/docs/getting-a-discord-token")).toEqual({
      ok: true,
      url: "https://kenku.fm/docs/getting-a-discord-token",
    });
  });

  it.each([
    "http://kenku.fm",
    "file:///C:/Windows/System32/calc.exe",
    "FILE:///etc/passwd",
    "smb://attacker/share",
    "ms-msdt:/id PCWDiagnostic",
    "javascript:alert(1)",
    "mailto:a@b.c",
    "https://user:pass@kenku.fm",
    "",
    "kenku.fm",
  ])("rejects %j", (raw) => {
    expect(checkExternalUrl(raw).ok).toBe(false);
  });
});

describe("local files (SEC-15)", () => {
  const ask = (url: string) => ({ ok: "ask", kind: "local-file", url });

  it.each([
    ["file:///C:/Music/ambience.html", "file:///C:/Music/ambience.html"],
    ["FILE:///etc/hosts", "file:///etc/hosts"],
    ["file://localhost/etc/hosts", "file:///etc/hosts"],
    ["file:///C:/My%20Sounds/", "file:///C:/My%20Sounds/"],
    // Paths typed or pasted the way Windows Explorer and macOS show them.
    ["C:\\Music\\My Sounds\\rain.html", "file:///C:/Music/My%20Sounds/rain.html"],
    ["d:/maps/index.html", "file:///d:/maps/index.html"],
    ["/home/gm/maps/index.html", "file:///home/gm/maps/index.html"],
  ])("asks before opening %j from the address bar or a bookmark", (raw, url) => {
    const check = checkTypedTabUrl(raw);
    expect(check).toEqual(ask(url));
    expect(isLocalFile(check)).toBe(true);
    expect(isRefused(check)).toBe(false);
  });

  it.each([
    "file://fileserver/share/rain.html",
    "file:////fileserver/share/rain.html",
    "\\\\fileserver\\share\\rain.html",
    "//fileserver/share/rain.html",
  ])("refuses the network share %j", (raw) => {
    expect(checkTypedTabUrl(raw)).toMatchObject({ ok: false, code: "network-file" });
  });

  it.each(["file:///C:/Music%5C..%5Csecret.txt", "file:///home/gm%2F..%2Fsecret"])(
    "refuses hidden path separators in %j",
    (raw) => {
      expect(checkTypedTabUrl(raw)).toMatchObject({ ok: false, code: "invalid" });
    },
  );

  it("never lets a web page open, redirect to or pop up a file (checkTabUrl)", () => {
    expect(checkTabUrl("file:///C:/Music/ambience.html")).toMatchObject({ ok: false, code: "scheme" });
  });

  it("checkLocalFileUrl accepts files only", () => {
    expect(checkLocalFileUrl("file:///etc/hosts")).toEqual(ask("file:///etc/hosts"));
    expect(checkLocalFileUrl("https://example.com/")).toMatchObject({ ok: false, code: "scheme" });
    expect(checkLocalFileUrl("C:\\Music\\x.html")).toMatchObject({ ok: false });
  });

  it("explains a refused network share in plain language", () => {
    const check = checkTypedTabUrl("file://fileserver/share/x.html");
    expect(isRefused(check) && check.reason).toMatch(/network/i);
  });
});
