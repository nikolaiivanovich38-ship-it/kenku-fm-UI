/**
 * Live's rules and words without a screen, ported from design/prototype/src/views/live.js: which session Live loads,
 * the rooms (one On air box per bot in a voice channel) and their one status, where each box sends its sound (To:),
 * Off script search, what Scene music offers, the pad boards, the end words and what each key does.
 *
 * What plays is the audio host's (getNowPlaying); Live only reads it here.
 */
import { isFx, type AudioProfile, type ProfileSource, type RoomTarget } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, Pad, PadBoard, SceneInfo, SessionInfo } from "../../../common/lyre/api";
import type { LyreBot, LyreOutputs } from "../../../common/lyreOutputs";
import type { NowPlaying, RoomNowPlaying } from "../../audio/lyreAudio";
import type { LiveSession } from "../../kit/liveSession";
import type { StatusTone } from "../../kit/Pills";
import { boardPads, formatLength, sessionForLive, type LibraryIndex } from "../campaigns/model";
import { isPlaying, viewOf } from "../outputs/outputsModel";

/** The three boxes that start sound, each with its own room (To:). */
export type LiveBox = "music" | "off" | "pads";
export const BOX_WORDS: Record<LiveBox, string> = { music: "Scene music", off: "Off script", pads: "Pads" };

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
}

/**
 * The rooms in order (the first is where scenes play): each bot joining or in a voice channel, named after it. Without
 * the outputs (no bridge), the audio host's rooms; the table alone (no bot in a voice channel) is no room.
 */
export function liveRooms(outputs: LyreOutputs | null, now: NowPlaying): LiveRoom[] {
  if (outputs) {
    return viewOf(outputs)
      .bots.filter((b) => b.inRoom)
      .map((b) => ({ roomId: b.bot.id, name: b.channel!.name, bot: b.bot, room: now.rooms.find((r) => r.roomId === b.bot.id) ?? null }));
  }
  return now.rooms.filter((r) => r.roomId !== TABLE).map((r): LiveRoom => ({ roomId: r.roomId, name: r.name, bot: null, room: r }));
}

/** A room's one status pill. */
export function roomStatus(r: LiveRoom): { text: string; tone: StatusTone } {
  const status = r.bot?.room?.status;
  if (status === "joining" || status === "reconnecting") return { text: "Joining", tone: "warn" };
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
  /** "5 people", "1 person", "Empty", or "a room already". */
  sub: string;
}

const peopleWords = (n: number) => (n === 0 ? "Empty" : `${n} ${n === 1 ? "person" : "people"}`);

/** Every voice channel a bot can join, by server, marking where it is and where another bot plays already. */
export function channelChoices(outputs: LyreOutputs, bot: LyreBot): { server: string; items: ChannelChoice[] }[] {
  const view = viewOf(outputs);
  return outputs.servers
    .filter((s) => bot.serverIds.includes(s.id))
    .map((s) => ({
      server: s.name,
      items: s.channels.map((c) => {
        const here = view.bots.some((b) => b.bot.id === bot.id && b.inRoom && b.bot.room?.channelId === c.id);
        const taken = view.bots.some((b) => b.bot.id !== bot.id && b.inRoom && b.bot.room?.channelId === c.id);
        return { channelId: c.id, name: c.name, here, taken, sub: taken ? "a room already" : peopleWords(c.members.length) };
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

/* ---------- Off script ---------- */

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

/* ---------- Scene music ---------- */

export interface PlaylistGroups {
  /** The scene's music playlists, in its order. */
  scene: string[];
  session: string[];
  campaign: string[];
  /** ORG-12: single tracks kept on hand. */
  sessionTracks: string[];
  campaignTracks: string[];
}

/** What Scene music can show: the scene's own list, the session's and the campaign's music playlists (each once). */
export function playlistGroups(scene: SceneInfo | null, session: SessionInfo, campaign: CampaignInfo, index: LibraryIndex): PlaylistGroups {
  const seen = new Set<string>();
  const music = (ids: readonly string[]) =>
    ids.filter((id) => {
      if (seen.has(id) || index.playlist(id)?.lane !== "music") return false;
      seen.add(id);
      return true;
    });
  return {
    scene: music((scene?.music ?? []).filter((m) => m.kind === "playlist").map((m) => m.id)),
    session: music(session.playlistIds),
    campaign: music(campaign.playlistIds),
    sessionTracks: (session.trackIds ?? []).filter((id) => index.track(id)),
    campaignTracks: (campaign.trackIds ?? []).filter((id) => index.track(id)),
  };
}

/** "scene" (the scene's list in order) or the session or campaign playlist chosen; null when there is nothing. */
export function selectedList(chosen: string | null, groups: PlaylistGroups, scene: SceneInfo | null): string | null {
  if (chosen && chosen !== "scene" && [...groups.session, ...groups.campaign].includes(chosen)) return chosen;
  if (scene && scene.music.length) return "scene";
  return groups.session[0] ?? groups.campaign[0] ?? null;
}

/* ---------- pads ---------- */

/** A scene's pad boards that still exist; the first shows when the scene starts. */
export function sceneBoards(scene: SceneInfo | null, index: LibraryIndex): PadBoard[] {
  return (scene?.boardIds ?? []).map((id) => index.board(id)).filter((b): b is PadBoard => !!b);
}

/** The board the Pads box shows: the one chosen, else the scene's first, else the first board. */
export function currentBoard(chosen: string | null, scene: SceneInfo | null, index: LibraryIndex): PadBoard | null {
  return (chosen ? index.board(chosen) : undefined) ?? sceneBoards(scene, index)[0] ?? index.boards[0] ?? null;
}

/** The board menu: this scene's, this session's, this campaign's, then every other board, each board once. */
export function boardMenu(scene: SceneInfo | null, session: SessionInfo, campaign: CampaignInfo, index: LibraryIndex): { label: string; boards: PadBoard[] }[] {
  const seen = new Set<string>();
  const group = (label: string, ids: readonly string[]) => ({
    label,
    boards: ids
      .map((id) => index.board(id))
      .filter((b): b is PadBoard => {
        if (!b || seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      }),
  });
  return [
    group("This scene", scene?.boardIds ?? []),
    group("This session", session.boardIds),
    group("This campaign", campaign.boardIds),
    group(
      "Other boards",
      index.boards.map((b) => b.id),
    ),
  ].filter((g) => g.boards.length);
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

export interface KeyInput {
  /** KeyboardEvent.key */
  key: string;
  shift: boolean;
  /** Ctrl, or Cmd on a Mac. */
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
  /** Focus is in a text box, a slider, a tick box or a list (the prototype's L.typing). */
  typing: boolean;
  /** Focus is in the Off script search box, and what it holds. */
  inSearch: boolean;
  searchValue: string;
  /** Focus is on a button, a link or a menu item. */
  onControl: boolean;
  /** The last move was with Tab, so Space presses the button there. */
  keyNav: boolean;
  /** Single-key shortcuts (Space, / and the pad keys) are on (WCAG 2.1.4). */
  keys1: boolean;
  /** The Keys list is open. */
  keysOpen: boolean;
  /** Off script has words or tags. */
  searchActive: boolean;
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
  | { kind: "clearSearch" }
  | { kind: "nextScene" }
  | { kind: "focusSearch" }
  | { kind: "pad"; key: string };

/** What a key does on the live screen (live.js L.onKey), before menus and other screens' keys. */
export function liveKey(k: KeyInput): KeyDecision {
  const none: KeyDecision = { kind: "none" };
  if (k.alt) return none;
  // Two keys, so it is never pressed by accident: works even from a text box.
  if (k.key === "Escape" && k.shift) return { kind: "fadeAll" };
  if (k.key === "Escape" && k.keysOpen) return { kind: "closeKeys" };
  if (k.ctrl && !k.shift && k.key.toLowerCase() === "z") return k.typing ? none : { kind: "undo" };
  if (k.ctrl) return none;
  if (k.typing) {
    if (k.key === "Escape" && k.inSearch) return k.searchValue ? { kind: "clearSearchBox" } : { kind: "leaveSearchBox" };
    return none;
  }
  if (k.key === "Escape") return k.searchActive ? { kind: "clearSearch" } : none;
  if (!k.keys1) return none;
  if (k.key === " ") {
    if (k.onControl && k.keyNav) return none;
    return k.repeat ? { kind: "swallow" } : { kind: "nextScene" };
  }
  if (k.key === "/") return { kind: "focusSearch" };
  if (k.key.length === 1 || /^F([1-9]|1[0-2])$/.test(k.key)) return { kind: "pad", key: k.key.toLowerCase() };
  return none;
}
