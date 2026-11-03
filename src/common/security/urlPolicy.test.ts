import { describe, expect, it } from "vitest";
import {
  checkExternalUrl,
  checkTabUrl,
  checkTypedTabUrl,
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
    if (!result.ok) {
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

  it("gives plain-language reasons", () => {
    const result = checkTabUrl("garbage here");
    expect(result.ok).toBe(false);
    if (!result.ok) {
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
    expect(checkTypedTabUrl("file:///etc/passwd")).toMatchObject({ ok: false });
    expect(checkTypedTabUrl(" javascript:alert(1)")).toMatchObject({ ok: false });
    expect(checkTypedTabUrl("user:pass@example.com")).toMatchObject({ ok: false });
  });

  it("rejects empty input", () => {
    expect(checkTypedTabUrl("  ")).toMatchObject({ ok: false, code: "empty" });
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
