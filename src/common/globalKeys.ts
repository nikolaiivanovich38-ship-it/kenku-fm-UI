/**
 * UX-12 (Settings › Keyboard shortcuts, "Next scene and Fade everything out work in other programs too"): which keys
 * Lyre may take from every program on the computer, and how its key names become Electron accelerators. Shared by the
 * main process (src/main/globalKeys.ts, which registers them with globalShortcut) and the Lyre page (which says why a
 * key is refused before it asks).
 *
 * A key registered with globalShortcut is taken from every other program for as long as Lyre runs. So the game master
 * could not type a space in Discord's chat if Next scene kept Space, and could not copy or undo anywhere if it were
 * Ctrl+C or Ctrl+Z. Lyre therefore only offers keys that are not used for typing or by other programs' own commands:
 * an F key (with or without modifiers), Shift+Esc (Lyre's Fade everything out), or a key with two modifiers of which
 * one is Ctrl or Alt (Ctrl+Shift+N, Alt+Shift+N, Ctrl+Alt+PageDown). Review 0.5.0 CR-6: not Ctrl+Alt with a key that
 * types (Ctrl+Alt+E), because Windows reports AltGr as Ctrl+Alt, and AltGr types @, € and # on Belgian AZERTY.
 */
import { SHORTCUT_ACTIONS, type ShortcutAction } from "./domain/round7";

/** The two actions that can work in other programs too. */
export const GLOBAL_KEY_ACTIONS = ["nextScene", "fadeAll"] as const;
export type GlobalKeyAction = (typeof GLOBAL_KEY_ACTIONS)[number];

/** Lyre page → main process (invoke): `{ on, keys }`; answers a GlobalKeysAnswer. */
export const LYRE_GLOBAL_KEYS_SET = "LYRE_GLOBAL_KEYS_SET";
/** Main process → Lyre page: one GlobalKeyAction, each time its key is pressed (in any program, Lyre included). */
export const LYRE_GLOBAL_KEY = "LYRE_GLOBAL_KEY";

export interface GlobalKeysRequest {
  on: boolean;
  /** The keys in use for the two actions, as Lyre names them ("F9", "Shift+Esc"). */
  keys: Partial<Record<GlobalKeyAction, string>>;
}

export interface GlobalKeyRefusal {
  action: GlobalKeyAction;
  key: string;
  /** Plain words for Settings. */
  message: string;
}

export interface GlobalKeysAnswer {
  refused: GlobalKeyRefusal[];
}

/** What the window gets on each press, as a DOM event (Live listens for nextScene). */
export const GLOBAL_KEY_EVENT = "lyre-global-key";

const NAMED: Record<string, string> = {
  Space: "Space",
  Esc: "Escape",
  Left: "Left",
  Right: "Right",
  Up: "Up",
  Down: "Down",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
};

const MODIFIERS: Record<string, string> = { Ctrl: "CommandOrControl", Alt: "Alt", Shift: "Shift" };

function split(key: string): { mods: string[]; main: string } | null {
  if (typeof key !== "string" || key === "" || key.length > 40) return null;
  const parts = key.split("+");
  const main = parts.pop() ?? "";
  if (main === "" || parts.some((p) => !(p in MODIFIERS))) return null;
  return { mods: parts, main };
}

/** A letter, digit, sign or Space: what AltGr (Ctrl+Alt on Windows) can type with. */
function typesACharacter(main: string): boolean {
  return main.length === 1 || main === "Space";
}

function isFKey(main: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(main);
}

/** Lyre's key name ("Ctrl+Shift+N", "Shift+Esc") as an Electron accelerator, or null when it is not one. */
export function acceleratorOf(key: string): string | null {
  const parts = split(key);
  if (!parts) return null;
  const { mods, main } = parts;
  const target = NAMED[main] ?? (isFKey(main) ? main : main.length === 1 ? main : null);
  if (!target) return null;
  return [...mods.map((m) => MODIFIERS[m]), target].join("+");
}

const actionName = (action: ShortcutAction | GlobalKeyAction) => SHORTCUT_ACTIONS.find((a) => a.id === action)?.name ?? action;
const SUGGEST = "a key such as F9 or Ctrl+Shift+N (Change… above), then turn this on.";

/** Why a key cannot work in other programs, in plain words, or null when it can. */
export function globalKeyProblem(action: GlobalKeyAction, key: string): string | null {
  const parts = split(key);
  if (!parts || !acceleratorOf(key)) return `Lyre cannot listen to ${key} in other programs. Give ${actionName(action)} ${SUGGEST}`;
  const { mods, main } = parts;
  if (isFKey(main)) return null;
  if (key === "Shift+Esc") return null;
  const strong = mods.filter((m) => m === "Ctrl" || m === "Alt");
  if (strong.length === 0) return `${key} cannot work in other programs: you type with it there. Give ${actionName(action)} ${SUGGEST}`;
  if (mods.length < 2) return `${key} is a key other programs use for themselves (copy, paste, undo, their menus). Give ${actionName(action)} ${SUGGEST}`;
  if (strong.length === 2 && typesACharacter(main)) {
    return `${key} cannot work in other programs: on many keyboards, the Belgian one among them, Ctrl+Alt is AltGr, which types @, € or # there. Give ${actionName(action)} ${SUGGEST}`;
  }
  return null;
}

/** The request the Lyre page may send: exactly `{ on, keys }`, keys only for the two actions, each short text. */
export function isGlobalKeysRequest(value: unknown): value is GlobalKeysRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => k !== "on" && k !== "keys") || typeof v.on !== "boolean") return false;
  const keys = v.keys;
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return false;
  return Object.entries(keys as Record<string, unknown>).every(
    ([action, key]) => (GLOBAL_KEY_ACTIONS as readonly string[]).includes(action) && typeof key === "string" && key.length <= 40,
  );
}

/** The answer the page accepts from the main process. */
export function isGlobalKeysAnswer(value: unknown): value is GlobalKeysAnswer {
  const refused = (value as { refused?: unknown } | null)?.refused;
  return (
    Array.isArray(refused) &&
    refused.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        (GLOBAL_KEY_ACTIONS as readonly string[]).includes((r as GlobalKeyRefusal).action) &&
        typeof (r as GlobalKeyRefusal).key === "string" &&
        typeof (r as GlobalKeyRefusal).message === "string",
    )
  );
}
