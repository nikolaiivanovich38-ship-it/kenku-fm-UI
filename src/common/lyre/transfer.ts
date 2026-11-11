/**
 * DAT-7 Back up, move or share, and the move report: the rules both LyreApi implementations share, over the API's
 * own shapes (design/prototype/src/views/transfer.js). Pure functions only.
 */
import { playlistTracks } from "../domain";
import type { CampaignInfo, LibraryTrack, PadBoard, PlaylistInfo, SessionInfo, TagGroup, TransferCounts, TransferEstimate, TransferScope } from "./api";
import { lookupFrom } from "./lookup";

/** What Lyre does not take over from Kenku FM, and why that is fine (the move report's last box). */
export const NOT_BROUGHT_ACROSS: readonly { what: string; why: string }[] = [
  { what: "The play queue and what was playing", why: "Lyre starts with nothing playing" },
  { what: "Kenku FM's window size and position", why: "Lyre opens at its own size" },
];

/** The library as the API hands it out: what a .lyre file is made from. */
export interface TransferLibrary {
  tracks: readonly LibraryTrack[];
  playlists: readonly PlaylistInfo[];
  boards: readonly PadBoard[];
  campaigns: readonly CampaignInfo[];
  tagGroups: readonly TagGroup[];
}

/** What a scope holds: its campaign trees (cut down to the session or scene), playlists, boards and tracks. */
export interface TransferContents {
  title: string;
  campaigns: CampaignInfo[];
  playlists: PlaylistInfo[];
  boards: PadBoard[];
  tracks: LibraryTrack[];
  tagGroups: TagGroup[];
}

const sessionName = (s: SessionInfo) => `Session ${s.number}${s.name ? `: ${s.name}` : ""}`;

/**
 * Everything a scope takes with it: a campaign, session or scene takes the playlists, boards and tracks it uses;
 * a playlist its tracks as they are now; a board the tracks its pads play. Null when the scope names something gone.
 */
export function transferContents(scope: TransferScope, lib: TransferLibrary): TransferContents | null {
  const lookup = lookupFrom(lib.tracks, lib.playlists);
  const trackIds = new Set<string>();
  const playlistIds = new Set<string>();
  const boardIds = new Set<string>();
  const takeBoard = (id: string) => {
    boardIds.add(id);
    const b = lib.boards.find((x) => x.id === id);
    for (const pad of b ? [...b.slots, ...b.spare] : []) pad?.sound.trackIds.forEach((t) => trackIds.add(t));
  };
  const takePlaylist = (id: string) => {
    playlistIds.add(id);
    const p = lookup.playlist(id);
    if (p) playlistTracks(p, lookup).forEach((t) => trackIds.add(t.id));
  };
  const takeSession = (s: SessionInfo) => {
    s.playlistIds.forEach(takePlaylist);
    s.boardIds.forEach(takeBoard);
    s.trackIds.forEach((t) => trackIds.add(t));
    for (const sc of s.scenes) {
      for (const ref of [...sc.music, ...(sc.ambience ? [sc.ambience] : [])]) {
        if (ref.kind === "track") trackIds.add(ref.id);
        else takePlaylist(ref.id);
      }
      sc.boardIds.forEach(takeBoard);
    }
  };
  let title: string;
  let campaigns: CampaignInfo[] = [];
  switch (scope.kind) {
    case "library":
      return { title: "The whole library", campaigns: [...lib.campaigns], playlists: [...lib.playlists], boards: [...lib.boards], tracks: [...lib.tracks], tagGroups: [...lib.tagGroups] };
    case "tags":
      return { title: "The tags only", campaigns: [], playlists: [], boards: [], tracks: [], tagGroups: [...lib.tagGroups] };
    case "playlist": {
      const p = lib.playlists.find((x) => x.id === scope.playlistId);
      if (!p) return null;
      takePlaylist(p.id);
      title = p.name;
      break;
    }
    case "board": {
      const b = lib.boards.find((x) => x.id === scope.boardId);
      if (!b) return null;
      takeBoard(b.id);
      title = b.name;
      break;
    }
    default: {
      const c = lib.campaigns.find((x) => x.id === scope.campaignId);
      if (!c) return null;
      if (scope.kind === "campaign") {
        c.playlistIds.forEach(takePlaylist);
        c.boardIds.forEach(takeBoard);
        c.trackIds.forEach((t) => trackIds.add(t));
        c.sessions.forEach(takeSession);
        campaigns = [c];
        title = c.name;
        break;
      }
      const s = c.sessions.find((x) => x.id === scope.sessionId);
      if (!s) return null;
      if (scope.kind === "session") {
        takeSession(s);
        campaigns = [{ ...c, playlistIds: [], boardIds: [], trackIds: [], sessions: [s] }];
        title = sessionName(s);
        break;
      }
      const sc = s.scenes.find((x) => x.id === scope.sceneId);
      if (!sc) return null;
      const one: SessionInfo = { ...s, playlistIds: [], boardIds: [], trackIds: [], scenes: [sc] };
      takeSession(one);
      campaigns = [{ ...c, playlistIds: [], boardIds: [], trackIds: [], sessions: [one] }];
      title = sc.name || "Untitled scene";
    }
  }
  const tracks = lib.tracks.filter((t) => trackIds.has(t.id));
  // The tags those tracks carry, so they tag the same way on the other computer.
  const tagGroups = lib.tagGroups.map((g) => ({ ...g, values: g.values.filter((v) => tracks.some((t) => t.tags[g.id]?.includes(v))) })).filter((g) => g.values.length > 0);
  return { title, campaigns, playlists: lib.playlists.filter((p) => playlistIds.has(p.id)), boards: lib.boards.filter((b) => boardIds.has(b.id)), tracks, tagGroups };
}

/** How many of each thing the contents hold. */
export function transferCounts(c: TransferContents): TransferCounts {
  const sessions = c.campaigns.flatMap((x) => x.sessions);
  return {
    tracks: c.tracks.length,
    playlists: c.playlists.length,
    boards: c.boards.length,
    campaigns: c.campaigns.length,
    sessions: sessions.length,
    scenes: sessions.reduce((n, s) => n + s.scenes.length, 0),
    tagGroups: c.tagGroups.length,
  };
}

/** A file name from a title: no characters Windows refuses in a name. `day` is YYYY-MM-DD, for the whole library. */
export function transferFileName(scope: TransferScope, title: string, day: string): string {
  if (scope.kind === "library") return `Lyre library ${day}.lyre`;
  if (scope.kind === "tags") return `Lyre tags ${day}.lyre`;
  return `${title.replace(/[<>:"/\\|?*]/g, "").trim() || "Lyre"}.lyre`;
}

/** What saving `scope` would put in the file (Save to a file). Null when the scope names something gone. */
export function estimateTransfer(scope: TransferScope, lib: TransferLibrary, day: string): TransferEstimate | null {
  const contents = transferContents(scope, lib);
  if (!contents) return null;
  const files = contents.tracks.filter((t) => t.url?.startsWith("file:"));
  const sizes = files.map((t) => t.sizeBytes);
  return {
    scope,
    title: contents.title,
    fileName: transferFileName(scope, contents.title, day),
    counts: transferCounts(contents),
    audioFiles: files.length,
    audioBytes: sizes.every((n): n is number => typeof n === "number") ? sizes.reduce((a, b) => a + b, 0) : null,
    leaveAudioOutBecause: scope.kind === "tags" ? "Tags have no audio files." : files.length === 0 ? "Nothing in it plays an audio file." : null,
  };
}
