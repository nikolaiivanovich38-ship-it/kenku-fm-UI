/**
 * Tag vocabulary (DAT-10): groups (Mood, Leitmotif …) hold tags; a tag may
 * sit under a parent tag of the same group (Leitmotif › Villain › Strahd) and
 * have synonyms ("sad" → Melancholy). Renames, merges and deletes reach every
 * track in one undoable step, and the search index follows by itself.
 */
import { ValidationError } from "../errors";
import { positionFor, positionsFor, type OrderedList } from "../ordering";
import { BATCH_SIZE, type Store } from "../store";
import type { Placement, Tag, TagGroup, TagUsage } from "../types";
import * as v from "../validate";
import { newId, patchOf, placeholders, plural, requireRow, unique } from "./common";
import { dropRuleTags, mergeRuleTag } from "./ruleRows";

type GroupRow = { id: string; name: string; color: string | null; position: number };
type TagRow = {
  id: string;
  group_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  position: number;
};

const toGroup = (row: GroupRow): TagGroup => ({ id: row.id, name: row.name, color: row.color, position: row.position });

const GROUPS: OrderedList = { table: "tag_groups", scope: "1 = 1", params: [] };
const tagsIn = (groupId: string): OrderedList => ({ table: "tags", scope: "group_id = ?", params: [groupId] });

function synonymsOf(store: Store, tagIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>(tagIds.map((id): [string, string[]] => [id, []]));
  if (tagIds.length === 0) return map;
  const rows = store.all<{ tag_id: string; synonym: string }>(
    `SELECT tag_id, synonym FROM tag_synonyms WHERE tag_id IN (${placeholders(tagIds.length)}) ORDER BY synonym`,
    ...tagIds,
  );
  for (const row of rows) map.get(row.tag_id)?.push(row.synonym);
  return map;
}

function toTags(store: Store, rows: TagRow[]): Tag[] {
  const synonyms = synonymsOf(
    store,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    position: row.position,
    synonyms: synonyms.get(row.id) ?? [],
  }));
}

// --- Groups ---

export function createTagGroup(
  store: Store,
  input: { id?: string; name: string; color?: string | null; placement?: Placement },
): TagGroup {
  const id = newId(input.id);
  const name = v.requiredName("name", input.name);
  const color = v.nullableColor("color", input.color);
  store.change(`Add tag group "${name}"`, () =>
    unique("name", `A tag group called "${name}"`, () =>
      store.run(
        "INSERT INTO tag_groups (id, name, color, position) VALUES (?, ?, ?, ?)",
        id,
        name,
        color,
        positionFor(store, GROUPS, input.placement ?? "end"),
      ),
    ),
  );
  return getTagGroup(store, id) as TagGroup;
}

export function getTagGroup(store: Store, id: string): TagGroup | null {
  const row = store.get<GroupRow>("SELECT * FROM tag_groups WHERE id = ?", id);
  return row ? toGroup(row) : null;
}

export function listTagGroups(store: Store): TagGroup[] {
  return store.all<GroupRow>("SELECT * FROM tag_groups ORDER BY position, rowid").map(toGroup);
}

export function updateTagGroup(store: Store, id: string, changes: { name?: string; color?: string | null }): TagGroup {
  const patch = patchOf(changes, ["name", "color"]);
  const groupId = requireRow(store, "tag_groups", "tag group", id);
  const name = patch.name === undefined ? undefined : v.requiredName("name", patch.name);
  const color = "color" in patch ? v.nullableColor("color", patch.color) : undefined;
  store.change("Change tag group", () =>
    unique("name", `A tag group called "${name}"`, () => {
      if (name !== undefined) store.run("UPDATE tag_groups SET name = ? WHERE id = ?", name, groupId);
      if (color !== undefined) store.run("UPDATE tag_groups SET color = ? WHERE id = ?", color, groupId);
    }),
  );
  return getTagGroup(store, groupId) as TagGroup;
}

export function moveTagGroup(store: Store, id: string, placement: Placement): void {
  const groupId = requireRow(store, "tag_groups", "tag group", id);
  store.change("Move tag group", () =>
    store.run("UPDATE tag_groups SET position = ? WHERE id = ?", positionFor(store, GROUPS, placement, groupId), groupId),
  );
}

/**
 * Deletes a group and its tags in one undoable step: every track loses those
 * tags and dynamic rules their conditions on the group (ON DELETE CASCADE).
 * The tags come off the tracks in batches (DB review 1); await the result.
 */
export function deleteTagGroup(store: Store, id: string): Promise<void> {
  const group = getTagGroup(store, requireRow(store, "tag_groups", "tag group", id)) as TagGroup;
  const tagIds = store.all<{ id: string }>("SELECT id FROM tags WHERE group_id = ?", group.id).map((row) => row.id);
  return untagInBatches(store, `Delete tag group "${group.name}"`, tagIds, () =>
    store.run("DELETE FROM tag_groups WHERE id = ?", group.id),
  );
}

/**
 * Takes `tagIds` off every track that carries them, about BATCH_SIZE tracks per
 * transaction, then runs `finish` in the last one: one undo step that never
 * holds the main process for long, however many tracks carry the tags.
 */
function untagInBatches(store: Store, label: string, tagIds: string[], finish: () => void): Promise<void> {
  const list = JSON.stringify(tagIds);
  const tracks = store
    .all<{ track_id: string }>("SELECT DISTINCT track_id FROM track_tags WHERE tag_id IN (SELECT value FROM json_each(?))", list)
    .map((row) => row.track_id);
  return store.changeInBatches(label, tracks, (batch, last) => {
    store.run(
      "DELETE FROM track_tags WHERE track_id IN (SELECT value FROM json_each(?)) AND tag_id IN (SELECT value FROM json_each(?))",
      JSON.stringify(batch),
      list,
    );
    if (last) finish();
  });
}

// --- Tags ---

/** Ids of the tag and every tag below it. */
function subtreeIds(store: Store, tagId: string): string[] {
  return store
    .all<{ id: string }>(
      `WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT t.id FROM tags t JOIN sub ON t.parent_id = sub.id)
       SELECT id FROM sub`,
      tagId,
    )
    .map((row) => row.id);
}

function checkParent(store: Store, parentId: unknown, groupId: string, tagId: string | null): string | null {
  if (parentId === undefined || parentId === null) return null;
  const parent = getTag(store, requireRow(store, "tags", "tag", parentId)) as Tag;
  if (parent.groupId !== groupId) throw new ValidationError("parentId", "A tag's parent must be in the same group.");
  if (tagId !== null && subtreeIds(store, tagId).includes(parent.id)) {
    throw new ValidationError("parentId", "A tag cannot go inside itself.");
  }
  return parent.id;
}

function cleanSynonyms(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("synonyms", "synonyms must be a list.");
  const seen = new Set<string>();
  const result: string[] = [];
  value.forEach((item, index) => {
    const synonym = v.requiredName(`synonyms[${index}]`, item);
    if (!seen.has(synonym.toLowerCase())) {
      seen.add(synonym.toLowerCase());
      result.push(synonym);
    }
  });
  return result;
}

function writeSynonyms(store: Store, tagId: string, synonyms: string[]) {
  store.run("DELETE FROM tag_synonyms WHERE tag_id = ?", tagId);
  for (const synonym of synonyms) store.run("INSERT INTO tag_synonyms (tag_id, synonym) VALUES (?, ?)", tagId, synonym);
}

export function createTag(
  store: Store,
  input: {
    id?: string;
    groupId: string;
    name: string;
    parentId?: string | null;
    color?: string | null;
    synonyms?: string[];
    placement?: Placement;
  },
): Tag {
  const id = newId(input.id);
  const groupId = requireRow(store, "tag_groups", "tag group", input.groupId);
  const name = v.requiredName("name", input.name);
  const color = v.nullableColor("color", input.color);
  const parentId = checkParent(store, input.parentId, groupId, null);
  const synonyms = cleanSynonyms(input.synonyms);
  store.change(`Add tag "${name}"`, () =>
    unique("name", `A tag called "${name}" in this group`, () => {
      store.run(
        "INSERT INTO tags (id, group_id, parent_id, name, color, position) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        groupId,
        parentId,
        name,
        color,
        positionFor(store, tagsIn(groupId), input.placement ?? "end"),
      );
      writeSynonyms(store, id, synonyms);
    }),
  );
  return getTag(store, id) as Tag;
}

export function getTag(store: Store, id: string): Tag | null {
  const row = store.get<TagRow>("SELECT * FROM tags WHERE id = ?", id);
  return row ? toTags(store, [row])[0] : null;
}

/** Tags in group order, then tag order. */
export function listTags(store: Store, options: { groupId?: string } = {}): Tag[] {
  const filter = options.groupId === undefined ? "" : "WHERE t.group_id = ?";
  const params = options.groupId === undefined ? [] : [v.id("groupId", options.groupId)];
  return toTags(
    store,
    store.all<TagRow>(
      `SELECT t.* FROM tags t JOIN tag_groups g ON g.id = t.group_id ${filter} ORDER BY g.position, t.position, t.rowid`,
      ...params,
    ),
  );
}

/**
 * Renames, recolours or re-parents a tag, or moves it (and the tags below it)
 * to another group. Moving to another group clears its parent unless a new
 * parent in that group is given.
 */
export function updateTag(
  store: Store,
  id: string,
  changes: { name?: string; color?: string | null; parentId?: string | null; groupId?: string },
): Tag {
  const patch = patchOf(changes, ["name", "color", "parentId", "groupId"]);
  const tag = getTag(store, requireRow(store, "tags", "tag", id)) as Tag;
  const name = patch.name === undefined ? undefined : v.requiredName("name", patch.name);
  const color = "color" in patch ? v.nullableColor("color", patch.color) : undefined;
  const groupId = patch.groupId === undefined ? tag.groupId : requireRow(store, "tag_groups", "tag group", patch.groupId);
  const groupChanges = groupId !== tag.groupId;
  const parentId =
    "parentId" in patch ? checkParent(store, patch.parentId, groupId, tag.id) : groupChanges ? null : tag.parentId;
  store.change(`Change tag "${tag.name}"`, () =>
    unique("name", `A tag called "${name ?? tag.name}" in this group`, () => {
      // Rules name tags by key, so a rename needs nothing; a tag moving to another group
      // leaves its old group's conditions (rule_condition_tags' key ties a value to the group).
      if (groupChanges) dropRuleTags(store, subtreeIds(store, tag.id));
      if (name !== undefined) store.run("UPDATE tags SET name = ? WHERE id = ?", name, tag.id);
      if (color !== undefined) store.run("UPDATE tags SET color = ? WHERE id = ?", color, tag.id);
      if (groupChanges) {
        // The tag and the tags below it go to the end of the new group, in their order (positions are unique per group).
        const moving = subtreeIds(store, tag.id);
        const positions = positionsFor(store, tagsIn(groupId), "end", moving.length);
        moving.forEach((subId, index) => store.run("UPDATE tags SET group_id = ?, position = ? WHERE id = ?", groupId, positions[index], subId));
      }
      if (parentId !== tag.parentId) store.run("UPDATE tags SET parent_id = ? WHERE id = ?", parentId, tag.id);
    }),
  );
  return getTag(store, tag.id) as Tag;
}

export function moveTag(store: Store, id: string, placement: Placement): void {
  const tag = getTag(store, requireRow(store, "tags", "tag", id)) as Tag;
  store.change("Move tag", () =>
    store.run("UPDATE tags SET position = ? WHERE id = ?", positionFor(store, tagsIn(tag.groupId), placement, tag.id), tag.id),
  );
}

/**
 * SQL for where a tag is used, each starting from the tag's own index
 * (track_tags_tag, rule_condition_tags_tag, pads_tag). Exported for the query-plan tests.
 */
export const TAG_USAGE_SQL = {
  tracks: "SELECT count(*) AS n FROM track_tags WHERE tag_id = ?",
  playlists: `SELECT DISTINCT p.id, p.title FROM rule_condition_tags v
    JOIN rule_conditions c ON c.id = v.condition_id JOIN playlists p ON p.id = c.playlist_id
    WHERE v.tag_id = ? ORDER BY p.title COLLATE NOCASE, p.id`,
  pads: `SELECT p.id, p.label, b.id AS boardId, b.title AS boardTitle FROM pads p JOIN boards b ON b.id = p.board_id
    WHERE p.sound_tag_id = ? ORDER BY b.title COLLATE NOCASE, b.id, p.label COLLATE NOCASE, p.id`,
} as const;

/** Where a tag is used: the "Used in" question asked before deleting it (DB review 2). */
export function tagUsage(store: Store, id: string): TagUsage {
  const tagId = requireRow(store, "tags", "tag", id);
  return {
    tracks: (store.get<{ n: number }>(TAG_USAGE_SQL.tracks, tagId) as { n: number }).n,
    playlists: store.all<{ id: string; title: string }>(TAG_USAGE_SQL.playlists, tagId),
    pads: store.all<TagUsage["pads"][number]>(TAG_USAGE_SQL.pads, tagId),
  };
}

/**
 * Deletes a tag; tracks and dynamic rules lose it (ON DELETE CASCADE), and tags
 * below it move to the top of the group. The tracks lose it in batches (DB review 1).
 */
export function deleteTag(store: Store, id: string): Promise<void> {
  const tag = getTag(store, requireRow(store, "tags", "tag", id)) as Tag;
  return untagInBatches(store, `Delete tag "${tag.name}"`, [tag.id], () => store.run("DELETE FROM tags WHERE id = ?", tag.id));
}

export function setTagSynonyms(store: Store, id: string, synonyms: string[]): Tag {
  const tagId = requireRow(store, "tags", "tag", id);
  const clean = cleanSynonyms(synonyms);
  store.change("Change synonyms", () => writeSynonyms(store, tagId, clean));
  return getTag(store, tagId) as Tag;
}

/**
 * Merges tags into `targetId` as one undoable step: their tracks get the target
 * tag, their names and synonyms become synonyms of the target, tags below them
 * move under the target (or to the top of their group), and they are deleted.
 * The tracks move over in batches (DB review 1); await the result.
 */
export function mergeTags(store: Store, sourceIds: string[], targetId: string): Promise<Tag> {
  const target = getTag(store, requireRow(store, "tags", "tag", targetId)) as Tag;
  const sources = [...new Set(v.ids("sourceIds", sourceIds))].map(
    (id) => getTag(store, requireRow(store, "tags", "tag", id)) as Tag,
  );
  if (sources.length === 0 || sources.some((source) => source.id === target.id)) {
    throw new ValidationError("sourceIds", "Choose one or more other tags to merge into this one.");
  }
  const list = JSON.stringify(sources.map((source) => source.id));
  const tracks = store
    .all<{ track_id: string }>("SELECT DISTINCT track_id FROM track_tags WHERE tag_id IN (SELECT value FROM json_each(?))", list)
    .map((row) => row.track_id);
  return store
    .changeInBatches(`Merge ${plural(sources.length, "tag")} into "${target.name}"`, tracks, (batch, last) => {
      const these = JSON.stringify(batch);
      store.run(
        `INSERT OR IGNORE INTO track_tags (track_id, tag_id)
         SELECT DISTINCT track_id, ? FROM track_tags WHERE track_id IN (SELECT value FROM json_each(?)) AND tag_id IN (SELECT value FROM json_each(?))`,
        target.id,
        these,
        list,
      );
      store.run(
        "DELETE FROM track_tags WHERE track_id IN (SELECT value FROM json_each(?)) AND tag_id IN (SELECT value FROM json_each(?))",
        these,
        list,
      );
      if (!last) return;
      for (const source of sources) {
        // Rules naming the source name the target (same group); in another group the source's values just go.
        if (source.groupId === target.groupId) mergeRuleTag(store, source.id, target.id);
        for (const synonym of [source.name, ...source.synonyms]) {
          if (synonym.toLowerCase() !== target.name.toLowerCase()) {
            store.run("INSERT OR IGNORE INTO tag_synonyms (tag_id, synonym) VALUES (?, ?)", target.id, synonym);
          }
        }
        store.run(
          "UPDATE tags SET parent_id = CASE WHEN group_id = ? THEN ? ELSE NULL END WHERE parent_id = ?",
          target.groupId,
          target.id,
          source.id,
        );
        store.run("DELETE FROM tags WHERE id = ?", source.id);
      }
    })
    .then(() => getTag(store, target.id) as Tag);
}

// --- Tagging tracks ---

/** Tracks per batch when tagging: about BATCH_SIZE rows, whatever the number of tags. */
const tracksPerBatch = (tagCount: number) => Math.max(1, Math.floor(BATCH_SIZE / Math.max(1, tagCount)));

/**
 * Gives every listed track every listed tag (one step; tags already there are
 * kept), in batches when there are many (DB review 1); await the result.
 */
export function tagTracks(store: Store, trackIds: string[], tagIds: string[]): Promise<void> {
  const tracks = v.ids("trackIds", trackIds).map((id) => requireRow(store, "tracks", "track", id));
  const tags = v.ids("tagIds", tagIds).map((id) => requireRow(store, "tags", "tag", id));
  return store.changeInBatches(
    `Tag ${plural(tracks.length, "track")}`,
    tracks,
    (batch) => {
      for (const trackId of batch) {
        for (const tagId of tags) store.run("INSERT OR IGNORE INTO track_tags (track_id, tag_id) VALUES (?, ?)", trackId, tagId);
      }
    },
    { batchSize: tracksPerBatch(tags.length) },
  );
}

/** Takes every listed tag off every listed track, like tagTracks. */
export function untagTracks(store: Store, trackIds: string[], tagIds: string[]): Promise<void> {
  const tracks = v.ids("trackIds", trackIds);
  const tags = v.ids("tagIds", tagIds);
  return store.changeInBatches(
    `Remove tags from ${plural(tracks.length, "track")}`,
    tracks,
    (batch) => {
      for (const trackId of batch) {
        for (const tagId of tags) store.run("DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?", trackId, tagId);
      }
    },
    { batchSize: tracksPerBatch(tags.length) },
  );
}

/** A track's tags in group order, then tag order. */
export function tagsOfTrack(store: Store, trackId: string): Tag[] {
  return toTags(
    store,
    store.all<TagRow>(
      `SELECT t.* FROM track_tags tt JOIN tags t ON t.id = tt.tag_id JOIN tag_groups g ON g.id = t.group_id
       WHERE tt.track_id = ? ORDER BY g.position, t.position, t.rowid`,
      trackId,
    ),
  );
}

export type TagSuggestion = { tag: Tag; groupName: string; /** The name or synonym that matched. */ matched: string };

/**
 * Tags whose name or synonym starts with `text`, or has a word starting with it,
 * for quick tagging with autocomplete. Grouped: group order, then tag order.
 */
export function suggestTags(store: Store, text: string, limit = 20): TagSuggestion[] {
  const typed = v.optionalText("text", text, v.MAX_NAME_LENGTH).trim();
  if (typed === "") return [];
  const escaped = typed.replace(/[\\%_]/g, (c) => `\\${c}`);
  const starts = `${escaped}%`;
  const wordStarts = `% ${escaped}%`;
  const rows = store.all<TagRow & { group_name: string; matched: string }>(
    `SELECT t.*, g.name AS group_name, m.matched FROM (
       SELECT id AS tag_id, name AS matched, 0 AS rank FROM tags
         WHERE name LIKE ?1 ESCAPE '\\' OR name LIKE ?2 ESCAPE '\\'
       UNION ALL
       SELECT tag_id, synonym, 1 FROM tag_synonyms
         WHERE synonym LIKE ?1 ESCAPE '\\' OR synonym LIKE ?2 ESCAPE '\\'
     ) m
     JOIN tags t ON t.id = m.tag_id JOIN tag_groups g ON g.id = t.group_id
     ORDER BY g.position, t.position, m.rank, m.matched`,
    starts,
    wordStarts,
  );
  const seen = new Set<string>();
  const distinct = rows.filter((row) => !seen.has(row.id) && seen.add(row.id)).slice(0, limit);
  const tags = toTags(store, distinct);
  return distinct.map((row, index) => ({ tag: tags[index], groupName: row.group_name, matched: row.matched }));
}
