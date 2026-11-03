import { describe, expect, it, vi } from "vitest";
import { openExternalIfAllowed } from "./externalLinks";

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
