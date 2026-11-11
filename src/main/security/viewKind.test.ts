import { describe, expect, it } from "vitest";
import { classifyViewRequest } from "./viewKind";

const playerUrl = "file:///app/.webpack/renderer/player_window/index.html";

describe("classifyViewRequest (SEC-3, SEC-8)", () => {
  it("recognises the Kenku player view by the player kind and its exact page", () => {
    expect(classifyViewRequest(playerUrl, "player", playerUrl)).toBe("player");
  });

  it("treats a request without a kind as a website tab", () => {
    expect(classifyViewRequest("https://youtube.com", undefined, playerUrl)).toBe("tab");
    expect(classifyViewRequest("", undefined, playerUrl)).toBe("tab");
  });

  it("refuses any other kind, including a preload script path", () => {
    expect(classifyViewRequest(playerUrl, "/tmp/evil.js", playerUrl)).toBe("refused");
    expect(
      classifyViewRequest(playerUrl, "/app/.webpack/renderer/player_window/preload.js", playerUrl),
    ).toBe("refused");
    expect(classifyViewRequest(playerUrl, 1, playerUrl)).toBe("refused");
  });

  it("refuses the player kind on any other page", () => {
    expect(classifyViewRequest("https://evil.example", "player", playerUrl)).toBe("refused");
  });

  it("refuses the player kind when the player page is unknown", () => {
    expect(classifyViewRequest(playerUrl, "player", undefined)).toBe("refused");
  });

  // --- w3-shell ---
  describe("the new interface page (Lyre tab)", () => {
    const lyreUrl = "file:///app/.webpack/renderer/lyre_window/index.html";

    it("recognises the Lyre page by the lyre kind and its exact page", () => {
      expect(classifyViewRequest(lyreUrl, "lyre", playerUrl, lyreUrl)).toBe("lyre");
    });

    it("refuses the lyre kind on any other page, the player's included", () => {
      expect(classifyViewRequest("https://evil.example", "lyre", playerUrl, lyreUrl)).toBe("refused");
      expect(classifyViewRequest(playerUrl, "lyre", playerUrl, lyreUrl)).toBe("refused");
      expect(classifyViewRequest(lyreUrl, "player", playerUrl, lyreUrl)).toBe("refused");
    });

    it("refuses the lyre kind when the Lyre page is unknown", () => {
      expect(classifyViewRequest(lyreUrl, "lyre", playerUrl, undefined)).toBe("refused");
    });

    it("still recognises the old player beside it", () => {
      expect(classifyViewRequest(playerUrl, "player", playerUrl, lyreUrl)).toBe("player");
    });
  });
});
