import { useShellSettings } from "./ShellSettings";
import type { ThemeChoice } from "./themes";

/**
 * The theme chosen in Look and feel: "campaign" (each campaign's own, the default) or one theme for everything.
 * Changing it switches the page at once and is remembered.
 */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const { settings, update } = useShellSettings();
  return [settings.theme, (theme) => update({ theme })];
}
