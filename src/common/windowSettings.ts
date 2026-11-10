/**
 * OUT-8 (w6-rooms): the settings of the main window that Settings in Lyre shows too: Sound to Discord (the streaming
 * mode) and Website tabs (the address bar, microphones and other inputs, several inputs at once). The main window
 * keeps them, as Kenku FM did (src/renderer/features/settings/settingsSlice.ts, saved in its own storage), and tells
 * the main process each time they change (WINDOW_SETTINGS_STATE); the main process passes them to the Lyre page
 * (LYRE_WINDOW_SETTINGS_STATE) and passes a change from the Lyre page back to the main window (WINDOW_SETTINGS_SET),
 * so there is one place where each setting lives and both Settings always agree. Nothing else of the main window's
 * state crosses (windowSettingsOf).
 */

export type StreamingMode = "lowLatency" | "performance";

export interface WindowSettings {
  /** PERF-8: "lowLatency" is Best sound quality, "performance" Lighter on the computer (the stored names are old). */
  streamingMode: StreamingMode;
  urlBarEnabled: boolean;
  externalInputsEnabled: boolean;
  multipleInputsEnabled: boolean;
}

export type WindowSettingsChange = Partial<WindowSettings>;

/** Kenku FM's defaults, which the main window starts with. */
export const DEFAULT_WINDOW_SETTINGS: Readonly<WindowSettings> = Object.freeze({
  streamingMode: "performance",
  urlBarEnabled: true,
  externalInputsEnabled: false,
  multipleInputsEnabled: false,
});

/** Main window → main process: its settings, after each change (send, one WindowSettings). */
export const WINDOW_SETTINGS_STATE = "WINDOW_SETTINGS_STATE";
/** Main process → main window: a change Settings in Lyre made (one WindowSettingsChange). */
export const WINDOW_SETTINGS_SET = "WINDOW_SETTINGS_SET";
/** Lyre page → main process (invoke): the latest WindowSettings, or null until the main window has told them. */
export const LYRE_WINDOW_SETTINGS_GET = "LYRE_WINDOW_SETTINGS_GET";
/** Lyre page → main process (invoke): a change; answers false when there is no main window to take it. */
export const LYRE_WINDOW_SETTINGS_SET = "LYRE_WINDOW_SETTINGS_SET";
/** Main process → Lyre page: one WindowSettings, after each change. */
export const LYRE_WINDOW_SETTINGS_STATE = "LYRE_WINDOW_SETTINGS_STATE";
/** Lyre page → main process (invoke): Settings › Local files, the folders that open without asking. */
export const LYRE_LOCAL_FOLDERS_LIST = "LYRE_LOCAL_FOLDERS_LIST";
/** Lyre page → main process (invoke, one folder): Ask again for that folder; answers the list left. */
export const LYRE_LOCAL_FOLDERS_FORGET = "LYRE_LOCAL_FOLDERS_FORGET";
/** Lyre page → main process (invoke): Website tabs › Clear website data (the old Settings' Clear cache). */
export const LYRE_CLEAR_WEBSITE_DATA = "LYRE_CLEAR_WEBSITE_DATA";

const KEYS = ["streamingMode", "urlBarEnabled", "externalInputsEnabled", "multipleInputsEnabled"] as const;

const CHECKS: Record<(typeof KEYS)[number], (value: unknown) => boolean> = {
  streamingMode: (value) => value === "lowLatency" || value === "performance",
  urlBarEnabled: (value) => typeof value === "boolean",
  externalInputsEnabled: (value) => typeof value === "boolean",
  multipleInputsEnabled: (value) => typeof value === "boolean",
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Exactly a WindowSettings: the four keys, each of its kind. */
export function isWindowSettings(value: unknown): value is WindowSettings {
  return isObject(value) && Object.keys(value).length === KEYS.length && KEYS.every((key) => CHECKS[key](value[key]));
}

/** A change: one or more of the four keys, each of its kind, and nothing else. */
export function isWindowSettingsChange(value: unknown): value is WindowSettingsChange {
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, item]) => (KEYS as readonly string[]).includes(key) && CHECKS[key as (typeof KEYS)[number]](item));
}

/** The four settings out of the main window's whole settings state; a value of the wrong kind is the default. */
export function windowSettingsOf(state: Record<string, unknown>): WindowSettings {
  const out = { ...DEFAULT_WINDOW_SETTINGS } as Record<string, unknown>;
  for (const key of KEYS) if (CHECKS[key](state[key])) out[key] = state[key];
  return out as unknown as WindowSettings;
}
