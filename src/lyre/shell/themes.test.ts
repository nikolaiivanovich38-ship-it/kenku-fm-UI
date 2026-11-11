import { describe, expect, it } from "vitest";
import { parseRoute } from "./routes";
import { DEFAULT_THEME, THEME_CHOICES, THEMES, themeFor } from "./themes";

const campaignThemes: Record<string, string> = { crown: "hearth", sixth: "candle", ash: "elysium" };
const lookup = (cid: string) => campaignThemes[cid] as never;

function theme(path: string, choice = "campaign", campaignInHand?: string, liveCampaign?: string) {
  return themeFor({ choice: choice as never, route: parseRoute(path), campaignInHand, liveCampaign, campaignTheme: lookup });
}

describe("themes (UX-11): five table themes, Candlelit Library the default", () => {
  it("offers the prototype's five themes, Candlelit Library first and the default", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["Candlelit Library", "Fern and Brass", "Hearth and Iron", "Parchment", "Elysium"]);
    expect(DEFAULT_THEME).toBe("candle");
  });

  it("names the choices as the prototype does", () => {
    expect(THEME_CHOICES.map((c) => c.label)).toEqual([
      "Each campaign's own",
      "Candlelit Library (default)",
      "Fern and Brass (logo)",
      "Hearth and Iron (D&D)",
      "Parchment (light)",
      "Elysium (Vampire)",
    ]);
  });

  it("switches to a campaign's own theme while that campaign is open", () => {
    expect(theme("campaign/crown")).toBe("hearth");
    expect(theme("session/ash/s2")).toBe("elysium");
  });

  it("keeps the campaign in hand's theme on the shared screens (Library, Playlists, Pad boards, Outputs)", () => {
    expect(theme("library", "campaign", "crown")).toBe("hearth");
    expect(theme("boards", "campaign", "ash")).toBe("elysium");
  });

  it("uses the loaded session's campaign on Live", () => {
    expect(theme("live", "campaign", "crown", "ash")).toBe("elysium");
  });

  it("uses the default on Campaigns and Look and feel, and for a campaign without a theme", () => {
    expect(theme("campaigns", "campaign", "crown")).toBe("candle");
    expect(theme("look", "campaign", "crown")).toBe("candle");
    expect(theme("campaign/unknown")).toBe("candle");
    expect(theme("library")).toBe("candle");
  });

  it("uses a theme chosen in Look and feel everywhere", () => {
    expect(theme("campaign/crown", "parchment")).toBe("parchment");
    expect(theme("campaigns", "elysium")).toBe("elysium");
  });
});
