import { describe, expect, it } from "vitest";
import { checkExternalUrl } from "./security/urlPolicy";
import { DISCORD_BOT_HELP_URL, STREAM_DECK_PLUGIN_HELP_URL } from "./helpLinks";

describe("help links", () => {
  it("sends Discord set-up questions to Lyre's own README", () => {
    expect(DISCORD_BOT_HELP_URL).toBe(
      "https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI#connect-your-discord-bot",
    );
  });

  it("links to Kenku FM's website only for its Stream Deck plugin", () => {
    expect(STREAM_DECK_PLUGIN_HELP_URL).toBe("https://www.kenku.fm/docs/using-kenku-remote");
  });

  it("uses addresses the external-link policy opens", () => {
    for (const url of [DISCORD_BOT_HELP_URL, STREAM_DECK_PLUGIN_HELP_URL]) {
      expect(checkExternalUrl(url)).toEqual({ ok: true, url });
    }
  });
});
