/**
 * Settings' rules and words without a screen (OUT-8, round 7 SEC-4, PRV-2, PLY-8, UX-12), from
 * design/prototype/src/views/settings.js and r7shell.js.
 */
import { SHORTCUT_ACTIONS, keyName, shortcutKey, shortcutUsing, type ShortcutAction, type ShortcutMap } from "../../../common/domain";
import { listensLocally } from "../../../common/remoteControl";
import type { LyreBot, LyreOutputs } from "../../../common/lyreOutputs";
import type { StatusTone } from "../../kit/Pills";

/* ---------- Discord bots ---------- */

export function loginWords(bot: Pick<LyreBot, "login">): string {
  return { ready: "Connected", connecting: "Connecting…", offline: "Not connected", error: "Could not connect" }[bot.login] ?? "Not connected";
}

export function loginTone(bot: Pick<LyreBot, "login">): StatusTone {
  return ({ ready: "on", connecting: "warn", offline: "idle", error: "warn" } as const)[bot.login] ?? "idle";
}

/** The names of the servers a bot is in, as the main process lists them. */
export function serverNames(outputs: LyreOutputs, bot: Pick<LyreBot, "serverIds">): string[] {
  return bot.serverIds.map((id) => outputs.servers.find((s) => s.id === id)?.name).filter((name): name is string => Boolean(name));
}

/** "••••••••Kq7w": the token's last four characters only (SEC-5); null with no token. */
export function maskedToken(bot: Pick<LyreBot, "tokenEnd">): string | null {
  return bot.tokenEnd ? `••••••••${bot.tokenEnd}` : null;
}

/** Add a bot, in the order Discord needs. */
export const ADD_BOT_STEPS = ["Create it", "Invite it", "Connect it"] as const;

export const DEVELOPER_PORTAL = "https://discord.com/developers/applications";

/** What the last step says once the new bot is connected. */
export function addedWords(outputs: LyreOutputs, bot: Pick<LyreBot, "name" | "serverIds">): { connected: string; where: string; inNoServer: boolean } {
  const servers = serverNames(outputs, bot);
  return { connected: `${bot.name} is connected.`, where: servers.length ? `In ${servers.join(", ")}.` : "It is in no server yet.", inNoServer: servers.length === 0 };
}

/* ---------- Sound to Discord ---------- */

export const STREAMING_MODES = [
  { value: "lowLatency", name: "Best sound quality", description: "Clearer sound; works the computer a little harder." },
  { value: "performance", name: "Lighter on the computer", description: "Leaves more power for other programs; slightly less clear." },
] as const;

/** PLY-8: Between tracks, in whole seconds as the prototype lists them. */
export const CROSSFADE_CHOICES = [0, 1, 2, 3, 5, 8].map((s) => ({ seconds: String(s), ms: s * 1000, label: s === 0 ? "Cut" : `Crossfade ${s} s` }));

export function crossfadeSaved(ms: number): string {
  return ms === 0 ? "cut between tracks" : `crossfade between tracks ${Math.round(ms / 1000)} s`;
}

/* ---------- Remote control ---------- */

export function remoteListen(state: { address: string }): "local" | "home" {
  return listensLocally(state) ? "local" : "home";
}

/* ---------- Keyboard shortcuts ---------- */

export interface ShortcutRow {
  id: ShortcutAction;
  name: string;
  key: string;
  where: string;
}

export function shortcutRows(map: ShortcutMap): ShortcutRow[] {
  return SHORTCUT_ACTIONS.map((a) => ({ id: a.id, name: a.name, key: shortcutKey(map, a.id), where: a.where }));
}

const nameOf = (id: ShortcutAction) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.name ?? id;

export type KeyPress = Parameters<typeof keyName>[0];

/**
 * Change…, then a key: Esc keeps the old key, a modifier on its own waits for the rest, a key another action has is
 * refused with that action's name (r7shell.js captureKey).
 */
export function keyPressed(map: ShortcutMap, action: ShortcutAction, press: KeyPress): { kind: "wait" } | { kind: "keep"; message: string } | { kind: "refused"; message: string } | { kind: "set"; key: string } {
  const name = keyName(press);
  if (!name) return { kind: "wait" };
  const now = shortcutKey(map, action);
  if (name === "Esc") return { kind: "keep", message: `Kept ${now} for ${nameOf(action)}` };
  const other = shortcutUsing(map, name, action);
  if (other) return { kind: "refused", message: `${name} is already ${nameOf(other)}. Press another key, or Esc to keep ${now}` };
  return { kind: "set", key: name };
}

/**
 * Settings › Remote control is hidden in 0.5.1 until Lyre has its own Stream Deck and phone support (WP6; Nik, 11 Nov:
 * "Hide until Stream Deck"). The box (RemotePane) and the main process's settings and code stay for then; the server
 * never starts meanwhile (RemoteManager).
 */
export const SHOW_REMOTE_CONTROL = false;
