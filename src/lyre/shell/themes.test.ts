import { describe, expect, it } from "vitest";
import { parseRoute } from "./routes";
import { DEFAULT_THEME, THEME_CHOICES, THEMES, themeFor } from "./themes";

const campaignThemes: Record<string, string> = { crown: "hearth", sixth: "candle", ash: "elysium" };
const lookup = (cid: string) => campaignThemes[cid] as never;

function theme(path: string, choice = "candle", campaignInHand?: string, liveCampaign?: string) {
  return themeFor({ choice: choice as never, route: parseRoute(path), campaignInHand, liveCampaign, campaignTheme: lookup });
}

describe("themes (UX-11): five table themes, Candlelit Library the default", () => {
  it("offers the prototype's five themes, Candlelit Library first and the default", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["Candlelit Library", "Fern and Brass", "Hearth and Iron", "Parchment", "Elysium"]);
    expect(DEFAULT_THEME).toBe("candle");
  });

  it("0.5.1: Look and feel chooses the base theme only; there is no \"Each campaign's own\" any more", () => {
    expect(THEME_CHOICES.map((c) => c.label)).toEqual([
      "Candlelit Library (default)",
      "Fern and Brass (logo)",
      "Hearth and Iron (D&D)",
      "Parchment (light)",
      "Elysium (Vampire)",
    ]);
  });

  it("0.5.1: a campaign's theme always shows on its pages, its sessions, the planner and its Live, whatever the base", () => {
    for (const base of ["candle", "parchment", "elysium"]) {
      expect(theme("campaign/crown", base)).toBe("hearth");
      expect(theme("session/ash/s2", base)).toBe("elysium");
      expect(theme("live", base, "crown", "ash")).toBe("elysium");
      // A track's Audio profile opened from a scene or a session of that campaign.
      expect(theme("profile/t13/sc:crown:s14:sc3", base)).toBe("hearth");
      expect(theme("profile/t13/ss:ash:s2", base)).toBe("elysium");
    }
  });

  it("0.5.1: the base theme shows everywhere else, the Library and Campaigns too, and for a campaign without a theme", () => {
    expect(theme("library", "parchment", "crown")).toBe("parchment");
    expect(theme("boards", "elysium", "crown")).toBe("elysium");
    expect(theme("campaigns", "fern", "crown")).toBe("fern");
    expect(theme("look", "parchment", "crown")).toBe("parchment");
    expect(theme("profile/t13", "parchment", "crown")).toBe("parchment");
    expect(theme("profile/t13/pl:p-abbess", "parchment", "crown")).toBe("parchment");
    expect(theme("campaign/unknown", "parchment")).toBe("parchment");
    expect(theme("library")).toBe("candle");
  });

  it("0.5.1: Live with no session loaded uses the campaign in hand's theme", () => {
    expect(theme("live", "parchment", "crown")).toBe("hearth");
    expect(theme("live", "parchment")).toBe("parchment");
  });
});
