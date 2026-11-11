/**
 * The database as the design's shapes (DAT-11, DAT-12): DomainTrack,
 * DomainPlaylist and DomainCampaign trees from src/common/domain, so the engine
 * and the screens can apply the shared rules (sceneSequence, playlistTracks,
 * usesOf*, resolveProfile …) to stored data directly. Read-only; each function
 * reads in a fixed, small number of queries however large the campaign is.
 * Profile overrides keyed for resolveProfile are in profiles.ts (getProfileOverrides);
 * listUses answers usesOfPlaylist/usesOfBoard/usesOfTrack from the database's
 * indexes without loading every campaign.
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
  NormaliseChoice,
  PlaylistRule,
  SoundRef,
  TrackKind,
  TagTree,
  TrackShape,
  Use,
} from "../../../common/domain";
import type { Store } from "../store";
import { LOUDNESS_COLUMNS, LOUDNESS_JOIN } from "./loudness";
import { ownPlayOrders } from "./playOrders";
import { ownProfiles } from "./profileRows";
import { readRules } from "./ruleRows";
import { getTagTree } from "./round7";

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
  shape: string | null;
  /** DAT-13: the shape suggested from the track's peaks (kept ahead of the levels, so the levels are not read). */
  suggested_shape: string | null;
  /** The track's tag ids joined by TAG_SEPARATOR, or null when it has none. */
  tag_ids: string | null;
  /** PLY-15: its own normalising choice; DAT-15: what was measured from its current file (repo/loudness.ts). */
  normalise: string | null;
  loudness_lufs: number | null;
  loudness_peak: number | null;
  /** Version 6: Ending "Fades out" (PLY-4), Pick up where it stopped (PLY-4) and Follow with (SHW-3). */
  ending: string | null;
  resume: number;
  follow_track_id: string | null;
  follow_playlist_id: string | null;
};

/** Ids never contain control characters (validate.ts), so this one can join them. */
const TAG_SEPARATOR = "\u001f";
/**
 * One row per track with its tag ids, each as "<added>:<id>" (DAT-10: the order they were added in), read through the
 * track_tags primary key: no join or sort over every tag.
 */
const TRACK_SELECT = `SELECT tracks.id AS id, kind, title, meta_title, file_name, duration_ms, role, loopable, energy, shape, normalise, ending, resume, ${LOUDNESS_COLUMNS},
  (SELECT follow_track_id FROM track_follows WHERE track_id = tracks.id) AS follow_track_id,
  (SELECT follow_playlist_id FROM track_follows WHERE track_id = tracks.id) AS follow_playlist_id,
  (SELECT suggested_shape FROM track_peaks WHERE track_id = tracks.id) AS suggested_shape,
  (SELECT group_concat(added || ':' || tag_id, char(31)) FROM track_tags WHERE track_id = tracks.id) AS tag_ids FROM tracks ${LOUDNESS_JOIN}`;

function toDomainTrack(row: DomainTrackRow, tags: Record<string, string[]>, profile: AudioProfileInput | null): DomainTrack {
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
    profile,
    shape: row.shape as TrackShape | null,
    suggestedShape: row.suggested_shape as TrackShape | null,
    normalise: row.normalise as NormaliseChoice | null,
    loudness: row.loudness_lufs !== null && row.loudness_peak !== null ? { lufs: row.loudness_lufs, truePeakDb: row.loudness_peak } : null,
    // Version 6 (PLY-4, SHW-3): only when chosen, so a track with none has the shape it always had.
    ...(row.ending === "fades" ? { fadesOut: true } : {}),
    ...(row.resume === 1 ? { resume: true } : {}),
    ...(row.follow_track_id ? { follow: { kind: "track" as const, id: row.follow_track_id } } : row.follow_playlist_id ? { follow: { kind: "playlist" as const, id: row.follow_playlist_id } } : {}),
  };
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

  /** Tag names by group (every group present), each group's names in the order added (DAT-10), then vocabulary order. */
  const tagsOf = (tagIds: string | null) => {
    const tags: Record<string, string[]> = {};
    for (const id of groupIds) tags[id] = [];
    if (tagIds === null) return tags;
    const found = [];
    for (const entry of tagIds.split(TAG_SEPARATOR)) {
      const at = entry.indexOf(":");
      const tag = vocabulary.get(entry.slice(at + 1));
      if (tag) found.push({ ...tag, added: Number(entry.slice(0, at)) });
    }
    found.sort((a, b) => a.added - b.added || a.rank - b.rank);
    for (const tag of found) tags[tag.group].push(tag.name);
    return tags;
  };
  const toTrack = (row: DomainTrackRow, profiles: Map<string, AudioProfileInput>) =>
    toDomainTrack(row, tagsOf(row.tag_ids), profiles.get(row.id) ?? null);

  let tree: TagTree | null = null;
  return {
    /** DAT-10: tags inside other tags, so a rule naming one finds the tags inside it (matchesRule). */
    tagTree() {
      tree ??= getTagTree(store);
      return tree;
    },
    track(id) {
      if (tracks.has(id)) return tracks.get(id);
      const row = store.get<DomainTrackRow>(`${TRACK_SELECT} WHERE tracks.id = ?`, id);
      const track = row ? toTrack(row, ownProfiles(store, [id])) : undefined;
      tracks.set(id, track);
      return track;
    },
    playlist(id) {
      if (playlists.has(id)) return playlists.get(id);
      const row = store.get<{
        id: string;
        title: string;
        lane: Lane;
        kind: string;
        rule_energy_min: number | null;
        rule_energy_max: number | null;
        rule_leave_out_stings: number;
        normalise: NormaliseChoice | null;
      }>("SELECT id, title, lane, kind, rule_energy_min, rule_energy_max, rule_leave_out_stings, normalise FROM playlists WHERE id = ?", id);
      let playlist: DomainPlaylist | undefined;
      if (row) {
        const base = { id: row.id, name: row.title, lane: row.lane, order: ownPlayOrders(store, [row.id]).get(row.id) ?? null, normalise: row.normalise };
        playlist =
          row.kind === "dynamic"
            ? { ...base, kind: "dynamic", rule: readRules(store, [row]).get(row.id) as PlaylistRule }
            : {
                ...base,
                kind: "manual",
                trackIds: store
                  .all<{ track_id: string }>(
                    "SELECT track_id FROM playlist_items WHERE playlist_id = ? AND kind = 'track' ORDER BY position",
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
        // Library order: the order tracks were added (added_seq, kept by undo).
        const profiles = ownProfiles(store, "all");
        all = store.all<DomainTrackRow>(`${TRACK_SELECT} ORDER BY tracks.added_seq`).map((row) => toTrack(row, profiles));
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

/**
 * The twelve queries that load campaign trees: for one campaign (each takes its id)
 * or for all. Each walks the "in order" indexes from the campaign down
 * (sessions_order, scenes_order, scene_music_order …) and sorts in that same
 * order, so SQLite needs no sorting step. Exported for the query-plan tests.
 */
export function campaignTreeQueries(oneCampaign: boolean) {
  const only = (alias: string, column = "campaign_id") => (oneCampaign ? `WHERE ${alias}.${column} = ?` : "");
  const fromScenes = `JOIN scenes sc ON sc.id = m.scene_id JOIN sessions s ON s.id = sc.session_id ${only("s")}`;
  return {
    campaigns: `SELECT c.id FROM campaigns c ${only("c", "id")} ORDER BY c.position`,
    campaignPlaylists: `SELECT m.campaign_id AS owner, m.playlist_id AS member FROM campaign_playlists m ${only("m")} ORDER BY m.campaign_id, m.position`,
    campaignBoards: `SELECT m.campaign_id AS owner, m.board_id AS member FROM campaign_boards m ${only("m")} ORDER BY m.campaign_id, m.position`,
    campaignTracks: `SELECT m.campaign_id AS owner, m.track_id AS member FROM campaign_tracks m ${only("m")} ORDER BY m.campaign_id, m.position`,
    sessions: `SELECT s.id, s.campaign_id FROM sessions s ${only("s")} ORDER BY s.campaign_id, s.position`,
    sessionPlaylists: `SELECT m.session_id AS owner, m.playlist_id AS member FROM sessions s
      JOIN session_playlists m ON m.session_id = s.id ${only("s")} ORDER BY s.campaign_id, s.position, m.position`,
    sessionBoards: `SELECT m.session_id AS owner, m.board_id AS member FROM sessions s
      JOIN session_boards m ON m.session_id = s.id ${only("s")} ORDER BY s.campaign_id, s.position, m.position`,
    sessionTracks: `SELECT m.session_id AS owner, m.track_id AS member FROM sessions s
      JOIN session_tracks m ON m.session_id = s.id ${only("s")} ORDER BY s.campaign_id, s.position, m.position`,
    scenes: `SELECT sc.id, sc.session_id, sc.name FROM sessions s JOIN scenes sc ON sc.session_id = s.id ${only("s")}
      ORDER BY s.campaign_id, s.position, sc.position`,
    music: `SELECT m.scene_id, m.track_id, m.playlist_id FROM scene_music m ${fromScenes} ORDER BY s.campaign_id, s.position, sc.position, m.position`,
    ambience: `SELECT m.scene_id, m.track_id, m.playlist_id FROM scene_ambience m ${fromScenes}`,
    sceneBoards: `SELECT m.scene_id AS owner, m.board_id AS member FROM scene_boards m ${fromScenes} ORDER BY s.campaign_id, s.position, sc.position, m.position`,
  };
}

/** Campaign trees: every campaign, or the one with `campaignId`. Twelve queries in all. */
function loadCampaigns(store: Store, campaignId?: string): DomainCampaign[] {
  const sql = campaignTreeQueries(campaignId !== undefined);
  const params = campaignId === undefined ? [] : [campaignId];
  const campaigns = store.all<{ id: string }>(sql.campaigns, ...params);
  if (campaigns.length === 0) return [];

  type Member = { owner: string; member: string };
  type Ref = { scene_id: string; track_id: string | null; playlist_id: string | null };
  const members = (text: string) => groupBy(store.all<Member>(text, ...params), (r) => r.owner);
  const campaignPlaylists = members(sql.campaignPlaylists);
  const campaignBoards = members(sql.campaignBoards);
  const campaignTracks = members(sql.campaignTracks);
  const sessions = groupBy(store.all<{ id: string; campaign_id: string }>(sql.sessions, ...params), (r) => r.campaign_id);
  const sessionPlaylists = members(sql.sessionPlaylists);
  const sessionBoards = members(sql.sessionBoards);
  const sessionTracks = members(sql.sessionTracks);
  const scenes = groupBy(store.all<{ id: string; session_id: string; name: string }>(sql.scenes, ...params), (r) => r.session_id);
  const music = groupBy(store.all<Ref>(sql.music, ...params), (r) => r.scene_id);
  const ambience = new Map(store.all<Ref>(sql.ambience, ...params).map((r) => [r.scene_id, ref(r)]));
  const sceneBoards = members(sql.sceneBoards);

  const ids = (rows: Member[] | undefined) => (rows ?? []).map((r) => r.member);
  return campaigns.map(
    (c): DomainCampaign => ({
      id: c.id,
      playlistIds: ids(campaignPlaylists.get(c.id)),
      boardIds: ids(campaignBoards.get(c.id)),
      trackIds: ids(campaignTracks.get(c.id)),
      sessions: (sessions.get(c.id) ?? []).map(
        (s): DomainSession => ({
          id: s.id,
          campaignId: c.id,
          playlistIds: ids(sessionPlaylists.get(s.id)),
          boardIds: ids(sessionBoards.get(s.id)),
          trackIds: ids(sessionTracks.get(s.id)),
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

/** One use found by listUses, with the keys that put it in the domain's order. */
type UseRow = {
  campaign_id: string;
  campaign_position: number;
  session_id: string | null;
  session_position: number | null;
  scene_id: string | null;
  scene_position: number | null;
  /** 0 music or board, 1 ambience. */
  role_rank: number;
  item_index: number;
};

const SCENE_PATH = `JOIN scenes sc ON sc.id = m.scene_id JOIN sessions s ON s.id = sc.session_id JOIN campaigns c ON c.id = s.campaign_id`;
const SCENE_COLUMNS = `c.id AS campaign_id, c.position AS campaign_position, s.id AS session_id, s.position AS session_position,
  sc.id AS scene_id, sc.position AS scene_position`;

/**
 * The SQL that finds where something is used (one query per place it can be
 * used), each starting from the "uses of" index on the thing's id. Exported for
 * the query-plan tests.
 */
export const USES_QUERIES = {
  playlist: [
    `SELECT c.id AS campaign_id, c.position AS campaign_position, NULL AS session_id, NULL AS session_position, NULL AS scene_id,
       NULL AS scene_position, 0 AS role_rank, 0 AS item_index
     FROM campaign_playlists m JOIN campaigns c ON c.id = m.campaign_id WHERE m.playlist_id = ?`,
    `SELECT c.id AS campaign_id, c.position AS campaign_position, s.id AS session_id, s.position AS session_position, NULL AS scene_id,
       NULL AS scene_position, 0 AS role_rank, 0 AS item_index
     FROM session_playlists m JOIN sessions s ON s.id = m.session_id JOIN campaigns c ON c.id = s.campaign_id WHERE m.playlist_id = ?`,
    `SELECT ${SCENE_COLUMNS}, 0 AS role_rank,
       (SELECT count(*) FROM scene_music m2 WHERE m2.scene_id = m.scene_id AND m2.position < m.position) AS item_index
     FROM scene_music m ${SCENE_PATH} WHERE m.playlist_id = ?`,
    `SELECT ${SCENE_COLUMNS}, 1 AS role_rank, 0 AS item_index FROM scene_ambience m ${SCENE_PATH} WHERE m.playlist_id = ?`,
  ],
  board: [
    `SELECT c.id AS campaign_id, c.position AS campaign_position, NULL AS session_id, NULL AS session_position, NULL AS scene_id,
       NULL AS scene_position, 0 AS role_rank, 0 AS item_index
     FROM campaign_boards m JOIN campaigns c ON c.id = m.campaign_id WHERE m.board_id = ?`,
    `SELECT c.id AS campaign_id, c.position AS campaign_position, s.id AS session_id, s.position AS session_position, NULL AS scene_id,
       NULL AS scene_position, 0 AS role_rank, 0 AS item_index
     FROM session_boards m JOIN sessions s ON s.id = m.session_id JOIN campaigns c ON c.id = s.campaign_id WHERE m.board_id = ?`,
    `SELECT ${SCENE_COLUMNS}, 0 AS role_rank,
       (SELECT count(*) FROM scene_boards m2 WHERE m2.scene_id = m.scene_id AND m2.position < m.position) AS item_index
     FROM scene_boards m ${SCENE_PATH} WHERE m.board_id = ?`,
  ],
  track: [
    `SELECT c.id AS campaign_id, c.position AS campaign_position, NULL AS session_id, NULL AS session_position, NULL AS scene_id,
       NULL AS scene_position, 0 AS role_rank, 0 AS item_index
     FROM campaign_tracks m JOIN campaigns c ON c.id = m.campaign_id WHERE m.track_id = ?`,
    `SELECT c.id AS campaign_id, c.position AS campaign_position, s.id AS session_id, s.position AS session_position, NULL AS scene_id,
       NULL AS scene_position, 0 AS role_rank, 0 AS item_index
     FROM session_tracks m JOIN sessions s ON s.id = m.session_id JOIN campaigns c ON c.id = s.campaign_id WHERE m.track_id = ?`,
    `SELECT ${SCENE_COLUMNS}, 0 AS role_rank,
       (SELECT count(*) FROM scene_music m2 WHERE m2.scene_id = m.scene_id AND m2.position < m.position) AS item_index
     FROM scene_music m ${SCENE_PATH} WHERE m.track_id = ?`,
    `SELECT ${SCENE_COLUMNS}, 1 AS role_rank, 0 AS item_index FROM scene_ambience m ${SCENE_PATH} WHERE m.track_id = ?`,
  ],
} as const;

/** Compares two uses in the domain's order: campaign, its own use, then sessions, then scenes, music before ambience. */
function compareUses(a: UseRow, b: UseRow): number {
  const keys = (r: UseRow) => [
    r.campaign_position,
    r.session_position ?? -Infinity,
    r.scene_id === null ? 0 : 1,
    r.scene_position ?? -Infinity,
    r.role_rank,
    r.item_index,
  ];
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

/**
 * Where a playlist, board or track is used ("Used in", and the question asked
 * before deleting it): the same answer, in the same order, as usesOfPlaylist,
 * usesOfBoard and usesOfTrack in src/common/domain over every campaign, read
 * through the database's indexes instead.
 */
export function listUses(store: Store, item: { playlistId: string } | { boardId: string } | { trackId: string }): Use[] {
  const [kind, id] =
    "playlistId" in item ? (["playlist", item.playlistId] as const) : "boardId" in item ? (["board", item.boardId] as const) : (["track", item.trackId] as const);
  const rows = USES_QUERIES[kind].flatMap((sql) => store.all<UseRow>(sql, id));
  rows.sort(compareUses);
  return rows.map((r): Use => {
    if (r.session_id === null) return { level: "campaign", campaignId: r.campaign_id };
    if (r.scene_id === null) return { level: "session", campaignId: r.campaign_id, sessionId: r.session_id };
    return {
      level: "scene",
      campaignId: r.campaign_id,
      sessionId: r.session_id,
      sceneId: r.scene_id,
      role: kind === "board" ? "board" : r.role_rank === 1 ? "ambience" : "music",
      position: r.item_index,
    };
  });
}
