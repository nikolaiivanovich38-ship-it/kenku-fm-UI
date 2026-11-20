import { DEFAULT_THEME, isThemeChoice, type ThemeChoice } from "./themes";

/**
 * What the new interface remembers between starts, in this page's own storage: the theme chosen in Look and feel,
 * whether the rail shows labels, which boxes are open or closed, and whether the first-run tour was seen. (The library itself is kept by the main
 * process; this is only how the screen looks.)
 */
export interface ShellSettings {
  theme: ThemeChoice;
  /** "auto" shows labels when the window is 1100 px or wider; "full" always; "min" icons only. */
  rail: "auto" | "full" | "min";
  /** Boxes the user opened ("o") or closed ("c"), by box id. Boxes not listed use their default. */
  panes: Record<string, "o" | "c">;
  /** FND-8: "done" once the first-run tour was finished or skipped. */
  tour?: "done";
  /** Round 10: where each panel that can dock or float was last (Add music: docked left or right, or floating). */
  places?: Record<string, PanelPlace>;
  /** Round 10: a theme was chosen in Look and feel (Set up Lyre's "Choose a theme"); `theme` is always written. */
  themeChosen?: true;
}

/** Round 10 (rows 12 and 37): a panel docked beside the screen (with the width Nik gave it), or floating over it. */
export type PanelPlace = { dock: "left" | "right"; width?: number } | { dock: "float"; left: number; top: number; width: number; height: number };

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A remembered place as it was stored, or null when it is damaged. */
export function panelPlaceOf(value: unknown): PanelPlace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.dock === "left" || v.dock === "right") return isNumber(v.width) ? { dock: v.dock, width: v.width } : { dock: v.dock };
  if (v.dock === "float" && isNumber(v.left) && isNumber(v.top) && isNumber(v.width) && isNumber(v.height)) {
    return { dock: "float", left: v.left, top: v.top, width: v.width, height: v.height };
  }
  return null;
}

export const SHELL_SETTINGS_KEY = "lyre-shell";

const DEFAULTS: ShellSettings = { theme: DEFAULT_THEME, rail: "auto", panes: {} };

/** The remembered settings, with defaults for anything missing or damaged. */
export function loadShellSettings(): ShellSettings {
  let stored: Partial<Record<keyof ShellSettings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SHELL_SETTINGS_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      stored = parsed as typeof stored;
    }
  } catch {
    // Damaged settings: start from the defaults rather than fail to open.
  }
  const panes: ShellSettings["panes"] = {};
  if (stored.panes && typeof stored.panes === "object") {
    for (const [id, state] of Object.entries(stored.panes as Record<string, unknown>)) {
      if (state === "o" || state === "c") {
        panes[id] = state;
      }
    }
  }
  const places: Record<string, PanelPlace> = {};
  if (stored.places && typeof stored.places === "object") {
    for (const [id, value] of Object.entries(stored.places as Record<string, unknown>)) {
      const place = panelPlaceOf(value);
      if (place) places[id] = place;
    }
  }
  return {
    // 0.5.1: the old "campaign" choice (each campaign's own) is not a theme, so it becomes the default base theme.
    theme: isThemeChoice(stored.theme) ? stored.theme : DEFAULTS.theme,
    rail: stored.rail === "full" || stored.rail === "min" ? stored.rail : DEFAULTS.rail,
    panes,
    ...(stored.tour === "done" ? { tour: "done" as const } : {}),
    ...(Object.keys(places).length ? { places } : {}),
    ...(stored.themeChosen === true ? { themeChosen: true as const } : {}),
  };
}

export function saveShellSettings(settings: ShellSettings): void {
  try {
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the settings last for this visit.
  }
}
