/**
 * Campaigns > sessions > scenes (ORG-7). The library and tags are shared by
 * all campaigns; playlists and boards can belong to several campaigns, which
 * is how the interface shows "only this campaign's material". Scenes can list
 * the playlists, boards and tracks prepared for them. Cue lists and scene
 * blocks (SHW-1, SHW-6) attach here in a later schema version.
 */
import { ValidationError } from "../errors";
import { positionFor, positionsFor, type OrderedList } from "../ordering";
import type { Store } from "../store";
import type { Campaign, Placement, Scene, SceneItem, SceneItemRef, Session } from "../types";
import * as v from "../validate";
import { newId, patchOf, plural, requireRow } from "./common";
import { requireFolderFor } from "./folders";

type CampaignRow = {
  id: string;
  name: string;
  color: string | null;
  notes: string;
  position: number;
  created_at: number;
  updated_at: number;
};
type SessionRow = Omit<CampaignRow, "color"> & { campaign_id: string; folder_id: string | null; played_on: string | null };
type SceneRow = Omit<CampaignRow, "color"> & { session_id: string };

const toCampaign = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  color: row.color,
  notes: row.notes,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toSession = (row: SessionRow): Session => ({
  id: row.id,
  campaignId: row.campaign_id,
  folderId: row.folder_id,
  name: row.name,
  notes: row.notes,
  playedOn: row.played_on,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toScene = (row: SceneRow): Scene => ({
  id: row.id,
  sessionId: row.session_id,
  name: row.name,
  notes: row.notes,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const CAMPAIGNS: OrderedList = { table: "campaigns", scope: "1 = 1", params: [] };
const sessionsOf = (campaignId: string): OrderedList => ({ table: "sessions", scope: "campaign_id = ?", params: [campaignId] });
const scenesOf = (sessionId: string): OrderedList => ({ table: "scenes", scope: "session_id = ?", params: [sessionId] });
const itemsOf = (sceneId: string): OrderedList => ({ table: "scene_items", scope: "scene_id = ?", params: [sceneId] });

/** Applies name/notes/extra changes and bumps updated_at, in one change. */
function updateNamed(
  store: Store,
  table: string,
  id: string,
  label: string,
  patch: Record<string, unknown>,
  extra: Record<string, string | null | undefined> = {},
) {
  const name = patch.name === undefined ? undefined : v.requiredName("name", patch.name);
  const notes = patch.notes === undefined ? undefined : v.optionalText("notes", patch.notes);
  store.change(label, () => {
    if (name !== undefined) store.run(`UPDATE ${table} SET name = ? WHERE id = ?`, name, id);
    if (notes !== undefined) store.run(`UPDATE ${table} SET notes = ? WHERE id = ?`, notes, id);
    for (const [column, value] of Object.entries(extra)) {
      if (value !== undefined) store.run(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, value, id);
    }
    store.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, store.now(), id);
  });
}

// --- Campaigns ---

export function createCampaign(
  store: Store,
  input: { id?: string; name: string; color?: string | null; notes?: string; placement?: Placement },
): Campaign {
  const id = newId(input.id);
  const name = v.requiredName("name", input.name);
  const color = v.nullableColor("color", input.color);
  const notes = v.optionalText("notes", input.notes);
  store.change(`Add campaign "${name}"`, () => {
    const now = store.now();
    store.run(
      "INSERT INTO campaigns (id, name, color, notes, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      name,
      color,
      notes,
      positionFor(store, CAMPAIGNS, input.placement ?? "end"),
      now,
      now,
    );
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

export function updateCampaign(
  store: Store,
  id: string,
  changes: { name?: string; color?: string | null; notes?: string },
): Campaign {
  const patch = patchOf(changes, ["name", "color", "notes"]);
  const campaignId = requireRow(store, "campaigns", "campaign", id);
  const color = "color" in patch ? v.nullableColor("color", patch.color) : undefined;
  updateNamed(store, "campaigns", campaignId, "Change campaign", patch, { color });
  return getCampaign(store, campaignId) as Campaign;
}

export function moveCampaign(store: Store, id: string, placement: Placement): void {
  const campaignId = requireRow(store, "campaigns", "campaign", id);
  store.change("Move campaign", () =>
    store.run(
      "UPDATE campaigns SET position = ? WHERE id = ?",
      positionFor(store, CAMPAIGNS, placement, campaignId),
      campaignId,
    ),
  );
}

/** Deletes a campaign with its sessions and scenes. Playlists and boards stay in the library. */
export function deleteCampaign(store: Store, id: string): void {
  const campaign = getCampaign(store, requireRow(store, "campaigns", "campaign", id)) as Campaign;
  store.change(`Delete campaign "${campaign.name}"`, () => store.run("DELETE FROM campaigns WHERE id = ?", campaign.id));
}

type Members = { playlistIds?: string[]; boardIds?: string[] };

function memberIds(store: Store, members: Members) {
  const input = v.record("members", members);
  const playlists = (input.playlistIds === undefined ? [] : v.ids("playlistIds", input.playlistIds)).map((id) =>
    requireRow(store, "playlists", "playlist", id),
  );
  const boards = (input.boardIds === undefined ? [] : v.ids("boardIds", input.boardIds)).map((id) =>
    requireRow(store, "boards", "board", id),
  );
  return { playlists, boards };
}

/** Adds playlists and boards to a campaign (they stay in any other campaigns). */
export function addToCampaign(store: Store, campaignId: string, members: Members): void {
  const id = requireRow(store, "campaigns", "campaign", campaignId);
  const { playlists, boards } = memberIds(store, members);
  store.change("Add to campaign", () => {
    for (const playlistId of playlists) {
      store.run("INSERT OR IGNORE INTO campaign_playlists (campaign_id, playlist_id) VALUES (?, ?)", id, playlistId);
    }
    for (const boardId of boards) {
      store.run("INSERT OR IGNORE INTO campaign_boards (campaign_id, board_id) VALUES (?, ?)", id, boardId);
    }
  });
}

export function removeFromCampaign(store: Store, campaignId: string, members: Members): void {
  const id = requireRow(store, "campaigns", "campaign", campaignId);
  const { playlists, boards } = memberIds(store, members);
  store.change("Remove from campaign", () => {
    for (const playlistId of playlists) {
      store.run("DELETE FROM campaign_playlists WHERE campaign_id = ? AND playlist_id = ?", id, playlistId);
    }
    for (const boardId of boards) {
      store.run("DELETE FROM campaign_boards WHERE campaign_id = ? AND board_id = ?", id, boardId);
    }
  });
}

/** The campaigns a playlist or board belongs to, in campaign order. */
export function campaignsOf(store: Store, item: { playlistId: string } | { boardId: string }): Campaign[] {
  const [table, column, id] =
    "playlistId" in item
      ? ["campaign_playlists", "playlist_id", item.playlistId]
      : ["campaign_boards", "board_id", item.boardId];
  return store
    .all<CampaignRow>(
      `SELECT c.* FROM campaigns c JOIN ${table} m ON m.campaign_id = c.id WHERE m.${column} = ? ORDER BY c.position, c.rowid`,
      v.id("id", id),
    )
    .map(toCampaign);
}

// --- Sessions ---

export function createSession(
  store: Store,
  input: {
    id?: string;
    campaignId: string;
    name: string;
    notes?: string;
    playedOn?: string | null;
    folderId?: string | null;
    placement?: Placement;
  },
): Session {
  const id = newId(input.id);
  const campaignId = requireRow(store, "campaigns", "campaign", input.campaignId);
  const name = v.requiredName("name", input.name);
  const notes = v.optionalText("notes", input.notes);
  const playedOn = v.nullableDate("playedOn", input.playedOn);
  const folderId = requireFolderFor(store, input.folderId, "sessions");
  store.change(`Add session "${name}"`, () => {
    const now = store.now();
    store.run(
      `INSERT INTO sessions (id, campaign_id, folder_id, name, notes, played_on, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      campaignId,
      folderId,
      name,
      notes,
      playedOn,
      positionFor(store, sessionsOf(campaignId), input.placement ?? "end"),
      now,
      now,
    );
  });
  return getSession(store, id) as Session;
}

export function getSession(store: Store, id: string): Session | null {
  const row = store.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", id);
  return row ? toSession(row) : null;
}

export function listSessions(store: Store, campaignId: string): Session[] {
  return store
    .all<SessionRow>("SELECT * FROM sessions WHERE campaign_id = ? ORDER BY position, rowid", campaignId)
    .map(toSession);
}

export function updateSession(
  store: Store,
  id: string,
  changes: { name?: string; notes?: string; playedOn?: string | null },
): Session {
  const patch = patchOf(changes, ["name", "notes", "playedOn"]);
  const sessionId = requireRow(store, "sessions", "session", id);
  const playedOn = "playedOn" in patch ? v.nullableDate("playedOn", patch.playedOn) : undefined;
  updateNamed(store, "sessions", sessionId, "Change session", patch, { played_on: playedOn });
  return getSession(store, sessionId) as Session;
}

/** Reorders a session, or moves it to another campaign or folder. */
export function moveSession(
  store: Store,
  id: string,
  target: { campaignId?: string; folderId?: string | null; placement: Placement },
): Session {
  const session = getSession(store, requireRow(store, "sessions", "session", id)) as Session;
  const campaignId =
    target.campaignId === undefined ? session.campaignId : requireRow(store, "campaigns", "campaign", target.campaignId);
  const folderId = target.folderId === undefined ? session.folderId : requireFolderFor(store, target.folderId, "sessions");
  store.change("Move session", () => {
    const position = positionFor(store, sessionsOf(campaignId), target.placement, session.id);
    store.run(
      "UPDATE sessions SET campaign_id = ?, folder_id = ?, position = ? WHERE id = ?",
      campaignId,
      folderId,
      position,
      session.id,
    );
  });
  return getSession(store, session.id) as Session;
}

export function deleteSession(store: Store, id: string): void {
  const session = getSession(store, requireRow(store, "sessions", "session", id)) as Session;
  store.change(`Delete session "${session.name}"`, () => store.run("DELETE FROM sessions WHERE id = ?", session.id));
}

// --- Scenes ---

export function createScene(
  store: Store,
  input: { id?: string; sessionId: string; name: string; notes?: string; placement?: Placement },
): Scene {
  const id = newId(input.id);
  const sessionId = requireRow(store, "sessions", "session", input.sessionId);
  const name = v.requiredName("name", input.name);
  const notes = v.optionalText("notes", input.notes);
  store.change(`Add scene "${name}"`, () => {
    const now = store.now();
    store.run(
      "INSERT INTO scenes (id, session_id, name, notes, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      sessionId,
      name,
      notes,
      positionFor(store, scenesOf(sessionId), input.placement ?? "end"),
      now,
      now,
    );
  });
  return getScene(store, id) as Scene;
}

export function getScene(store: Store, id: string): Scene | null {
  const row = store.get<SceneRow>("SELECT * FROM scenes WHERE id = ?", id);
  return row ? toScene(row) : null;
}

export function listScenes(store: Store, sessionId: string): Scene[] {
  return store.all<SceneRow>("SELECT * FROM scenes WHERE session_id = ? ORDER BY position, rowid", sessionId).map(toScene);
}

export function updateScene(store: Store, id: string, changes: { name?: string; notes?: string }): Scene {
  const patch = patchOf(changes, ["name", "notes"]);
  const sceneId = requireRow(store, "scenes", "scene", id);
  updateNamed(store, "scenes", sceneId, "Change scene", patch);
  return getScene(store, sceneId) as Scene;
}

/** Reorders a scene, or moves it to another session. */
export function moveScene(store: Store, id: string, target: { sessionId?: string; placement: Placement }): Scene {
  const scene = getScene(store, requireRow(store, "scenes", "scene", id)) as Scene;
  const sessionId =
    target.sessionId === undefined ? scene.sessionId : requireRow(store, "sessions", "session", target.sessionId);
  store.change("Move scene", () => {
    const position = positionFor(store, scenesOf(sessionId), target.placement, scene.id);
    store.run("UPDATE scenes SET session_id = ?, position = ? WHERE id = ?", sessionId, position, scene.id);
  });
  return getScene(store, scene.id) as Scene;
}

export function deleteScene(store: Store, id: string): void {
  const scene = getScene(store, requireRow(store, "scenes", "scene", id)) as Scene;
  store.change(`Delete scene "${scene.name}"`, () => store.run("DELETE FROM scenes WHERE id = ?", scene.id));
}

// --- Scene material ---

type SceneItemRow = {
  id: string;
  scene_id: string;
  playlist_id: string | null;
  board_id: string | null;
  track_id: string | null;
  position: number;
  title: string;
};

function toSceneItem(row: SceneItemRow): SceneItem {
  const base = { id: row.id, sceneId: row.scene_id, position: row.position, title: row.title };
  if (row.playlist_id !== null) return { ...base, kind: "playlist", playlistId: row.playlist_id };
  if (row.board_id !== null) return { ...base, kind: "board", boardId: row.board_id };
  return { ...base, kind: "track", trackId: row.track_id as string };
}

const SCENE_ITEM_SELECT = `
  SELECT i.*, coalesce(p.title, b.title, t.title) AS title FROM scene_items i
  LEFT JOIN playlists p ON p.id = i.playlist_id
  LEFT JOIN boards b ON b.id = i.board_id
  LEFT JOIN tracks t ON t.id = i.track_id`;

function cleanRef(store: Store, ref: unknown, index: number): [string | null, string | null, string | null] {
  const input = v.record(`items[${index}]`, ref);
  const keys = ["playlistId", "boardId", "trackId"].filter((key) => input[key] !== undefined);
  if (keys.length !== 1) {
    throw new ValidationError(`items[${index}]`, "Each scene item is exactly one playlist, board or track.");
  }
  if (keys[0] === "playlistId") return [requireRow(store, "playlists", "playlist", input.playlistId), null, null];
  if (keys[0] === "boardId") return [null, requireRow(store, "boards", "board", input.boardId), null];
  return [null, null, requireRow(store, "tracks", "track", input.trackId)];
}

/** Adds playlists, boards or tracks to a scene, together, at `placement`. */
export function addSceneItems(
  store: Store,
  sceneId: string,
  refs: SceneItemRef[],
  placement: Placement = "end",
): SceneItem[] {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  if (!Array.isArray(refs)) throw new ValidationError("items", "items must be a list.");
  const clean = refs.map((ref, index) => cleanRef(store, ref, index));
  const ids = clean.map(() => newId());
  store.change(`Add ${plural(clean.length, "item")} to scene`, () => {
    const positions = positionsFor(store, itemsOf(scene), placement, clean.length);
    clean.forEach(([playlistId, boardId, trackId], index) =>
      store.run(
        "INSERT INTO scene_items (id, scene_id, playlist_id, board_id, track_id, position) VALUES (?, ?, ?, ?, ?, ?)",
        ids[index],
        scene,
        playlistId,
        boardId,
        trackId,
        positions[index],
      ),
    );
  });
  return ids.map((id) => toSceneItem(store.get<SceneItemRow>(`${SCENE_ITEM_SELECT} WHERE i.id = ?`, id) as SceneItemRow));
}

export function listSceneItems(store: Store, sceneId: string): SceneItem[] {
  return store
    .all<SceneItemRow>(`${SCENE_ITEM_SELECT} WHERE i.scene_id = ? ORDER BY i.position, i.rowid`, sceneId)
    .map(toSceneItem);
}

export function moveSceneItem(store: Store, itemId: string, placement: Placement): void {
  const id = requireRow(store, "scene_items", "scene item", itemId);
  const { scene_id: sceneId } = store.get<{ scene_id: string }>("SELECT scene_id FROM scene_items WHERE id = ?", id) as {
    scene_id: string;
  };
  store.change("Move scene item", () =>
    store.run("UPDATE scene_items SET position = ? WHERE id = ?", positionFor(store, itemsOf(sceneId), placement, id), id),
  );
}

export function removeSceneItems(store: Store, itemIds: string[]): void {
  const ids = v.ids("itemIds", itemIds).map((id) => requireRow(store, "scene_items", "scene item", id));
  store.change(`Remove ${plural(ids.length, "item")} from scene`, () => {
    for (const id of ids) store.run("DELETE FROM scene_items WHERE id = ?", id);
  });
}
