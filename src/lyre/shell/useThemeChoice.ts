import { useShellSettings } from "./ShellSettings";
import type { ThemeChoice } from "./themes";

/**
 * The base theme chosen in Look and feel (0.5.1): every screen but a campaign's own (its pages, sessions, planner and
 * Live), which show its theme. Changing it switches the page at once and is remembered.
 */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const { settings, update } = useShellSettings();
  return [settings.theme, (theme) => update({ theme })];
}
