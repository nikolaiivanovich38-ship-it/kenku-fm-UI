/**
 * Words and look-ups the Campaigns screens share (the prototype's helpers in views/campaigns.js): dates, session
 * labels, the next session, theme names, and what a track, playlist or pad board is called and where it opens.
 */
import { isFx, playlistTracks, type DomainLookup, type SoundRef, type TrackRole } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PadBoard, Pad, PlaylistInfo, SessionInfo, SessionStatus } from "../../../common/lyre/api";
import { lookupFrom } from "../../../common/lyre/lookup";
import { plural, shownTitle } from "../../../common/lyre/text";
import { DEFAULT_THEME, THEME_CHOICES, THEMES, type ThemeChoice, type ThemeId } from "../../shell/themes";

export { plural };

export const STATUS_WORDS: Record<SessionStatus, string> = { played: "Played", next: "Next", draft: "Draft" };

/** Game systems offered when typing one (the prototype's SYSTEMS); any other can be typed. */
export const SYSTEMS = [
  "D&D 5e",
  "D&D 2024",
  "Pathfinder 2e",
  "Fate Core",
  "Fate Accelerated",
  "Vampire: the Masquerade V5",
  "Call of Cthulhu 7e",
  "Blades in the Dark",
  "Warhammer Fantasy Roleplay",
  "Mothership",
  "Daggerheart",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 5 Nov 2026", or "No date yet". */
export function formatDate(iso: string | null): string {
  if (!iso) return "No date yet";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Session 14: The Drowned Abbey", or "Session 16" before it has a name. */
export function sessionLabel(s: Pick<SessionInfo, "number" | "name">): string {
  return `Session ${s.number}${s.name ? `: ${s.name}` : ""}`;
}

/** What the campaign card and Run next session start: the session marked Next, else the first draft. */
export function nextSession(c: CampaignInfo): SessionInfo | null {
  return c.sessions.find((s) => s.status === "next") ?? c.sessions.find((s) => s.status === "draft") ?? null;
}

/** The session the Live side of the switch loads when none of this campaign is loaded: Next, else the last. */
export function sessionForLive(c: CampaignInfo): SessionInfo | null {
  return c.sessions.find((s) => s.status === "next") ?? c.sessions[c.sessions.length - 1] ?? null;
}

/** A theme's name without its note: "Hearth and Iron". */
export function themeName(id: string): string {
  return THEMES.find((t) => t.id === id)?.name ?? id;
}

/** The note after a theme's name in the prototype's theme list: "D&D", "light", "default". */
export function themeNote(id: string): string {
  return THEME_CHOICES.find((t) => t.value === id)?.label.match(/\((.*)\)/)?.[1] ?? "";
}

/** A new campaign's theme, and the theme of one without (the house default, Candlelit Library). */
export const DEFAULT_CAMPAIGN_THEME: ThemeId = DEFAULT_THEME;

/** The themes a campaign can have, in the prototype's order (Candlelit Library first). */
export const CAMPAIGN_THEME_IDS: readonly ThemeId[] = THEME_CHOICES.map((t) => t.value);

/** The theme a campaign is shown in: always its own (0.5.1), else the base theme from Look and feel. */
export function shownTheme(base: ThemeChoice, own: string | undefined): ThemeId {
  return (CAMPAIGN_THEME_IDS as readonly string[]).includes(own ?? "") ? (own as ThemeId) : base;
}

const ROLE_WORDS: Record<TrackRole, string> = {
  loop_bed: "Loop bed",
  underscore: "Underscore",
  sting: "Sting",
  transition: "Transition",
  effect: "Effect",
};
const LANE_WORDS = { music: "Music", amb: "Ambience", fx: "FX" } as const;

/** m:ss */
export function formatLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Everything the screens show about the library, loaded once and looked up by id. */
export interface LibraryIndex {
  lookup: DomainLookup;
  tracks: LibraryTrack[];
  playlists: PlaylistInfo[];
  boards: PadBoard[];
  track(id: string): LibraryTrack | undefined;
  playlist(id: string): PlaylistInfo | undefined;
  board(id: string): PadBoard | undefined;
  /** A playlist's tracks in playing order (a dynamic one's matches). */
  tracksOf(p: PlaylistInfo): LibraryTrack[];
}

export function libraryIndex(tracks: LibraryTrack[], playlists: PlaylistInfo[], boards: PadBoard[]): LibraryIndex {
  const lookup = lookupFrom(tracks, playlists);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const playlistById = new Map(playlists.map((p) => [p.id, p]));
  const boardById = new Map(boards.map((b) => [b.id, b]));
  return {
    lookup,
    tracks,
    playlists,
    boards,
    track: (id) => trackById.get(id),
    playlist: (id) => playlistById.get(id),
    board: (id) => boardById.get(id),
    tracksOf: (p) => playlistTracks(p, lookup) as LibraryTrack[],
  };
}

/** The pads on a board's grid, in place order (spare pads are not on it). */
export function boardPads(b: PadBoard): Pad[] {
  return b.slots.slice(0, b.cols * b.rows).filter((p): p is Pad => p !== null);
}

export type ItemKind = "track" | "playlist" | "board";

/** Something a scene, session or campaign can hold, as a row shows it (the prototype's info()). */
export interface ItemInfo {
  kind: ItemKind;
  id: string;
  name: string;
  /** Where its name links to. */
  href: string;
  /** The lane colour of its dot. */
  lane: "music" | "amb" | "fx";
  /** What it is: "Track", "Playlist · Dynamic", "Ambience track", "FX · Sting", "Pad board". */
  label: string;
  /** More about it: "Music · 6 tracks", "3:10", "4 × 3 grid · 12 pads". */
  sub: string;
  /** A playlist's sub line on the campaign and session pages: "Music · Manual · 6 tracks". */
  listSub: string;
}

export function trackInfo(t: LibraryTrack): ItemInfo {
  const fx = isFx(t);
  const label = fx ? (t.role === "sting" ? "FX · Sting" : "FX") : t.kind === "amb" ? "Ambience track" : "Track";
  const sub = `${t.role && t.kind === "music" && !fx ? `${ROLE_WORDS[t.role]} · ` : ""}${formatLength(t.durationMs)}`;
  return { kind: "track", id: t.id, name: shownTitle(t), href: `#/library/${t.id}`, lane: fx ? "fx" : t.kind === "amb" ? "amb" : "music", label, sub, listSub: sub };
}

export function playlistInfo(p: PlaylistInfo, index: LibraryIndex): ItemInfo {
  const kind = p.kind === "dynamic" ? "Dynamic" : "Manual";
  const count = plural(index.tracksOf(p).length, "track");
  return {
    kind: "playlist",
    id: p.id,
    name: p.name,
    href: `#/playlist/${p.id}`,
    lane: p.lane,
    label: `Playlist · ${kind}`,
    sub: `${LANE_WORDS[p.lane]} · ${count}`,
    listSub: `${LANE_WORDS[p.lane]} · ${kind} · ${count}`,
  };
}

export function boardInfo(b: PadBoard): ItemInfo {
  const sub = `${b.cols} × ${b.rows} grid · ${plural(boardPads(b).length, "pad")}${b.spare.length ? ` · ${b.spare.length} spare` : ""}`;
  return { kind: "board", id: b.id, name: b.name, href: `#/board/${b.id}`, lane: "fx", label: "Pad board", sub, listSub: `Pad board · ${sub}` };
}

/** A track or playlist in a scene, or undefined when it is no longer in the library. */
export function soundInfo(ref: SoundRef, index: LibraryIndex): ItemInfo | undefined {
  if (ref.kind === "playlist") {
    const p = index.playlist(ref.id);
    return p && playlistInfo(p, index);
  }
  const t = index.track(ref.id);
  return t && trackInfo(t);
}

export const laneWord = (lane: keyof typeof LANE_WORDS) => LANE_WORDS[lane];
export const roleWord = (role: TrackRole) => ROLE_WORDS[role];
