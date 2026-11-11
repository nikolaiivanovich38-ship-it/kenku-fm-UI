import type { Route } from "./routes";

/**
 * UX-11: the five table themes from the design prototype (tokens.css). One structure, five palettes: only colour and
 * heading type change, so nothing moves between campaigns. Since 0.5.1 (Nik, 11 Nov: "The campaign's visual theme
 * should override the base / preference theme"), Look and feel chooses the base theme, and a campaign's own theme
 * always shows on its pages, its sessions and planner, and its Live.
 */
import { parseKeyOfPlace } from "../../common/domain";
export type ThemeId = "candle" | "fern" | "hearth" | "parchment" | "elysium";

/**
 * The base theme chosen in Look and feel. Before 0.5.1 it could also be "campaign" (each campaign's own, with a chosen
 * theme winning over every campaign's); loadShellSettings brings that over as DEFAULT_THEME.
 */
export type ThemeChoice = ThemeId;

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
  /** The base theme (Look and feel). */
  choice: ThemeChoice;
  route: Route;
  /** The last campaign opened: Live's campaign while no session is loaded there. */
  campaignInHand?: string;
  /** The campaign of the session loaded in Live. */
  liveCampaign?: string;
  /** A campaign's own theme, if it has one (from the library; see ShellData). */
  campaignTheme: (campaignId: string) => ThemeId | undefined;
}

/** The campaign whose theme a screen shows: a campaign or session page, Live's, or the place a track's profile is opened in. */
function campaignOfScreen({ route, campaignInHand, liveCampaign }: ThemeQuery): string | undefined {
  if (route.params.cid) return route.params.cid;
  if (route.name === "live") return liveCampaign ?? campaignInHand;
  if (route.name === "profile" && route.params.ctx) {
    return parseKeyOfPlace(route.params.ctx)?.campaignId;
  }
  return undefined;
}

/** The theme to show for a screen: the campaign's own on its screens (0.5.1), else the base from Look and feel. */
export function themeFor(query: ThemeQuery): ThemeId {
  const campaignId = campaignOfScreen(query);
  const own = campaignId === undefined ? undefined : query.campaignTheme(campaignId);
  if (isThemeId(own)) return own;
  return isThemeId(query.choice) ? query.choice : DEFAULT_THEME;
}
