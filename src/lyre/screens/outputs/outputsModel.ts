/**
 * The Outputs screen's rules and words without a screen, ported from design/prototype/src/views/outputs.js: which bot
 * is in which room, the one status pill per box, the Room and Bring… menus with their warnings, Swap rooms, and what
 * the screen says after a move or a Test chime.
 *
 * A bot is "in a room" while it is joining, connected or reconnecting there (the prototype's connecting and
 * connected). The prototype has no bots that are logged out; the app does (no token yet, or Discord refused it), and
 * those boxes say so instead of offering rooms.
 */
import type { LyreBot, LyreOutputs, LyreServer, LyreVoiceChannel } from "../../../common/lyreOutputs";
import type { RoomNowPlaying } from "../../audio/lyreAudio";
import type { StatusTone } from "../../kit/Pills";

/** One bot with its room looked up. */
export interface BotView {
  bot: LyreBot;
  /** The server and channel of its room (or of the join that failed). */
  server?: LyreServer;
  channel?: LyreVoiceChannel;
  /** Joining, connected or reconnecting in `channel`. */
  inRoom: boolean;
  /** "The Gull and Lantern › Table" while in a room, else "". */
  where: string;
  /** The people in its room. */
  listeners: string[];
}

export interface OutputsView {
  outputs: LyreOutputs;
  bots: BotView[];
  channelCount: number;
  /** Bots in rooms (joining or connected). */
  inRooms: number;
}

const IN_ROOM = new Set(["joining", "connected", "reconnecting"]);

export function viewOf(outputs: LyreOutputs): OutputsView {
  const bots = outputs.bots.map((bot): BotView => {
    const server = bot.room ? outputs.servers.find((s) => s.id === bot.room!.serverId) : undefined;
    const channel = server?.channels.find((c) => c.id === bot.room!.channelId);
    const inRoom = Boolean(channel && bot.room && IN_ROOM.has(bot.room.status));
    return { bot, server, channel, inRoom, where: inRoom ? `${server!.name} › ${channel!.name}` : "", listeners: inRoom ? [...channel!.members] : [] };
  });
  return {
    outputs,
    bots,
    channelCount: outputs.servers.reduce((n, s) => n + s.channels.length, 0),
    inRooms: bots.filter((b) => b.inRoom).length,
  };
}

/** A box is named after the room its bot is in, or after the bot while it is in none (L.outputName). */
export function outputName(view: BotView): string {
  return view.inRoom ? view.channel!.name : view.bot.name;
}

export function people(n: number): string {
  return n ? `${n} ${n === 1 ? "person" : "people"}` : "Nobody here";
}

/** "A and B", as the prototype joins bot names. */
export function names(views: readonly BotView[]): string {
  return views.map((v) => v.bot.name).join(" and ");
}

/** The bots in a room. */
export function roomBots(view: OutputsView, serverId: string, channelId: string): BotView[] {
  return view.bots.filter((b) => b.inRoom && b.bot.room?.serverId === serverId && b.bot.room.channelId === channelId);
}

/** The other bots in this bot's room: the players hear both. */
export function heardTwice(view: OutputsView, of: BotView): BotView[] {
  return of.inRoom ? roomBots(view, of.bot.room!.serverId, of.bot.room!.channelId).filter((b) => b.bot.id !== of.bot.id) : [];
}

/** Whether a room plays anything now (music or ambience not paused, or an effect). */
export function isPlaying(room: RoomNowPlaying | undefined): boolean {
  return Boolean(room && ((room.music && !room.music.paused) || (room.ambience && !room.ambience.paused) || room.effects.length > 0));
}

/** The one status pill of a bot's box (the round 4 list, plus the app's logged-out states). */
export function pill(view: BotView, room: RoomNowPlaying | undefined): { text: string; tone: StatusTone } {
  const { bot } = view;
  if (bot.login === "error") return { text: "Could not connect", tone: "warn" };
  if (bot.login === "connecting") return { text: "Connecting", tone: "warn" };
  if (bot.login === "offline") return { text: "Not connected", tone: "idle" };
  if (bot.room?.status === "error") return { text: "Could not join", tone: "warn" };
  if (bot.room?.status === "joining") return { text: "Joining", tone: "warn" };
  if (bot.room?.status === "reconnecting") return { text: "Reconnecting", tone: "warn" };
  if (!view.inRoom) return { text: "Not in a room", tone: "idle" };
  if (bot.muted) return { text: "Muted", tone: "idle" };
  if (isPlaying(room)) return { text: "Playing", tone: "live" };
  if (room?.music?.paused) return { text: "Paused", tone: "idle" };
  return { text: "Silent", tone: "idle" };
}

export interface RoomItem {
  serverId: string;
  channelId: string;
  name: string;
  here: boolean;
  /** "Here now · 5 people", "5 people" or "". */
  sub: string;
  /** Why the players would hear it twice, or nobody would; "" when neither. */
  warn: string;
}

/** The Room menu of one bot: every voice channel of the servers it can join, grouped by server. */
export function roomItems(view: OutputsView, of: BotView): { server: string; items: RoomItem[] }[] {
  return view.outputs.servers
    .filter((server) => of.bot.serverIds.includes(server.id))
    .map((server) => ({
      server: server.name,
      items: server.channels.map((channel): RoomItem => {
        const here = of.inRoom && of.bot.room?.serverId === server.id && of.bot.room.channelId === channel.id;
        const others = roomBots(view, server.id, channel.id).filter((b) => b.bot.id !== of.bot.id);
        const n = channel.members.length;
        const sub = [here ? "Here now" : "", n ? people(n) : ""].filter(Boolean).join(" · ");
        const warn = others.length ? `${names(others)} is here: players would hear it twice` : !n ? (here ? "Nobody is listening" : "Empty: nobody would hear it") : "";
        return { serverId: server.id, channelId: channel.id, name: channel.name, here, sub, warn };
      }),
    }));
}

/** Bring…: the bots that could move to this channel (logged in, can see its server, not already there). */
export function bringItems(view: OutputsView, serverId: string, channelId: string): { botId: string; name: string; sub: string; warn: string }[] {
  const channel = view.outputs.servers.find((s) => s.id === serverId)?.channels.find((c) => c.id === channelId);
  const here = roomBots(view, serverId, channelId);
  const n = channel?.members.length ?? 0;
  const warn = here.length ? `${names(here)} is here: players would hear it twice` : !n ? "Empty: nobody would hear it" : "";
  return view.bots
    .filter((b) => b.bot.login === "ready" && b.bot.serverIds.includes(serverId) && !here.includes(b))
    .map((b) => ({ botId: b.bot.id, name: b.bot.name, sub: b.inRoom ? `Leaves ${b.channel!.name}` : "Not in a room now", warn }));
}

/** Swap rooms: exactly two bots in rooms, in two different channels. */
export function swapPair(view: OutputsView): [BotView, BotView] | null {
  const bots = view.bots.filter((b) => b.inRoom);
  if (bots.length !== 2) return null;
  const [a, b] = bots;
  return a.bot.room!.channelId === b.bot.room!.channelId ? null : [a, b];
}

/** What the screen says after Room or Bring… chose a channel. */
export function moveMessage(view: OutputsView, of: BotView, channelId: string): string {
  const server = view.outputs.servers.find((s) => s.channels.some((c) => c.id === channelId));
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!server || !channel) return "That voice channel has gone. Reconnect the bot in Settings to refresh the list.";
  if (of.inRoom && of.bot.room!.channelId === channelId) return `${of.bot.name} is already in ${channel.name}`;
  const others = roomBots(view, server.id, channelId).filter((b) => b.bot.id !== of.bot.id);
  if (others.length) return `${of.bot.name} is joining ${channel.name}, where ${names(others)} already plays: players will hear it twice`;
  if (!channel.members.length) return `${of.bot.name} is joining ${channel.name}. Nobody is there yet.`;
  return `${of.bot.name} is joining ${channel.name}`;
}

/** Test: whether the chime can play, and what to show and say. */
export function chimeMessage(of: BotView): { ok: true; toast: string; say: string } | { ok: false; toast: string } {
  const { bot } = of;
  if (bot.room?.status === "joining" || bot.room?.status === "reconnecting") return { ok: false, toast: `${bot.name} is still joining. Try again in a moment.` };
  if (!of.inRoom || bot.room?.status !== "connected") return { ok: false, toast: `${bot.name} is not in a voice channel. Choose a room first.` };
  const name = of.channel!.name;
  if (bot.muted) return { ok: false, toast: `${name} is muted: unmute it to hear the test chime` };
  const n = of.listeners.length;
  return { ok: true, toast: `Test chime in ${name} only${n ? ` (${people(n).toLowerCase()} there)` : ": nobody is there to hear it"}`, say: `Test chime played in ${of.where}` };
}
