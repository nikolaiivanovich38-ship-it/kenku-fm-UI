import { isThemeChoice, type ThemeChoice } from "./themes";

/**
 * What the new interface remembers between starts, in this page's own storage: the theme chosen in Look and feel,
 * whether the rail shows labels, and which boxes are open or closed. (The library itself is kept by the main
 * process; this is only how the screen looks.)
 */
export interface ShellSettings {
  theme: ThemeChoice;
  /** "auto" shows labels when the window is 1100 px or wider; "full" always; "min" icons only. */
  rail: "auto" | "full" | "min";
  /** Boxes the user opened ("o") or closed ("c"), by box id. Boxes not listed use their default. */
  panes: Record<string, "o" | "c">;
}

export const SHELL_SETTINGS_KEY = "lyre-shell";

const DEFAULTS: ShellSettings = { theme: "campaign", rail: "auto", panes: {} };

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
  return {
    theme: isThemeChoice(stored.theme) ? stored.theme : DEFAULTS.theme,
    rail: stored.rail === "full" || stored.rail === "min" ? stored.rail : DEFAULTS.rail,
    panes,
  };
}

export function saveShellSettings(settings: ShellSettings): void {
  try {
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the settings last for this visit.
  }
}
