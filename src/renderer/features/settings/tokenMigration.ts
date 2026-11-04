/**
 * Saved-settings migration for WP2 (redux-persist version 5).
 *
 * SEC-5: the Discord bot token used to be saved in plain text with the other
 * settings (localStorage "persist:root"). It is handed to the main process
 * once, which keeps it encrypted (and ignores it if a bot already has a
 * token), and removed from the saved settings.
 * OUT-1: the "Multiple Outputs" switch is replaced by the output list.
 * WP1 review 4: the old value can stay on disk in Chromium's storage files
 * until they are compacted, which the app cannot force safely, so Settings
 * shows a one-time notice recommending a new token (`legacyTokenNotice`).
 */
export function moveTokenOutOfSettings<S>(state: S, handOver: (token: string) => void): S {
  const saved = state as { settings?: Record<string, unknown> } | undefined;
  if (!saved?.settings) {
    return state;
  }
  const { discordToken, multipleOutputsEnabled, ...settings } = saved.settings;
  if (discordToken === undefined && multipleOutputsEnabled === undefined) {
    return state;
  }
  if (typeof discordToken === "string" && discordToken.trim() !== "") {
    handOver(discordToken.trim());
    return { ...saved, settings: { ...settings, legacyTokenNotice: true } } as S;
  }
  return { ...saved, settings } as S;
}
