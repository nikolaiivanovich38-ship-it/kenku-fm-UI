import type { Route } from "./routes";

/**
 * UX-11: the five table themes from the design prototype (tokens.css). One structure, five palettes: only colour and
 * heading type change, so nothing moves between campaigns. A campaign picks its theme and Lyre switches to it while
 * that campaign is open; Look and feel can instead choose one theme for everything.
 */
export type ThemeId = "candle" | "fern" | "hearth" | "parchment" | "elysium";

/** "campaign" follows each campaign's own theme; a theme id uses that theme everywhere. */
export type ThemeChoice = "campaign" | ThemeId;

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  /** The kind of game it suits, in the prototype's words. */
  games: string;
}

/** Lyre's default (the product owner's choice): the Campaigns page, Look and feel and campaigns without a theme. */
export const DEFAULT_THEME: ThemeId = "candle";

export const THEMES: readonly ThemeInfo[] = [
  { id: "candle", name: "Candlelit Library", games: "Lyre's default; wizarding schools, academies, mysteries" },
  { id: "fern", name: "Fern and Brass", games: "Lyre's own colours; any game" },
  { id: "hearth", name: "Hearth and Iron", games: "D&D, Pathfinder, sword and sorcery" },
  { id: "parchment", name: "Parchment", games: "The light version of Candlelit Library" },
  { id: "elysium", name: "Elysium", games: "Vampire: the Masquerade, gothic and noir" },
];

/** The choices, worded as in the prototype's theme menu. */
export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "campaign", label: "Each campaign's own" },
  { value: "candle", label: "Candlelit Library (default)" },
  { value: "fern", label: "Fern and Brass (logo)" },
  { value: "hearth", label: "Hearth and Iron (D&D)" },
  { value: "parchment", label: "Parchment (light)" },
  { value: "elysium", label: "Elysium (Vampire)" },
];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice.value === value);
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export interface ThemeQuery {
  choice: ThemeChoice;
  route: Route;
  /** The last campaign opened (shared screens such as the Library keep its theme). */
  campaignInHand?: string;
  /** The campaign of the session loaded in Live. */
  liveCampaign?: string;
  /** A campaign's own theme, if it has one (from the library; see ShellData). */
  campaignTheme: (campaignId: string) => ThemeId | undefined;
}

/** The theme to show for a screen (the prototype's L.themeFor). */
export function themeFor({ choice, route, campaignInHand, liveCampaign, campaignTheme }: ThemeQuery): ThemeId {
  if (choice !== "campaign") {
    return choice;
  }
  if (route.name === "campaigns" || route.name === "look") {
    return DEFAULT_THEME;
  }
  const campaignId = route.params.cid ?? (route.name === "live" ? (liveCampaign ?? campaignInHand) : campaignInHand);
  const own = campaignId === undefined ? undefined : campaignTheme(campaignId);
  return isThemeId(own) ? own : DEFAULT_THEME;
}
