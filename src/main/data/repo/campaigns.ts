/**
 * Campaigns > sessions > scenes (ORG-7, DAT-11). The library, playlists, pad
 * boards and tags are shared by all campaigns; a playlist or board is given to
 * a whole campaign, one session, or one scene (design round 4).
 *
 * - A campaign has a theme, a game system, a description and Obsidian links,
 *   and an ordered list of playlists and of boards.
 * - A session has a number, a name (may be empty), a date, a status (played,
 *   next, draft; at most one next per campaign), its own ordered playlists and
 *   boards, and a note link.
 * - A scene has a name, a "starts when" line, notes, a note link, an ordered
 *   music list mixing tracks and playlists, one ambience item (a track or an
 *   ambience playlist, or none), and an ordered list of pad boards.
 *
 * Every write is one undoable step. getDomainCampaign (domain.ts) gives the
 * tree the shared rules work on.
 */
import type { SoundRef } from "../../../common/domain";
import { ValidationError } from "../errors";
import { positionFor, positionsFor, type OrderedList } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import {
  CAMPAIGN_THEMES,
  SESSION_STATUSES,
  type Campaign,
  type CampaignTheme,
  type Members,
  type ObsidianLinks,
  type Placement,
  type Scene,
  type SceneMusicItem,
  type Session,
  type SessionStatus,
  type UseTarget,
} from "../types";
import * as v from "../validate";
import { newId, patchOf, placeholders, plural, requireRow } from "./common";
import { requireFolderFor } from "./folders";

type CampaignRow = {
  id: string;
  name: string;
  color: string | null;
  notes: string;
  theme: string;
  system: string;
  description: string;
  obsidian_vault: string;
  obsidian_note: string;
  obsidian_sessions: string;
  position: number;
  created_at: number;
  updated_at: number;
};
type SessionRow = {
  id: string;
  campaign_id: string;
  folder_id: string | null;
  number: number;
  name: string;
  notes: string;
  session_date: string | null;
  status: string;
  note_link: string;
  position: number;
  created_at: number;
  updated_at: number;
};
type SceneRow = {
  id: string;
  session_id: string;
  name: string;
  starts_when: string;
  notes: string;
  note_link: string;
  ambience_track: string | null;
  ambience_playlist: string | null;
  position: number;
  created_at: number;
  updated_at: number;
};

const toCampaign = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  color: row.color,
  notes: row.notes,
  theme: row.theme as CampaignTheme,
  system: row.system,
  description: row.description,
  obsidian: { vault: row.obsidian_vault, note: row.obsidian_note, sessionsFolder: row.obsidian_sessions },
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toSession = (row: SessionRow): Session => ({
  id: row.id,
  campaignId: row.campaign_id,
  folderId: row.folder_id,
  number: row.number,
  name: row.name,
  notes: row.notes,
  date: row.session_date,
  status: row.status as SessionStatus,
  noteLink: row.note_link,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toScene = (row: SceneRow): Scene => ({
  id: row.id,
  sessionId: row.session_id,
  name: row.name,
  startsWhen: row.starts_when,
  notes: row.notes,
  noteLink: row.note_link,
  ambience:
    row.ambience_track !== null
      ? { kind: "track", id: row.ambience_track }
      : row.ambience_playlist !== null
        ? { kind: "playlist", id: row.ambience_playlist }
        : null,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const CAMPAIGNS: OrderedList = { table: "campaigns", scope: "1 = 1", params: [] };
const sessionsOf = (campaignId: string): OrderedList => ({ table: "sessions", scope: "campaign_id = ?", params: [campaignId] });
const scenesOf = (sessionId: string): OrderedList => ({ table: "scenes", scope: "session_id = ?", params: [sessionId] });
const musicOf = (sceneId: string): OrderedList => ({ table: "scene_music", scope: "scene_id = ?", params: [sceneId] });

const SCENE_SELECT = `SELECT sc.*, a.track_id AS ambience_track, a.playlist_id AS ambience_playlist
  FROM scenes sc LEFT JOIN scene_ambience a ON a.scene_id = sc.id`;

/** A short text field such as a game system or a note link. */
const shortText = (field: string, value: unknown) => v.optionalText(field, value, 4000).trim();
/** A name: required for campaigns; sessions and scenes may have none ("Session 14", "Untitled scene"). */
const nameOf = (value: unknown, required: boolean) => (required ? v.requiredName("name", value) : (v.nullableText("name", value) ?? ""));

/** Writes checked columns and bumps updated_at, as one change. */
function applyColumns(store: Store, table: string, id: string, label: string, columns: Record<string, SQLInputValue>, after?: () => void) {
  const names = Object.keys(columns);
  store.change(label, () => {
    after?.();
    if (names.length > 0) {
      store.run(`UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`, ...names.map((n) => columns[n]), id);
    }
    store.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, store.now(), id);
  });
}

function insertRow(store: Store, table: string, columns: Record<string, SQLInputValue>) {
  const names = Object.keys(columns);
  store.run(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders(names.length)})`, ...names.map((n) => columns[n]));
}

// --- Campaigns ---

function obsidianColumns(value: unknown): Record<string, SQLInputValue> {
  const links = patchOf(value, ["vault", "note", "sessionsFolder"]);
  const columns: Record<string, SQLInputValue> = {};
  if (links.vault !== undefined) columns.obsidian_vault = shortText("obsidian.vault", links.vault);
  if (links.note !== undefined) columns.obsidian_note = shortText("obsidian.note", links.note);
  if (links.sessionsFolder !== undefined) columns.obsidian_sessions = shortText("obsidian.sessionsFolder", links.sessionsFolder);
  return columns;
}

function campaignColumns(patch: Record<string, unknown>): Record<string, SQLInputValue> {
  const columns: Record<string, SQLInputValue> = {};
  if (patch.name !== undefined) columns.name = nameOf(patch.name, true);
  if ("color" in patch) columns.color = v.nullableColor("color", patch.color);
  if (patch.notes !== undefined) columns.notes = v.optionalText("notes", patch.notes);
  if (patch.theme !== undefined) columns.theme = v.oneOf("theme", patch.theme, CAMPAIGN_THEMES);
  if (patch.system !== undefined) columns.system = v.optionalText("system", patch.system, v.MAX_NAME_LENGTH).trim();
  if (patch.description !== undefined) columns.description = v.optionalText("description", patch.description);
  if (patch.obsidian !== undefined) Object.assign(columns, obsidianColumns(patch.obsidian));
  return columns;
}

export type CampaignInput = {
  id?: string;
  name: string;
  color?: string | null;
  notes?: string;
  /** Default: candle. */
  theme?: CampaignTheme;
  system?: string;
  description?: string;
  obsidian?: Partial<ObsidianLinks>;
  placement?: Placement;
};

export function createCampaign(store: Store, input: CampaignInput): Campaign {
  const record = v.record("campaign", input);
  const id = newId(record.id);
  if (record.name === undefined) throw new ValidationError("name", "name cannot be empty.");
  const columns = campaignColumns(record);
  store.change(`Add campaign "${columns.name}"`, () => {
    const now = store.now();
    insertRow(store, "campaigns", {
      id,
      notes: "",
      ...columns,
      position: positionFor(store, CAMPAIGNS, (record.placement as Placement | undefined) ?? "end"),
      created_at: now,
      updated_at: now,
    });
  });
  return getCampaign(store, id) as Campaign;
}

export function getCampaign(store: Store, id: string): Campaign | null {
  const row = store.get<CampaignRow>("SELECT * FROM campaigns WHERE id = ?", id);
  return row ? toCampaign(row) : null;
}

export function listCampaigns(store: Store): Campaign[] {
  return store.all<CampaignRow>("SELECT * FROM campaigns ORDER BY position, rowid").map(toCampaign);
}

/** Changes only what is given; Obsidian fields can be changed one at a time. */
export function updateCampaign(
  store: Store,
  id: string,
  changes: Partial<Omit<CampaignInput, "id" | "placement">>,
): Campaign {
  const patch = patchOf(changes, ["name", "color", "notes", "theme", "system", "description", "obsidian"]);
  const campaignId = requireRow(store, "campaigns", "campaign", id);
  applyColumns(store, "campaigns", campaignId, "Change campaign", campaignColumns(patch));
  return getCampaign(store, campaignId) as Campaign;
}

export function moveCampaign(store: Store, id: string, placement: Placement): void {
  const campaignId = requireRow(store, "campaigns", "campaign", id);
  store.change("Move campaign", () =>
    store.run("UPDATE campaigns SET position = ? WHERE id = ?", positionFor(store, CAMPAIGNS, placement, campaignId), campaignId),
  );
}

/** Deletes a campaign with its sessions and scenes. Playlists and boards stay in the library. */
export function deleteCampaign(store: Store, id: string): void {
  const campaign = getCampaign(store, requireRow(store, "campaigns", "campaign", id)) as Campaign;
  store.change(`Delete campaign "${campaign.name}"`, () => store.run("DELETE FROM campaigns WHERE id = ?", campaign.id));
}

// --- Playlists and boards of a campaign or a session (ordered) ---

type Owner = { table: "campaign" | "session"; id: string };
const memberTable = (owner: Owner, kind: "playlist" | "board") => `${owner.table}_${kind}s`;
const memberList = (owner: Owner, kind: "playlist" | "board"): OrderedList => ({
  table: memberTable(owner, kind),
  scope: `${owner.table}_id = ?`,
  params: [owner.id],
  idColumn: `${kind}_id`,
});

function memberIds(store: Store, members: Partial<Members>) {
  const input = v.record("members", members);
  const playlists = (input.playlistIds === undefined ? [] : v.ids("playlistIds", input.playlistIds)).map((id) =>
    requireRow(store, "playlists", "playlist", id),
  );
  const boards = (input.boardIds === undefined ? [] : v.ids("boardIds", input.boardIds)).map((id) => requireRow(store, "boards", "board", id));
  return { playlist: [...new Set(playlists)], board: [...new Set(boards)] };
}

const hasMember = (store: Store, owner: Owner, kind: "playlist" | "board", id: string) =>
  store.get(`SELECT 1 AS found FROM ${memberTable(owner, kind)} WHERE ${owner.table}_id = ? AND ${kind}_id = ?`, owner.id, id) !== undefined;

/** Adds members not there yet, together at `placement` (inside a change). */
function addMembers(store: Store, owner: Owner, kind: "playlist" | "board", ids: string[], placement: Placement) {
  const adding = ids.filter((id) => !hasMember(store, owner, kind, id));
  const positions = positionsFor(store, memberList(owner, kind), placement, adding.length);
  adding.forEach((id, index) =>
    store.run(
      `INSERT INTO ${memberTable(owner, kind)} (${owner.table}_id, ${kind}_id, position) VALUES (?, ?, ?)`,
      owner.id,
      id,
      positions[index],
    ),
  );
}

function removeMembers(store: Store, owner: Owner, kind: "playlist" | "board", ids: string[]) {
  for (const id of ids) store.run(`DELETE FROM ${memberTable(owner, kind)} WHERE ${owner.table}_id = ? AND ${kind}_id = ?`, owner.id, id);
}

function listMembers(store: Store, owner: Owner): Members {
  const ids = (kind: "playlist" | "board") =>
    store
      .all<{ id: string }>(`SELECT ${kind}_id AS id FROM ${memberTable(owner, kind)} WHERE ${owner.table}_id = ? ORDER BY position, rowid`, owner.id)
      .map((r) => r.id);
  return { playlistIds: ids("playlist"), boardIds: ids("board") };
}

function moveMember(store: Store, owner: Owner, member: { playlistId: string } | { boardId: string }, placement: Placement) {
  const input = v.record("member", member);
  const kind = input.playlistId !== undefined ? "playlist" : "board";
  const id = v.id(`${kind}Id`, kind === "playlist" ? input.playlistId : input.boardId);
  if (!hasMember(store, owner, kind, id)) throw new ValidationError(`${kind}Id`, `That ${kind} is not in this ${owner.table}.`);
  store.change(`Move ${kind} in ${owner.table}`, () =>
    store.run(
      `UPDATE ${memberTable(owner, kind)} SET position = ? WHERE ${owner.table}_id = ? AND ${kind}_id = ?`,
      positionFor(store, memberList(owner, kind), placement, id),
      owner.id,
      id,
    ),
  );
}

function addTo(store: Store, owner: Owner, members: Partial<Members>, placement: Placement) {
  const ids = memberIds(store, members);
  store.change(`Add to ${owner.table}`, () => {
    addMembers(store, owner, "playlist", ids.playlist, placement);
    addMembers(store, owner, "board", ids.board, placement);
  });
}

function removeFrom(store: Store, owner: Owner, members: Partial<Members>) {
  const ids = memberIds(store, members);
  store.change(`Remove from ${owner.table}`, () => {
    removeMembers(store, owner, "playlist", ids.playlist);
    removeMembers(store, owner, "board", ids.board);
  });
}

const campaignOwner = (store: Store, id: string): Owner => ({ table: "campaign", id: requireRow(store, "campaigns", "campaign", id) });
const sessionOwner = (store: Store, id: string): Owner => ({ table: "session", id: requireRow(store, "sessions", "session", id) });

/** Makes playlists and boards available all campaign long (they stay in other campaigns); ones already there stay put. */
export function addToCampaign(store: Store, campaignId: string, members: Partial<Members>, placement: Placement = "end"): void {
  addTo(store, campaignOwner(store, campaignId), members, placement);
}
export function removeFromCampaign(store: Store, campaignId: string, members: Partial<Members>): void {
  removeFrom(store, campaignOwner(store, campaignId), members);
}
export function moveInCampaign(store: Store, campaignId: string, member: { playlistId: string } | { boardId: string }, placement: Placement): void {
  moveMember(store, campaignOwner(store, campaignId), member, placement);
}
export function listCampaignMembers(store: Store, campaignId: string): Members {
  return listMembers(store, campaignOwner(store, campaignId));
}

/** Makes playlists and boards available for one session (that evening). */
export function addToSession(store: Store, sessionId: string, members: Partial<Members>, placement: Placement = "end"): void {
  addTo(store, sessionOwner(store, sessionId), members, placement);
}
export function removeFromSession(store: Store, sessionId: string, members: Partial<Members>): void {
  removeFrom(store, sessionOwner(store, sessionId), members);
}
export function moveInSession(store: Store, sessionId: string, member: { playlistId: string } | { boardId: string }, placement: Placement): void {
  moveMember(store, sessionOwner(store, sessionId), member, placement);
}
export function listSessionMembers(store: Store, sessionId: string): Members {
  return listMembers(store, sessionOwner(store, sessionId));
}

/** The campaigns a playlist or board is given to, in campaign order. */
export function campaignsOf(store: Store, item: { playlistId: string } | { boardId: string }): Campaign[] {
  const [table, column, id] =
    "playlistId" in item ? ["campaign_playlists", "playlist_id", item.playlistId] : ["campaign_boards", "board_id", item.boardId];
  return store
    .all<CampaignRow>(
      `SELECT c.* FROM campaigns c JOIN ${table} m ON m.campaign_id = c.id WHERE m.${column} = ? ORDER BY c.position, c.rowid`,
      v.id("id", id),
    )
    .map(toCampaign);
}

// --- Sessions ---

/**
 * Makes `sessionId` the campaign's next session (inside a change): a session
 * that was next becomes played when it comes earlier, a draft when later (as
 * the prototype does).
 */
function makeNext(store: Store, sessionId: string) {
  const session = store.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", sessionId) as SessionRow;
  for (const other of store.all<SessionRow>("SELECT * FROM sessions WHERE campaign_id = ? AND status = 'next' AND id <> ?", session.campaign_id, sessionId)) {
    const earlier = other.position < session.position || (other.position === session.position && other.id < session.id);
    store.run("UPDATE sessions SET status = ? WHERE id = ?", earlier ? "played" : "draft", other.id);
  }
  store.run("UPDATE sessions SET status = 'next' WHERE id = ?", sessionId);
}

const hasNext = (store: Store, campaignId: string, except = "") =>
  store.get("SELECT 1 AS found FROM sessions WHERE campaign_id = ? AND status = 'next' AND id <> ?", campaignId, except) !== undefined;

export type SessionInput = {
  id?: string;
  campaignId: string;
  name?: string;
  /** Default: one more than the campaign's highest. */
  number?: number;
  date?: string | null;
  /** Default: next when the campaign has no next session, otherwise draft. */
  status?: SessionStatus;
  notes?: string;
  noteLink?: string;
  folderId?: string | null;
  placement?: Placement;
};

function sessionColumns(patch: Record<string, unknown>): Record<string, SQLInputValue> {
  const columns: Record<string, SQLInputValue> = {};
  if (patch.name !== undefined) columns.name = nameOf(patch.name, false);
  if (patch.number !== undefined) columns.number = v.integer("number", patch.number, 0, 100_000);
  if ("date" in patch) columns.session_date = v.nullableDate("date", patch.date);
  if (patch.notes !== undefined) columns.notes = v.optionalText("notes", patch.notes);
  if (patch.noteLink !== undefined) columns.note_link = shortText("noteLink", patch.noteLink);
  return columns;
}

export function createSession(store: Store, input: SessionInput): Session {
  const record = v.record("session", input);
  const id = newId(record.id);
  const campaignId = requireRow(store, "campaigns", "campaign", record.campaignId);
  const columns = sessionColumns(record);
  const status = record.status === undefined ? undefined : v.oneOf("status", record.status, SESSION_STATUSES);
  const folderId = requireFolderFor(store, record.folderId, "sessions");
  store.change(`Add session${columns.name ? ` "${columns.name}"` : ""}`, () => {
    const now = store.now();
    const highest = (store.get<{ n: number }>("SELECT coalesce(max(number), 0) AS n FROM sessions WHERE campaign_id = ?", campaignId) as { n: number }).n;
    const wanted = status ?? (hasNext(store, campaignId) ? "draft" : "next");
    insertRow(store, "sessions", {
      id,
      campaign_id: campaignId,
      folder_id: folderId,
      name: "",
      notes: "",
      number: highest + 1,
      ...columns,
      status: wanted === "next" ? "draft" : wanted,
      position: positionFor(store, sessionsOf(campaignId), (record.placement as Placement | undefined) ?? "end"),
      created_at: now,
      updated_at: now,
    });
    if (wanted === "next") makeNext(store, id);
  });
  return getSession(store, id) as Session;
}

export function getSession(store: Store, id: string): Session | null {
  const row = store.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", id);
  return row ? toSession(row) : null;
}

export function listSessions(store: Store, campaignId: string): Session[] {
  return store.all<SessionRow>("SELECT * FROM sessions WHERE campaign_id = ? ORDER BY position, rowid", campaignId).map(toSession);
}

/** Changes only what is given. Making a session next moves the campaign's other next session to played or draft. */
export function updateSession(
  store: Store,
  id: string,
  changes: Partial<Pick<SessionInput, "name" | "number" | "date" | "status" | "notes" | "noteLink">>,
): Session {
  const patch = patchOf(changes, ["name", "number", "date", "status", "notes", "noteLink"]);
  const sessionId = requireRow(store, "sessions", "session", id);
  const columns = sessionColumns(patch);
  const status = patch.status === undefined ? undefined : v.oneOf("status", patch.status, SESSION_STATUSES);
  applyColumns(store, "sessions", sessionId, "Change session", columns, () => {
    if (status === "next") makeNext(store, sessionId);
    else if (status !== undefined) store.run("UPDATE sessions SET status = ? WHERE id = ?", status, sessionId);
  });
  return getSession(store, sessionId) as Session;
}

/** Reorders a session, or moves it to another campaign or folder. A next session moved where there is one becomes a draft. */
export function moveSession(
  store: Store,
  id: string,
  target: { campaignId?: string; folderId?: string | null; placement: Placement },
): Session {
  const session = getSession(store, requireRow(store, "sessions", "session", id)) as Session;
  const campaignId = target.campaignId === undefined ? session.campaignId : requireRow(store, "campaigns", "campaign", target.campaignId);
  const folderId = target.folderId === undefined ? session.folderId : requireFolderFor(store, target.folderId, "sessions");
  store.change("Move session", () => {
    const position = positionFor(store, sessionsOf(campaignId), target.placement, session.id);
    const status = session.status === "next" && campaignId !== session.campaignId && hasNext(store, campaignId) ? "draft" : session.status;
    store.run(
      "UPDATE sessions SET campaign_id = ?, folder_id = ?, position = ?, status = ? WHERE id = ?",
      campaignId,
      folderId,
      position,
      status,
      session.id,
    );
  });
  return getSession(store, session.id) as Session;
}

export function deleteSession(store: Store, id: string): void {
  const session = getSession(store, requireRow(store, "sessions", "session", id)) as Session;
  store.change(`Delete session ${session.number}${session.name ? ` "${session.name}"` : ""}`, () =>
    store.run("DELETE FROM sessions WHERE id = ?", session.id),
  );
}

// --- Scenes ---

export type SceneInput = {
  id?: string;
  sessionId: string;
  name?: string;
  startsWhen?: string;
  notes?: string;
  noteLink?: string;
  placement?: Placement;
};

function sceneColumns(patch: Record<string, unknown>): Record<string, SQLInputValue> {
  const columns: Record<string, SQLInputValue> = {};
  if (patch.name !== undefined) columns.name = nameOf(patch.name, false);
  if (patch.startsWhen !== undefined) columns.starts_when = v.optionalText("startsWhen", patch.startsWhen, v.MAX_NAME_LENGTH).trim();
  if (patch.notes !== undefined) columns.notes = v.optionalText("notes", patch.notes);
  if (patch.noteLink !== undefined) columns.note_link = shortText("noteLink", patch.noteLink);
  return columns;
}

export function createScene(store: Store, input: SceneInput): Scene {
  const record = v.record("scene", input);
  const id = newId(record.id);
  const sessionId = requireRow(store, "sessions", "session", record.sessionId);
  const columns = sceneColumns(record);
  store.change(`Add scene${columns.name ? ` "${columns.name}"` : ""}`, () => {
    const now = store.now();
    insertRow(store, "scenes", {
      id,
      session_id: sessionId,
      name: "",
      notes: "",
      ...columns,
      position: positionFor(store, scenesOf(sessionId), (record.placement as Placement | undefined) ?? "end"),
      created_at: now,
      updated_at: now,
    });
  });
  return getScene(store, id) as Scene;
}

export function getScene(store: Store, id: string): Scene | null {
  const row = store.get<SceneRow>(`${SCENE_SELECT} WHERE sc.id = ?`, id);
  return row ? toScene(row) : null;
}

export function listScenes(store: Store, sessionId: string): Scene[] {
  return store.all<SceneRow>(`${SCENE_SELECT} WHERE sc.session_id = ? ORDER BY sc.position, sc.rowid`, sessionId).map(toScene);
}

export function updateScene(store: Store, id: string, changes: Partial<Pick<SceneInput, "name" | "startsWhen" | "notes" | "noteLink">>): Scene {
  const patch = patchOf(changes, ["name", "startsWhen", "notes", "noteLink"]);
  const sceneId = requireRow(store, "scenes", "scene", id);
  applyColumns(store, "scenes", sceneId, "Change scene", sceneColumns(patch));
  return getScene(store, sceneId) as Scene;
}

/** Reorders a scene, or moves it to another session. */
export function moveScene(store: Store, id: string, target: { sessionId?: string; placement: Placement }): Scene {
  const scene = getScene(store, requireRow(store, "scenes", "scene", id)) as Scene;
  const sessionId = target.sessionId === undefined ? scene.sessionId : requireRow(store, "sessions", "session", target.sessionId);
  store.change("Move scene", () => {
    const position = positionFor(store, scenesOf(sessionId), target.placement, scene.id);
    store.run("UPDATE scenes SET session_id = ?, position = ? WHERE id = ?", sessionId, position, scene.id);
  });
  return getScene(store, scene.id) as Scene;
}

export function deleteScene(store: Store, id: string): void {
  const scene = getScene(store, requireRow(store, "scenes", "scene", id)) as Scene;
  store.change(`Delete scene${scene.name ? ` "${scene.name}"` : ""}`, () => store.run("DELETE FROM scenes WHERE id = ?", scene.id));
}

// --- A scene's music list, ambience and boards ---

/** Checks a track or playlist reference. */
function cleanRef(store: Store, field: string, value: unknown): SoundRef {
  const input = v.record(field, value);
  const kind = v.oneOf(`${field}.kind`, input.kind, ["track", "playlist"] as const);
  return kind === "track"
    ? { kind, id: requireRow(store, "tracks", "track", input.id) }
    : { kind, id: requireRow(store, "playlists", "playlist", input.id) };
}

const refColumns = (ref: SoundRef) => (ref.kind === "track" ? [ref.id, null] : [null, ref.id]);

type MusicRow = { id: string; scene_id: string; track_id: string | null; playlist_id: string | null; position: number; title: string };
const MUSIC_SELECT = `SELECT m.*, coalesce(nullif(t.title, ''), nullif(t.meta_title, ''), t.file_name, p.title) AS title
  FROM scene_music m LEFT JOIN tracks t ON t.id = m.track_id LEFT JOIN playlists p ON p.id = m.playlist_id`;
const toMusicItem = (row: MusicRow): SceneMusicItem => ({
  id: row.id,
  sceneId: row.scene_id,
  ref: row.track_id !== null ? { kind: "track", id: row.track_id } : { kind: "playlist", id: row.playlist_id as string },
  position: row.position,
  title: row.title,
});

/** The scene's music in playing order: the first item starts the scene. */
export function listSceneMusic(store: Store, sceneId: string): SceneMusicItem[] {
  return store.all<MusicRow>(`${MUSIC_SELECT} WHERE m.scene_id = ? ORDER BY m.position, m.rowid`, sceneId).map(toMusicItem);
}

/** Adds tracks or playlists to the scene's music, together, at `placement`. The same one may come twice. */
export function addSceneMusic(store: Store, sceneId: string, refs: SoundRef[], placement: Placement = "end"): SceneMusicItem[] {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  if (!Array.isArray(refs)) throw new ValidationError("items", "items must be a list.");
  const clean = refs.map((ref, index) => cleanRef(store, `items[${index}]`, ref));
  const ids = clean.map(() => newId());
  store.change(`Add ${plural(clean.length, "item")} to the scene's music`, () => {
    const positions = positionsFor(store, musicOf(scene), placement, clean.length);
    clean.forEach((ref, index) =>
      store.run(
        "INSERT INTO scene_music (id, scene_id, track_id, playlist_id, position) VALUES (?, ?, ?, ?, ?)",
        ids[index],
        scene,
        ...refColumns(ref),
        positions[index],
      ),
    );
  });
  return ids.map((id) => toMusicItem(store.get<MusicRow>(`${MUSIC_SELECT} WHERE m.id = ?`, id) as MusicRow));
}

function requireMusic(store: Store, ids: unknown): MusicRow[] {
  return v.ids("itemIds", ids).map((id) => store.get<MusicRow>(`${MUSIC_SELECT} WHERE m.id = ?`, requireRow(store, "scene_music", "scene music item", id)) as MusicRow);
}

/** Moves the selected music items together to `placement`, keeping their order. */
export function moveSceneMusic(store: Store, itemIds: string[], placement: Placement): void {
  const items = requireMusic(store, itemIds);
  if (items.length === 0) return;
  const sceneId = items[0].scene_id;
  if (items.some((item) => item.scene_id !== sceneId)) throw new ValidationError("itemIds", "Items from different scenes cannot be moved together.");
  items.sort((a, b) => a.position - b.position);
  store.change(`Move ${plural(items.length, "item")} in the scene's music`, () => {
    const positions = positionsFor(store, musicOf(sceneId), placement, items.length, items.map((i) => i.id));
    items.forEach((item, index) => store.run("UPDATE scene_music SET position = ? WHERE id = ?", positions[index], item.id));
  });
}

export function removeSceneMusic(store: Store, itemIds: string[]): void {
  const items = requireMusic(store, itemIds);
  store.change(`Remove ${plural(items.length, "item")} from the scene's music`, () => {
    for (const item of items) store.run("DELETE FROM scene_music WHERE id = ?", item.id);
  });
}

function writeAmbience(store: Store, sceneId: string, ref: SoundRef | null) {
  store.run("DELETE FROM scene_ambience WHERE scene_id = ?", sceneId);
  if (ref) store.run("INSERT INTO scene_ambience (scene_id, track_id, playlist_id) VALUES (?, ?, ?)", sceneId, ...refColumns(ref));
}

/** Sets the scene's one ambience item (a track or an ambience playlist), or none. */
export function setSceneAmbience(store: Store, sceneId: string, ref: SoundRef | null): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const clean = ref === null ? null : cleanRef(store, "ambience", ref);
  store.change(clean ? "Set the scene's ambience" : "Remove the scene's ambience", () => writeAmbience(store, scene, clean));
}

const boardsOf = (sceneId: string): OrderedList => ({ table: "scene_boards", scope: "scene_id = ?", params: [sceneId], idColumn: "board_id" });
const sceneHasBoard = (store: Store, sceneId: string, boardId: string) =>
  store.get("SELECT 1 AS found FROM scene_boards WHERE scene_id = ? AND board_id = ?", sceneId, boardId) !== undefined;

/** The scene's pad boards in order; the first shows when the scene starts. */
export function listSceneBoards(store: Store, sceneId: string): string[] {
  return store.all<{ board_id: string }>("SELECT board_id FROM scene_boards WHERE scene_id = ? ORDER BY position, rowid", sceneId).map((r) => r.board_id);
}

/** Adds boards to the scene at `placement`; boards already there stay put. */
export function addSceneBoards(store: Store, sceneId: string, boardIds: string[], placement: Placement = "end"): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const boards = [...new Set(v.ids("boardIds", boardIds).map((id) => requireRow(store, "boards", "board", id)))];
  store.change(`Add ${plural(boards.length, "board")} to the scene`, () => {
    const adding = boards.filter((id) => !sceneHasBoard(store, scene, id));
    const positions = positionsFor(store, boardsOf(scene), placement, adding.length);
    adding.forEach((id, index) => store.run("INSERT INTO scene_boards (scene_id, board_id, position) VALUES (?, ?, ?)", scene, id, positions[index]));
  });
}

export function removeSceneBoards(store: Store, sceneId: string, boardIds: string[]): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const boards = v.ids("boardIds", boardIds);
  store.change(`Remove ${plural(boards.length, "board")} from the scene`, () => {
    for (const id of boards) store.run("DELETE FROM scene_boards WHERE scene_id = ? AND board_id = ?", scene, id);
  });
}

export function moveSceneBoard(store: Store, sceneId: string, boardId: string, placement: Placement): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const board = v.id("boardId", boardId);
  if (!sceneHasBoard(store, scene, board)) throw new ValidationError("boardId", "That board is not in this scene.");
  store.change("Move board in the scene", () =>
    store.run(
      "UPDATE scene_boards SET position = ? WHERE scene_id = ? AND board_id = ?",
      positionFor(store, boardsOf(scene), placement, board),
      scene,
      board,
    ),
  );
}

// --- "Use in…": where a playlist or board is used, set in one step ---

type Targets = { campaign: Set<string>; session: Set<string>; scene: Set<string> };

function cleanTargets(store: Store, targets: UseTarget[]): Targets {
  if (!Array.isArray(targets)) throw new ValidationError("targets", "targets must be a list.");
  const out: Targets = { campaign: new Set(), session: new Set(), scene: new Set() };
  targets.forEach((target, index) => {
    const input = v.record(`targets[${index}]`, target);
    const keys = ["campaignId", "sessionId", "sceneId"].filter((key) => input[key] !== undefined);
    if (keys.length !== 1) throw new ValidationError(`targets[${index}]`, "Each place is one campaign, one session or one scene.");
    if (keys[0] === "campaignId") out.campaign.add(requireRow(store, "campaigns", "campaign", input.campaignId));
    else if (keys[0] === "sessionId") out.session.add(requireRow(store, "sessions", "session", input.sessionId));
    else out.scene.add(requireRow(store, "scenes", "scene", input.sceneId));
  });
  return out;
}

/** Brings one membership table in line with `wanted` (inside a change): adds at the end, removes the rest. */
function syncMembers(store: Store, owner: "campaign" | "session" | "scene", kind: "playlist" | "board", id: string, wanted: Set<string>) {
  const table = `${owner}_${kind}s`;
  const current = new Set(
    store.all<{ owner: string }>(`SELECT ${owner}_id AS owner FROM ${table} WHERE ${kind}_id = ?`, id).map((r) => r.owner),
  );
  for (const ownerId of current) if (!wanted.has(ownerId)) store.run(`DELETE FROM ${table} WHERE ${owner}_id = ? AND ${kind}_id = ?`, ownerId, id);
  for (const ownerId of wanted) {
    if (current.has(ownerId)) continue;
    const list: OrderedList = { table, scope: `${owner}_id = ?`, params: [ownerId], idColumn: `${kind}_id` };
    store.run(`INSERT INTO ${table} (${owner}_id, ${kind}_id, position) VALUES (?, ?, ?)`, ownerId, id, positionFor(store, list, "end"));
  }
}

/**
 * Sets every place a playlist is used, as the "Use in…" sheet does: the
 * campaigns and sessions it is given to, and the scenes that play it. An
 * ambience playlist becomes those scenes' ambience; any other is added to the
 * end of their music. Unticked places lose it (every time it comes in a scene's music).
 */
export function setPlaylistUses(store: Store, playlistId: string, targets: UseTarget[]): void {
  const playlist = store.get<{ id: string; title: string; lane: string }>(
    "SELECT id, title, lane FROM playlists WHERE id = ?",
    requireRow(store, "playlists", "playlist", playlistId),
  ) as { id: string; title: string; lane: string };
  const wanted = cleanTargets(store, targets);
  store.change(`Change where "${playlist.title}" is used`, () => {
    syncMembers(store, "campaign", "playlist", playlist.id, wanted.campaign);
    syncMembers(store, "session", "playlist", playlist.id, wanted.session);
    const table = playlist.lane === "amb" ? "scene_ambience" : "scene_music";
    const current = new Set(store.all<{ scene_id: string }>(`SELECT DISTINCT scene_id FROM ${table} WHERE playlist_id = ?`, playlist.id).map((r) => r.scene_id));
    for (const sceneId of current) if (!wanted.scene.has(sceneId)) store.run(`DELETE FROM ${table} WHERE scene_id = ? AND playlist_id = ?`, sceneId, playlist.id);
    for (const sceneId of wanted.scene) {
      if (current.has(sceneId)) continue;
      if (playlist.lane === "amb") writeAmbience(store, sceneId, { kind: "playlist", id: playlist.id });
      else {
        store.run(
          "INSERT INTO scene_music (id, scene_id, track_id, playlist_id, position) VALUES (?, ?, NULL, ?, ?)",
          newId(),
          sceneId,
          playlist.id,
          positionFor(store, musicOf(sceneId), "end"),
        );
      }
    }
  });
}

/** Sets every place a pad board is used: campaigns, sessions, and scenes (added at the end of their boards). */
export function setBoardUses(store: Store, boardId: string, targets: UseTarget[]): void {
  const board = store.get<{ id: string; title: string }>(
    "SELECT id, title FROM boards WHERE id = ?",
    requireRow(store, "boards", "board", boardId),
  ) as { id: string; title: string };
  const wanted = cleanTargets(store, targets);
  store.change(`Change where "${board.title}" is used`, () => {
    syncMembers(store, "campaign", "board", board.id, wanted.campaign);
    syncMembers(store, "session", "board", board.id, wanted.session);
    syncMembers(store, "scene", "board", board.id, wanted.scene);
  });
}
