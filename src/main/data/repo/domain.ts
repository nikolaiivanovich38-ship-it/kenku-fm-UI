/**
 * The database as the design's shapes (DAT-11, DAT-12): DomainTrack,
 * DomainPlaylist and DomainCampaign trees from src/common/domain, so the engine
 * and the screens can apply the shared rules (sceneSequence, playlistTracks,
 * usesOf*, resolveProfile …) to stored data directly. Read-only; each function
 * reads in a fixed, small number of queries however large the campaign is.
 * Profile overrides keyed for resolveProfile are in profiles.ts (getProfileOverrides).
 */
import type {
  AudioProfileInput,
  DomainCampaign,
  DomainLookup,
  DomainPlaylist,
  DomainScene,
  DomainSession,
  DomainTrack,
  Lane,
  PlaylistRule,
  SoundRef,
  TrackKind,
} from "../../../common/domain";
import { parseJson } from "../designValidate";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import type { Playlist } from "../types";

type DomainTrackRow = {
  id: string;
  kind: string;
  title: string;
  meta_title: string;
  file_name: string;
  duration_ms: number | null;
  role: string | null;
  loopable: string | null;
  energy: number | null;
  profile: string | null;
  /** The track's tag ids joined by TAG_SEPARATOR, or null when it has none. */
  tag_ids: string | null;
};

/** Ids never contain control characters (validate.ts), so this one can join them. */
const TAG_SEPARATOR = "\u001f";
/** One row per track with its tag ids, read through the track_tags primary key: no join or sort over every tag. */
const TRACK_SELECT = `SELECT id, kind, title, meta_title, file_name, duration_ms, role, loopable, energy, profile,
  (SELECT group_concat(tag_id, char(31)) FROM track_tags WHERE track_id = tracks.id) AS tag_ids FROM tracks`;

function toDomainTrack(row: DomainTrackRow, tags: Record<string, string[]>): DomainTrack {
  return {
    id: row.id,
    kind: row.kind as TrackKind,
    title: row.title,
    metaTitle: row.meta_title,
    fileName: row.file_name,
    durationMs: row.duration_ms ?? 0,
    role: row.role as DomainTrack["role"],
    loop: row.loopable as DomainTrack["loop"],
    energy: row.energy,
    tags,
    profile: parseJson<AudioProfileInput>(row.profile),
  };
}

/** A data-layer playlist as the domain's, with a manual playlist's track ids in order. */
export function toDomainPlaylist(playlist: Playlist, trackIds: string[]): DomainPlaylist {
  const base = { id: playlist.id, name: playlist.title, lane: playlist.lane };
  return playlist.kind === "dynamic"
    ? { ...base, kind: "dynamic", rule: playlist.rule as PlaylistRule }
    : { ...base, kind: "manual", trackIds };
}

/**
 * Looks tracks and playlists up in the library, for the shared rules.
 * Answers come from the library as it is when each is first asked and are then
 * kept, so one lookup gives a consistent picture while a scene is worked out;
 * make a new lookup after changes. Every track (for dynamic playlists) is read
 * in one query the first time `tracks()` is called.
 */
export function getDomainLookup(store: Store): DomainLookup {
  const groupIds = store.all<{ id: string }>("SELECT id FROM tag_groups ORDER BY position, rowid").map((g) => g.id);
  // The tag vocabulary is small: read once, each tag with its rank in vocabulary order.
  const vocabulary = new Map(
    store
      .all<{ id: string; group_id: string; name: string }>(
        "SELECT t.id, t.group_id, t.name FROM tags t JOIN tag_groups g ON g.id = t.group_id ORDER BY g.position, t.position, t.rowid",
      )
      .map((tag, rank) => [tag.id, { group: tag.group_id, name: tag.name, rank }]),
  );
  const tracks = new Map<string, DomainTrack | undefined>();
  const playlists = new Map<string, DomainPlaylist | undefined>();
  let all: DomainTrack[] | null = null;

  /** Tag names by group (every group present), each group's names in vocabulary order. */
  const tagsOf = (tagIds: string | null) => {
    const tags: Record<string, string[]> = {};
    for (const id of groupIds) tags[id] = [];
    if (tagIds === null) return tags;
    const found = [];
    for (const id of tagIds.split(TAG_SEPARATOR)) {
      const tag = vocabulary.get(id);
      if (tag) found.push(tag);
    }
    found.sort((a, b) => a.rank - b.rank);
    for (const tag of found) tags[tag.group].push(tag.name);
    return tags;
  };
  const toTrack = (row: DomainTrackRow) => toDomainTrack(row, tagsOf(row.tag_ids));

  return {
    track(id) {
      if (tracks.has(id)) return tracks.get(id);
      const row = store.get<DomainTrackRow>(`${TRACK_SELECT} WHERE id = ?`, id);
      const track = row ? toTrack(row) : undefined;
      tracks.set(id, track);
      return track;
    },
    playlist(id) {
      if (playlists.has(id)) return playlists.get(id);
      const row = store.get<Record<string, SQLInputValue>>("SELECT id, title, lane, kind, rule FROM playlists WHERE id = ?", id);
      let playlist: DomainPlaylist | undefined;
      if (row) {
        const base = { id: row.id as string, name: row.title as string, lane: row.lane as Lane };
        playlist =
          row.kind === "dynamic"
            ? { ...base, kind: "dynamic", rule: parseJson<PlaylistRule>(row.rule as string) as PlaylistRule }
            : {
                ...base,
                kind: "manual",
                trackIds: store
                  .all<{ track_id: string }>(
                    "SELECT track_id FROM playlist_items WHERE playlist_id = ? AND kind = 'track' ORDER BY position, rowid",
                    id,
                  )
                  .map((r) => r.track_id),
              };
      }
      playlists.set(id, playlist);
      return playlist;
    },
    tracks() {
      if (!all) {
        // Library order: the order tracks were added.
        all = store.all<DomainTrackRow>(`${TRACK_SELECT} ORDER BY rowid`).map(toTrack);
        for (const track of all) tracks.set(track.id, track);
      }
      return all;
    },
  };
}

/** Groups rows by a key, keeping their order. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

const ref = (row: { track_id: string | null; playlist_id: string | null }): SoundRef =>
  row.track_id !== null ? { kind: "track", id: row.track_id } : { kind: "playlist", id: row.playlist_id as string };

/** Campaign trees: every campaign, or the one with `campaignId`. Ten queries in all. */
function loadCampaigns(store: Store, campaignId?: string): DomainCampaign[] {
  const only = campaignId === undefined ? "" : "WHERE c.id = ?";
  const params = campaignId === undefined ? [] : [campaignId];
  const inCampaign = (alias: string) => (campaignId === undefined ? "" : `WHERE ${alias}.campaign_id = ?`);
  const campaigns = store.all<{ id: string }>(`SELECT c.id FROM campaigns c ${only} ORDER BY c.position, c.rowid`, ...params);
  if (campaigns.length === 0) return [];

  type Member = { owner: string; member: string };
  const members = (sql: string) => store.all<Member>(sql, ...params);
  const campaignPlaylists = groupBy(
    members(`SELECT m.campaign_id AS owner, m.playlist_id AS member FROM campaign_playlists m ${inCampaign("m")} ORDER BY m.position, m.rowid`),
    (r) => r.owner,
  );
  const campaignBoards = groupBy(
    members(`SELECT m.campaign_id AS owner, m.board_id AS member FROM campaign_boards m ${inCampaign("m")} ORDER BY m.position, m.rowid`),
    (r) => r.owner,
  );
  const sessions = groupBy(
    store.all<{ id: string; campaign_id: string }>(`SELECT s.id, s.campaign_id FROM sessions s ${inCampaign("s")} ORDER BY s.position, s.rowid`, ...params),
    (r) => r.campaign_id,
  );
  const sessionPlaylists = groupBy(
    members(
      `SELECT m.session_id AS owner, m.playlist_id AS member FROM session_playlists m JOIN sessions s ON s.id = m.session_id
       ${inCampaign("s")} ORDER BY m.position, m.rowid`,
    ),
    (r) => r.owner,
  );
  const sessionBoards = groupBy(
    members(
      `SELECT m.session_id AS owner, m.board_id AS member FROM session_boards m JOIN sessions s ON s.id = m.session_id
       ${inCampaign("s")} ORDER BY m.position, m.rowid`,
    ),
    (r) => r.owner,
  );
  const scenes = groupBy(
    store.all<{ id: string; session_id: string; name: string }>(
      `SELECT sc.id, sc.session_id, sc.name FROM scenes sc JOIN sessions s ON s.id = sc.session_id
       ${inCampaign("s")} ORDER BY sc.position, sc.rowid`,
      ...params,
    ),
    (r) => r.session_id,
  );
  const fromScenes = `JOIN scenes sc ON sc.id = m.scene_id JOIN sessions s ON s.id = sc.session_id ${inCampaign("s")}`;
  const music = groupBy(
    store.all<{ scene_id: string; track_id: string | null; playlist_id: string | null }>(
      `SELECT m.scene_id, m.track_id, m.playlist_id FROM scene_music m ${fromScenes} ORDER BY m.position, m.rowid`,
      ...params,
    ),
    (r) => r.scene_id,
  );
  const ambience = new Map(
    store
      .all<{ scene_id: string; track_id: string | null; playlist_id: string | null }>(
        `SELECT m.scene_id, m.track_id, m.playlist_id FROM scene_ambience m ${fromScenes}`,
        ...params,
      )
      .map((r) => [r.scene_id, ref(r)]),
  );
  const sceneBoards = groupBy(
    members(`SELECT m.scene_id AS owner, m.board_id AS member FROM scene_boards m ${fromScenes} ORDER BY m.position, m.rowid`),
    (r) => r.owner,
  );

  const ids = (rows: Member[] | undefined) => (rows ?? []).map((r) => r.member);
  return campaigns.map(
    (c): DomainCampaign => ({
      id: c.id,
      playlistIds: ids(campaignPlaylists.get(c.id)),
      boardIds: ids(campaignBoards.get(c.id)),
      sessions: (sessions.get(c.id) ?? []).map(
        (s): DomainSession => ({
          id: s.id,
          campaignId: c.id,
          playlistIds: ids(sessionPlaylists.get(s.id)),
          boardIds: ids(sessionBoards.get(s.id)),
          scenes: (scenes.get(s.id) ?? []).map(
            (sc): DomainScene => ({
              id: sc.id,
              name: sc.name,
              music: (music.get(sc.id) ?? []).map(ref),
              ambience: ambience.get(sc.id) ?? null,
              boardIds: ids(sceneBoards.get(sc.id)),
            }),
          ),
        }),
      ),
    }),
  );
}

/** One campaign's tree (sessions, scenes, what each uses), or null when there is none with that id. */
export function getDomainCampaign(store: Store, campaignId: string): DomainCampaign | null {
  return loadCampaigns(store, campaignId)[0] ?? null;
}

/** Every campaign's tree in campaign order, for usesOfPlaylist/usesOfBoard/usesOfTrack across the library. */
export function listDomainCampaigns(store: Store): DomainCampaign[] {
  return loadCampaigns(store);
}
