import { describe, expect, it, vi } from "vitest";
import { EXTERNAL_LINK_LIMIT, openExternalIfAllowed, rateLimitedExternalOpener } from "./externalLinks";

describe("openExternalIfAllowed (SEC-10)", () => {
  it("opens https links in the system browser", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    expect(
      openExternalIfAllowed("https://kenku.fm/docs/using-kenku-remote", openExternal),
    ).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(
      "https://kenku.fm/docs/using-kenku-remote",
    );
  });

  it.each([
    "file:///C:/Windows/System32/calc.exe",
    "smb://attacker/share/payload.exe",
    "ms-msdt:/id PCWDiagnostic",
    "http://kenku.fm",
    "javascript:alert(1)",
    "",
  ])("never hands %j to the operating system", (url) => {
    const openExternal = vi.fn();
    expect(openExternalIfAllowed(url, openExternal)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("swallows errors from the operating system", async () => {
    const openExternal = vi.fn().mockRejectedValue(new Error("no browser"));
    expect(() => openExternalIfAllowed("https://kenku.fm", openExternal)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("rateLimitedExternalOpener (CR51-9)", () => {
  it("hands at most a few links a second to the system browser, then lets more through once the time has passed", () => {
    let time = 0;
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const open = rateLimitedExternalOpener(openExternal, () => time);
    for (let i = 0; i < 20; i++) open(`https://example.com/${i}`);
    expect(openExternal).toHaveBeenCalledTimes(EXTERNAL_LINK_LIMIT.max);
    time += EXTERNAL_LINK_LIMIT.windowMs + 1;
    open("https://discord.com/developers/applications");
    expect(openExternal).toHaveBeenCalledTimes(EXTERNAL_LINK_LIMIT.max + 1);
  });

  it("still refuses what is not an https address, without using up the allowance", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const open = rateLimitedExternalOpener(openExternal, () => 0);
    for (let i = 0; i < 10; i++) open("file:///C:/Windows/System32/calc.exe");
    expect(openExternal).not.toHaveBeenCalled();
    open("https://example.com/");
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
