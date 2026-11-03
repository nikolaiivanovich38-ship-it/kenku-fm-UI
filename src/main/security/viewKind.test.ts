import { describe, expect, it } from "vitest";
import { classifyViewRequest } from "./viewKind";

const player = {
  url: "file:///app/.webpack/renderer/player_window/index.html",
  preload: "/app/.webpack/renderer/player_window/preload.js",
};

describe("classifyViewRequest (SEC-3)", () => {
  it("recognises the Kenku player view by its exact page and preload", () => {
    expect(classifyViewRequest(player.url, player.preload, player)).toBe("player");
  });

  it("treats a request without a preload as a website tab", () => {
    expect(classifyViewRequest("https://youtube.com", undefined, player)).toBe("tab");
    expect(classifyViewRequest("", undefined, player)).toBe("tab");
  });

  it("refuses a preload script that is not the player's", () => {
    expect(classifyViewRequest(player.url, "/tmp/evil.js", player)).toBe("refused");
  });

  it("refuses the player preload on any other page", () => {
    expect(classifyViewRequest("https://evil.example", player.preload, player)).toBe(
      "refused",
    );
  });

  it("refuses everything privileged when the player entry is unknown", () => {
    expect(
      classifyViewRequest(player.url, player.preload, { url: undefined, preload: undefined }),
    ).toBe("refused");
  });
});
