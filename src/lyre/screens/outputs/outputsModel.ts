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
import type { LaneNowPlaying, RoomNowPlaying } from "../../audio/lyreAudio";
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
  // UX-R9: as in Live, a room nobody is in says so, before Muted or Playing: nobody hears it.
  if (nobodyThere(view)) return { text: "Nobody there", tone: "warn" };
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
  // UX-R9: the one wording for a room nobody is in, as its box says.
  if (!channel.members.length) return `${of.bot.name} is joining ${channel.name}: nobody there.`;
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

/* ---------- w6-rooms: round 6 (OUT-7 Add bot and Kick, Must 2 Nobody there) and OUT-10 (the level meter) ---------- */

/** Add bot on a voice channel: the bots it can put there, and the one it puts there in one click, if any. */
export interface AddBotChoice {
  /** The only free bot: Add bot puts it there at once, no menu. */
  one: string | null;
  /** The short choice: free bots, or with none free every logged-in bot not there, with the room it leaves. */
  choices: { botId: string; name: string; leaves: string | null }[];
}

export function addBotChoice(view: OutputsView, serverId: string, channelId: string): AddBotChoice {
  const here = roomBots(view, serverId, channelId);
  const usable = view.bots.filter((b) => b.bot.login === "ready" && b.bot.serverIds.includes(serverId) && !here.includes(b));
  const free = usable.filter((b) => !b.inRoom);
  const list = free.length ? free : usable;
  return {
    one: free.length === 1 ? free[0].bot.id : null,
    choices: list.map((b) => ({ botId: b.bot.id, name: b.bot.name, leaves: b.inRoom ? b.channel!.name : null })),
  };
}

/** Whether the players in this bot's room hear something now (music or ambience playing, or an effect). */
function playersHear(of: BotView, room: RoomNowPlaying | undefined): boolean {
  return of.inRoom && of.listeners.length > 0 && !of.bot.muted && isPlaying(room);
}

/** Kick never asks; it gets an Undo when the players there were hearing something (OUT-7). */
export function kickLosesSound(of: BotView, room: RoomNowPlaying | undefined): boolean {
  return playersHear(of, room);
}

/** A move away from players who were hearing something gets the same Undo (Must 2). */
export function moveLosesSound(of: BotView, room: RoomNowPlaying | undefined, toChannelId: string): boolean {
  return of.bot.room?.channelId !== toChannelId && playersHear(of, room);
}

type Place = NonNullable<LaneNowPlaying["place"]>;

/** One lane to play again after Undo: the track, from where it was, as it came (its scene or playlist). */
export interface LaneToRestore {
  trackId: string;
  fromMs: number;
  from: { scene: { campaignId: string; sessionId: string; sceneId: string }; at: number } | { playlistId: string; place?: Place } | undefined;
  place: Place | undefined;
}

export interface RoomToRestore {
  botId: string;
  channelId: string;
  lanes: LaneToRestore[];
}

/** What Undo of a Kick needs: the channel the bot was in and what the room played (OUT-7: "back with its music"). */
export function roomToRestore(of: BotView, room: RoomNowPlaying | undefined): RoomToRestore | null {
  if (!of.inRoom || !of.bot.room) return null;
  const lanes: LaneToRestore[] = [];
  for (const lane of [room?.music, room?.ambience]) {
    if (!lane || lane.paused) continue;
    const origin = lane.origin as { kind: string; scene?: unknown; at?: number; playlistId?: string; place?: Place | null };
    const from: LaneToRestore["from"] =
      origin.kind === "scene" && origin.scene
        ? { scene: origin.scene as unknown as { campaignId: string; sessionId: string; sceneId: string }, at: origin.at ?? 0 }
        : origin.kind === "playlist" && origin.playlistId
          ? { playlistId: origin.playlistId, ...(origin.place ? { place: origin.place } : {}) }
          : undefined;
    lanes.push({ trackId: lane.trackId, fromMs: Math.round((lane.position ?? 0) * 1000), from, place: lane.place ?? undefined });
  }
  return { botId: of.bot.id, channelId: of.bot.room.channelId, lanes };
}

/** Must 2: a bot in a voice channel with nobody in it: the players hear nothing from it. */
export function nobodyThere(of: BotView): boolean {
  return of.inRoom && of.bot.room?.status === "connected" && of.listeners.length === 0;
}

/**
 * Must 2's one-click fix, "Move to Table": the channel with the most people (two or more) and no other bot, in a server
 * this bot can join. Null when there is none.
 */
export function busiestChannel(view: OutputsView, of: BotView): { serverId: string; channelId: string; name: string; people: number; where: string } | null {
  let best: { serverId: string; channelId: string; name: string; people: number; where: string } | null = null;
  for (const server of view.outputs.servers) {
    if (!of.bot.serverIds.includes(server.id)) continue;
    for (const channel of server.channels) {
      const n = channel.members.length;
      if (n < 2 || roomBots(view, server.id, channel.id).some((b) => b.bot.id !== of.bot.id)) continue;
      if (of.bot.room?.channelId === channel.id) continue;
      if (!best || n > best.people) best = { serverId: server.id, channelId: channel.id, name: channel.name, people: n, where: `${server.name} › ${channel.name}` };
    }
  }
  return best;
}

/** OUT-10: how full a room's meter is (0 to 1) for a peak level, on a decibel scale from -48 dB to full scale. */
export const METER_FLOOR_DB = -48;
export function meterFill(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.max(0, Math.min(1, 1 - db / METER_FLOOR_DB));
}
