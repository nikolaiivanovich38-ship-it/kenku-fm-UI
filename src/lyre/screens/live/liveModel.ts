/**
 * Live's rules and words without a screen, ported from design/prototype/src/views/live.js (round 6 part 3: seven
 * boxes): which session Live loads, the rooms (a part of On air per bot in a voice channel) and their one status,
 * where each box sends its sound (To:), Find a track or playlist, the trays' contents, the pad boards, how Up next
 * folds, the end words and what each key does.
 *
 * What plays is the audio host's (getNowPlaying); Live only reads it here.
 */
import { isFx, SHORTCUT_ACTIONS, type AudioProfile, type ProfileSource, type RoomTarget } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, Pad, PadBoard, PlaylistInfo, SceneInfo, SessionInfo } from "../../../common/lyre/api";
import type { LyreBot, LyreOutputs } from "../../../common/lyreOutputs";
import type { NowPlaying, RoomNowPlaying, UpNextEntryNow } from "../../audio/lyreAudio";
import type { LiveSession } from "../../kit/liveSession";
import type { StatusTone } from "../../kit/Pills";
import { boardPads, formatLength, sessionForLive, type LibraryIndex } from "../campaigns/model";
import { isPlaying, nobodyThere, viewOf, type BotView } from "../outputs/outputsModel";

/**
 * The boxes that start sound, each with its own room (To:): Current scene (its music, ambience and pads), Find, the
 * session's and the campaign's playlists and pads. Scenes always start in the first room.
 */
export type LiveBox = "music" | "off" | "ss" | "cp" | "ssd" | "cpd";
export const BOX_WORDS: Record<LiveBox, string> = {
  music: "Current scene",
  off: "Find",
  ss: "Session playlists",
  cp: "Campaign playlists",
  ssd: "Session pads",
  cpd: "Campaign pads",
};

/**
 * The seven boxes in the order of Alt+1 to Alt+7 and of F6 (round 6 part 6: On air is box 1), top to bottom and left
 * to right, the same in every layout. The ids are the boxes' Pane ids.
 */
export const LIVE_BOXES = [
  { id: "lv-onair", name: "On air" },
  { id: "lv-scenes", name: "Scenes" },
  { id: "lv-current", name: "Current scene" },
  { id: "lv-ssp", name: "Session playlists" },
  { id: "lv-ssd", name: "Session pads" },
  { id: "lv-cpp", name: "Campaign playlists" },
  { id: "lv-cpd", name: "Campaign pads" },
] as const;

/** The audio host's name for the first room while no bot is in a voice channel. */
export const TABLE = "table";

/** How long Undo is offered after a scene change. */
export const UNDO_MS = 8000;

/* ---------- the session ---------- */

/** The session loaded in Live, else the next session of the campaign in hand, else of the first campaign. */
export function defaultLiveSession(campaigns: readonly CampaignInfo[], loaded: LiveSession | null, inHand: string | undefined): LiveSession | null {
  if (loaded) {
    const c = campaigns.find((x) => x.id === loaded.campaignId);
    if (c?.sessions.some((s) => s.id === loaded.sessionId)) return loaded;
    const s = c && sessionForLive(c);
    if (c && s) return { campaignId: c.id, sessionId: s.id };
  }
  const campaign = campaigns.find((c) => c.id === inHand && c.sessions.length) ?? campaigns.find((c) => c.sessions.length);
  const session = campaign && sessionForLive(campaign);
  return campaign && session ? { campaignId: campaign.id, sessionId: session.id } : null;
}

/* ---------- rooms ---------- */

export interface LiveRoom {
  /** The audio host's room id: the bot's id. */
  roomId: string;
  /** The voice channel's name. */
  name: string;
  /** The bot, when the outputs are known (mute, volume, moving it). */
  bot: LyreBot | null;
  /** What it plays; null while the audio host has not heard of the room yet. */
  room: RoomNowPlaying | null;
  /** The bot with its channel looked up (Kick, moving it, Nobody there), when the outputs are known. */
  view: BotView | null;
  /** Must 2: its voice channel has nobody in it (bots apart): the players hear nothing there. */
  nobody: boolean;
}

/**
 * The rooms in order (the first is where scenes play): each bot joining or in a voice channel, named after it. Without
 * the outputs (no bridge), the audio host's rooms; the table alone (no bot in a voice channel) is no room.
 */
export function liveRooms(outputs: LyreOutputs | null, now: NowPlaying): LiveRoom[] {
  if (outputs) {
    return viewOf(outputs)
      .bots.filter((b) => b.inRoom)
      .map((b) => ({ roomId: b.bot.id, name: b.channel!.name, bot: b.bot, room: now.rooms.find((r) => r.roomId === b.bot.id) ?? null, view: b, nobody: nobodyThere(b) }));
  }
  return now.rooms.filter((r) => r.roomId !== TABLE).map((r): LiveRoom => ({ roomId: r.roomId, name: r.name, bot: null, room: r, view: null, nobody: false }));
}

/** A room's one status pill. */
export function roomStatus(r: LiveRoom): { text: string; tone: StatusTone } {
  const status = r.bot?.room?.status;
  if (status === "joining" || status === "reconnecting") return { text: "Joining", tone: "warn" };
  if (r.nobody) return { text: "Nobody there", tone: "warn" };
  if (r.bot?.muted) return { text: "Muted", tone: "idle" };
  if (isPlaying(r.room ?? undefined)) return { text: "Playing", tone: "live" };
  if (r.room?.music?.paused) return { text: "Paused", tone: "idle" };
  return { text: "Silent", tone: "idle" };
}

export interface ChannelChoice {
  channelId: string;
  name: string;
  /** This bot is there now. */
  here: boolean;
  /** Another bot is there: a room already. */
  taken: boolean;
  /** "5 people · players" (Must 2: where most players are), "1 person", "empty", or "a room already". */
  sub: string;
  /** Nobody is in it (UX-R9: a bot joining says "nobody there"). */
  empty: boolean;
}

const peopleWords = (n: number) => (n === 0 ? "empty" : `${n} ${n === 1 ? "person" : "people"}`);

/**
 * Every voice channel a bot can join, by server, marking where it is, where another bot plays already, where nobody
 * is and (Must 2 of the round 6 review) where the players are: the channel most people are in.
 */
export function channelChoices(outputs: LyreOutputs, bot: LyreBot): { server: string; items: ChannelChoice[] }[] {
  const view = viewOf(outputs);
  const players = busiestChannel(outputs);
  return outputs.servers
    .filter((s) => bot.serverIds.includes(s.id))
    .map((s) => ({
      server: s.name,
      items: s.channels.map((c) => {
        const here = view.bots.some((b) => b.bot.id === bot.id && b.inRoom && b.bot.room?.channelId === c.id);
        const taken = view.bots.some((b) => b.bot.id !== bot.id && b.inRoom && b.bot.room?.channelId === c.id);
        const most = !!players && players.people > 0 && players.channelId === c.id;
        return { channelId: c.id, name: c.name, here, taken, empty: c.members.length === 0, sub: taken ? "a room already" : `${peopleWords(c.members.length)}${most ? " · players" : ""}` };
      }),
    }));
}

/** Add a room: each logged-in bot in no voice channel, with the channels it could join. */
export function addRoomChoices(outputs: LyreOutputs | null): { bot: LyreBot; servers: { server: string; items: ChannelChoice[] }[] }[] {
  if (!outputs) return [];
  const view = viewOf(outputs);
  return view.bots.filter((b) => b.bot.login === "ready" && !b.inRoom).map((b) => ({ bot: b.bot, servers: channelChoices(outputs, b.bot) }));
}

/** The channel most people are in: where the one-click fix sends a bot when nobody hears anything. */
export function busiestChannel(outputs: LyreOutputs | null): { serverId: string; serverName: string; channelId: string; name: string; people: number } | null {
  let best: { serverId: string; serverName: string; channelId: string; name: string; people: number } | null = null;
  for (const s of outputs?.servers ?? []) {
    for (const c of s.channels) {
      if (!best || c.members.length > best.people) best = { serverId: s.id, serverName: s.name, channelId: c.id, name: c.name, people: c.members.length };
    }
  }
  return best;
}

/** Where a box plays: the room it chose while that room is there (or all rooms), else the first room. */
export function boxTarget(rooms: readonly LiveRoom[], choice: string | undefined): { choice: string; targets: RoomTarget[]; name: string } {
  if (rooms.length === 0) return { choice: TABLE, targets: [{ room: TABLE }], name: "Table" };
  if (choice === "all" && rooms.length > 1) return { choice: "all", targets: rooms.map((r) => ({ room: r.roomId })), name: "all rooms" };
  const r = rooms.find((x) => x.roomId === choice) ?? rooms[0];
  return { choice: r.roomId, targets: [{ room: r.roomId }], name: r.name };
}

/** BUG-19: the status of On air's part while no bot is in a voice channel: what plays goes nowhere. */
export function noRoomStatus(table: RoomNowPlaying | null): { text: string; tone: StatusTone } {
  const sounds = !!table && (!!table.music || !!table.ambience || table.effects.length > 0);
  return sounds ? { text: "Nobody hears it", tone: "warn" } : { text: "Silent", tone: "idle" };
}

/* ---------- Up next ---------- */

/** Round 6 part 6: On air is at the top, so Up next stays short: past this many lines it folds to one. */
export const UPNEXT_LINES = 4;

export type UpNextRow =
  | { kind: "entry"; entry: UpNextEntryNow; at: number }
  /** An ambience waiting for Next on the room's ambience (Live's own list), by its place in that list. */
  | { kind: "ambience"; at: number }
  /** "n more": unfolds Up next. `inline`: it sits in the one line Up next folds to. */
  | { kind: "more"; n: number; inline: boolean };

/**
 * Up next as On air shows it (live.js upNextBlock): folded, the plan shows its next track only, with "n more" for the
 * rest of it; what was added shows, each to be taken out; the ambience waiting comes last. Past four lines it is one
 * line: the first entry and how many more. Unfolded, everything, with Show fewer (`fewer`) when there was more.
 */
export function upNextRows(list: readonly UpNextEntryNow[], ambience: number, open: boolean): { rows: UpNextRow[]; fewer: boolean } {
  const all: UpNextRow[] = [...list.map((entry, at): UpNextRow => ({ kind: "entry", entry, at })), ...Array.from({ length: ambience }, (_, at): UpNextRow => ({ kind: "ambience", at }))];
  if (open) {
    const plans = list.filter((e) => e.kind === "planned").length;
    return { rows: all, fewer: plans > 1 || all.length > UPNEXT_LINES };
  }
  const rows: UpNextRow[] = [];
  let plans = 0;
  let hidden = 0;
  let gap = false;
  for (const row of all) {
    const planned = row.kind === "entry" && row.entry.kind === "planned";
    if (planned && ++plans > 1) {
      hidden++;
      continue;
    }
    if (!planned && hidden && !gap) {
      rows.push({ kind: "more", n: hidden, inline: false });
      gap = true;
    }
    rows.push(row);
  }
  if (hidden && !gap) rows.push({ kind: "more", n: hidden, inline: false });
  if (rows.length > UPNEXT_LINES) return { rows: [all[0], { kind: "more", n: all.length - 1, inline: true }], fewer: false };
  return { rows, fewer: false };
}

/* ---------- Find a track or playlist (was Off script) ---------- */

export interface TagPick {
  group: string;
  value: string;
}

export interface OffScriptQuery {
  q: string;
  tags: readonly TagPick[];
  lane: "all" | "music" | "amb" | "fx";
}

const hasTag = (t: LibraryTrack, tag: TagPick) => (t.tags[tag.group] ?? []).includes(tag.value);

/**
 * The prototype's search: every word must be somewhere in a track's titles, file, artist, album, role or tags; every
 * picked tag must match. When no track has all of two or more picked tags, the tracks with some of them, most first
 * (`any`).
 */
export function offScriptSearch(tracks: readonly LibraryTrack[], { q, tags, lane }: OffScriptQuery): { list: LibraryTrack[]; any: boolean } {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const base = tracks.filter((t) => {
    if (lane === "fx" ? !isFx(t) : lane !== "all" && t.kind !== lane) return false;
    if (!words.length) return true;
    const hay = [t.title, t.metaTitle, t.fileName, t.artist, t.album, t.role ?? "", ...Object.values(t.tags).flat()].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (!tags.length) return { list: base, any: false };
  const all = base.filter((t) => tags.every((tag) => hasTag(t, tag)));
  if (all.length || tags.length < 2) return { list: all, any: false };
  const count = (t: LibraryTrack) => tags.filter((tag) => hasTag(t, tag)).length;
  const some = base.filter((t) => count(t) > 0).sort((a, b) => count(b) - count(a));
  return { list: some, any: true };
}

/** The moods, the most used first (the first eight show before All tags). */
export function moodsByUse(tracks: readonly LibraryTrack[], moods: readonly string[]): string[] {
  const uses = new Map<string, number>();
  for (const t of tracks) for (const m of t.tags.mood ?? []) uses.set(m, (uses.get(m) ?? 0) + 1);
  return [...moods].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0));
}

/**
 * ORG-14 (round 6 part 6: "The search bar should be able to find a track or a playlist"): the tracks as Off script
 * found them, and the playlists whose name or notes hold every word (the Music, Ambience and FX filter applies to
 * them too); with tags picked, a playlist one of whose tracks has all of them. Null until there are words or tags.
 */
export function findSearch(index: LibraryIndex, query: OffScriptQuery): { tracks: LibraryTrack[]; playlists: PlaylistInfo[]; any: boolean; count: number } | null {
  if (!query.q.trim() && !query.tags.length) return null;
  const { list, any } = offScriptSearch(index.tracks, query);
  const words = query.q.toLowerCase().split(/\s+/).filter(Boolean);
  const playlists = index.playlists.filter((p) => {
    if (query.lane !== "all" && p.lane !== query.lane) return false;
    const hay = `${p.name} ${p.notes ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
    return !query.tags.length || index.tracksOf(p).some((t) => query.tags.every((tag) => hasTag(t, tag)));
  });
  return { tracks: list, playlists, any, count: list.length + playlists.length };
}

/* ---------- the trays ---------- */

/** A session's or a campaign's music playlists (each once, in its order) and single tracks (ORG-12), for its box. */
export function trayContents(own: Pick<SessionInfo, "playlistIds" | "trackIds">, index: LibraryIndex): { playlists: string[]; tracks: string[] } {
  const playlists = [...new Set(own.playlistIds)].filter((id) => index.playlist(id)?.lane === "music");
  return { playlists, tracks: (own.trackIds ?? []).filter((id) => index.track(id)) };
}

/* ---------- pads ---------- */

/** A scene's pad boards that still exist; the first shows when the scene starts. */
export function sceneBoards(scene: SceneInfo | null, index: LibraryIndex): PadBoard[] {
  return (scene?.boardIds ?? []).map((id) => index.board(id)).filter((b): b is PadBoard => !!b);
}

/** The board Current scene shows (its pad keys are the live keys): the one chosen among the scene's, else its first. */
export function currentBoard(chosen: string | null, scene: SceneInfo | null, index: LibraryIndex): PadBoard | null {
  const boards = sceneBoards(scene, index);
  return boards.find((b) => b.id === chosen) ?? boards[0] ?? null;
}

/** A session's or campaign's boards that still exist, in its order, each once. */
export function ownBoards(ids: readonly string[], index: LibraryIndex): PadBoard[] {
  return [...new Set(ids)].map((id) => index.board(id)).filter((b): b is PadBoard => !!b);
}

/**
 * Round 7 part 2 (PLY-8): what a pad's own steps do that the game master would not see happen, said when it is pressed
 * in Live (r7play.js): "Music down to 30% over 2 s". Null when its steps have nothing to say.
 */
export function padStepWords(pad: Pad): string | null {
  const fade = pad.steps?.find((st): st is Extract<NonNullable<Pad["steps"]>[number], { do: "fade" }> => st.do === "fade");
  if (!fade) return null;
  return `Music down to ${Math.round(fade.level * 100)}% over ${Math.round(fade.ms / 100) / 10} s`;
}

/** The pad on the board's grid with this key (letters in any case, F1 to F12); spare pads' keys do nothing. */
export function padForKey(board: PadBoard, key: string): Pad | null {
  const k = key.toLowerCase();
  return boardPads(board).find((p) => p.key && p.key.toLowerCase() === k) ?? null;
}

/** The board's pad keys, as the Keys list shows them ("1 2 3 Q W"). */
export function padKeys(board: PadBoard | null): string[] {
  return board ? boardPads(board).flatMap((p) => (p.key ? [p.key.toUpperCase()] : [])) : [];
}

/* ---------- words ---------- */

const AFTER_WORDS = { scene: "scene", session: "session list", playlist: "playlist" } as const;

/** What happens at the end of a track where it plays: "Ends 3:10, then next (scene setting)". */
export function endWords(profile: AudioProfile, source: ProfileSource): string {
  const then = profile.after === "loop" ? `loops from ${formatLength(profile.loopStartMs)}` : profile.after === "stop" ? "then stops" : "then next";
  return `Ends ${formatLength(profile.endMs)}, ${then}${source === "track" ? "" : ` (${AFTER_WORDS[source]} setting)`}`;
}

/* ---------- keys ---------- */

/** The four keys of Live that Settings › Keyboard shortcuts can change, as keyName writes them. */
export interface LiveKeys {
  nextScene: string;
  fadeAll: string;
  undo: string;
  find: string;
  /** Find and play (Ctrl+K), listed in Keys (UX-R15). */
  palette: string;
}

const keyOf = (id: keyof LiveKeys) => SHORTCUT_ACTIONS.find((a) => a.id === id)!.key;
/** Lyre's own keys: Space, Shift+Esc, Ctrl+Z and /. */
export const LIVE_KEYS: LiveKeys = { nextScene: keyOf("nextScene"), fadeAll: keyOf("fadeAll"), undo: keyOf("undo"), find: keyOf("find"), palette: keyOf("palette") };

/** A key pressed alone (no Ctrl or Alt, not F1 to F12): it obeys the single-key shortcuts switch (WCAG 2.1.4). */
export function isSingleKey(key: string): boolean {
  return !/^(Ctrl|Alt)\+/.test(key) && !/^F\d/.test(key);
}

export interface KeyInput {
  /** KeyboardEvent.key */
  key: string;
  /** The key as Settings writes it (keyName: "Space", "Shift+Esc", "Ctrl+Z", "R"). */
  name: string;
  /** KeyboardEvent.code, for Alt+1 to Alt+7 whatever the keyboard's layout. */
  code: string;
  shift: boolean;
  /** Ctrl, or Cmd on a Mac. */
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
  /** Focus is in a text box, a slider, a tick box or a list (the prototype's L.typing). */
  typing: boolean;
  /** Focus is in Find a track, and what it holds. */
  inSearch: boolean;
  searchValue: string;
  /** Focus is on a button, a link or a menu item. */
  onControl: boolean;
  /** Focus is on a scene's name in Scenes (Right unfolds it, Left folds it). */
  onSceneName: boolean;
  /** The last move was with Tab, so Space presses the button there. */
  keyNav: boolean;
  /** Single-key shortcuts (Space, / and the pad keys) are on (WCAG 2.1.4). */
  keys1: boolean;
  /** The Keys list is open. */
  keysOpen: boolean;
  /** Find's results are open under its field. */
  findOpen: boolean;
  /** Find has words or tags. */
  searchActive: boolean;
  /** The keys as Settings › Keyboard shortcuts has them. */
  keys: LiveKeys;
}

export type KeyDecision =
  | { kind: "none" }
  /** Handled already: nothing more happens (a held key repeating). */
  | { kind: "swallow" }
  | { kind: "fadeAll" }
  | { kind: "closeKeys" }
  | { kind: "undo" }
  | { kind: "clearSearchBox" }
  | { kind: "leaveSearchBox" }
  | { kind: "closeFind" }
  | { kind: "clearSearch" }
  | { kind: "nextScene" }
  | { kind: "focusSearch" }
  /** Alt+1 to Alt+7: the box at this place in LIVE_BOXES. */
  | { kind: "goBox"; box: number }
  | { kind: "unfoldScene" }
  | { kind: "foldScene" }
  | { kind: "pad"; key: string };

/** What a key does on the live screen (live.js L.onKey), before menus and other screens' keys. */
export function liveKey(k: KeyInput): KeyDecision {
  const none: KeyDecision = { kind: "none" };
  const { keys } = k;
  const next: KeyDecision = k.repeat ? { kind: "swallow" } : { kind: "nextScene" };
  if (k.alt && !k.ctrl && /^Digit[1-7]$/.test(k.code)) return { kind: "goBox", box: Number(k.code.slice(5)) - 1 };
  if (k.alt) return none;
  // Shift+Esc: two keys, so it is never pressed by accident; works even from a text box.
  if (k.name === keys.fadeAll) return { kind: "fadeAll" };
  if (k.key === "Escape" && k.keysOpen) return { kind: "closeKeys" };
  if (k.name === keys.undo) return k.typing ? none : { kind: "undo" };
  // A Next scene key with Ctrl or Alt (or F1 to F12) is not a single key: it works whatever the switch says.
  if (k.name === keys.nextScene && !isSingleKey(keys.nextScene)) return next;
  if (k.ctrl) return none;
  if (k.typing) {
    if (k.key === "Escape" && k.inSearch) return k.searchValue || k.searchActive ? { kind: "clearSearchBox" } : { kind: "leaveSearchBox" };
    return none;
  }
  if (k.key === "Escape") return k.findOpen ? { kind: "closeFind" } : k.searchActive ? { kind: "clearSearch" } : none;
  if (k.onSceneName && (k.key === "ArrowRight" || k.key === "ArrowLeft")) return { kind: k.key === "ArrowRight" ? "unfoldScene" : "foldScene" };
  if (!k.keys1) return none;
  if (k.name === keys.nextScene) return k.onControl && k.keyNav && (k.key === " " || k.key === "Enter") ? none : next;
  // Space and Enter press the control with focus; neither is ever a pad's key.
  if (k.key === "Enter" || k.key === " ") return none;
  if (k.name === keys.find) return { kind: "focusSearch" };
  if (k.key.length === 1 || /^F([1-9]|1[0-2])$/.test(k.key)) return { kind: "pad", key: k.key.toLowerCase() };
  return none;
}
