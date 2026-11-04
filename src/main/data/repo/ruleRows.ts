/**
 * Dynamic playlist rules as rows (DAT-11): a playlist's energy range and
 * "leave out stings" are columns of playlists; each condition is a
 * rule_conditions row and each tag it names a rule_condition_tags row, both in
 * order. The domain's PlaylistRule names tags by name; it is resolved to tag
 * keys when written and named again when read, so renaming a tag needs no
 * rewrite and deleting one takes it out of every rule (ON DELETE CASCADE).
 * Writers here run inside the caller's change.
 */
import type { PlaylistRule, TagCondition } from "../../../common/domain";
import { ValidationError } from "../errors";
import { GAP } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import { newId, placeholders, requireRow } from "./common";

/** A rule with its tags resolved to keys, ready to store. */
export type ResolvedRule = {
  conds: { groupId: string; match: TagCondition["match"]; tagIds: string[] }[];
  energy: [number, number] | null;
  leaveOutStings: boolean;
};

/** Resolves a checked rule's tag names (any case) to tags of each condition's group. */
export function resolveRule(store: Store, rule: PlaylistRule): ResolvedRule {
  return {
    conds: rule.conds.map((cond, index) => {
      const groupId = requireRow(store, "tag_groups", "tag group", cond.group);
      const tagIds: string[] = [];
      for (const name of cond.values) {
        const tag = store.get<{ id: string }>("SELECT id FROM tags WHERE group_id = ? AND name = ? COLLATE NOCASE", groupId, name);
        if (!tag) throw new ValidationError(`rule.conds[${index}].values`, `There is no tag called "${name}" in that tag group.`);
        if (!tagIds.includes(tag.id)) tagIds.push(tag.id);
      }
      return { groupId, match: cond.match, tagIds };
    }),
    energy: rule.energy ?? null,
    leaveOutStings: rule.leaveOutStings === true,
  };
}

/** The playlists columns that hold a rule's own settings. */
export function ruleColumns(rule: ResolvedRule | null): Record<string, SQLInputValue> {
  return {
    rule_energy_min: rule?.energy?.[0] ?? null,
    rule_energy_max: rule?.energy?.[1] ?? null,
    rule_leave_out_stings: rule?.leaveOutStings ? 1 : 0,
  };
}

/** Replaces a playlist's conditions (the rule's columns are written by the caller). */
export function writeConditions(store: Store, playlistId: string, rule: ResolvedRule): void {
  store.run("DELETE FROM rule_conditions WHERE playlist_id = ?", playlistId);
  rule.conds.forEach((cond, index) => {
    const conditionId = newId();
    store.run(
      "INSERT INTO rule_conditions (id, playlist_id, group_id, match, position) VALUES (?, ?, ?, ?, ?)",
      conditionId,
      playlistId,
      cond.groupId,
      cond.match,
      (index + 1) * GAP,
    );
    cond.tagIds.forEach((tagId, i) =>
      store.run(
        "INSERT INTO rule_condition_tags (condition_id, group_id, tag_id, position) VALUES (?, ?, ?, ?)",
        conditionId,
        cond.groupId,
        tagId,
        (i + 1) * GAP,
      ),
    );
  });
}

type RuleSettings = { id: string; rule_energy_min: number | null; rule_energy_max: number | null; rule_leave_out_stings: number };

/** The rules of the given dynamic playlists, in the domain's shape (tags by name), by playlist id. */
export function readRules(store: Store, playlists: RuleSettings[]): Map<string, PlaylistRule> {
  const out = new Map<string, PlaylistRule>();
  if (playlists.length === 0) return out;
  const ids = JSON.stringify(playlists.map((p) => p.id));
  const conds = store.all<{ id: string; playlist_id: string; group_id: string; match: TagCondition["match"] }>(
    `SELECT id, playlist_id, group_id, match FROM rule_conditions
     WHERE playlist_id IN (SELECT value FROM json_each(?)) ORDER BY playlist_id, position`,
    ids,
  );
  const values = new Map<string, string[]>();
  for (const row of store.all<{ condition_id: string; name: string }>(
    `SELECT v.condition_id, t.name FROM rule_conditions c
     JOIN rule_condition_tags v ON v.condition_id = c.id JOIN tags t ON t.id = v.tag_id
     WHERE c.playlist_id IN (SELECT value FROM json_each(?)) ORDER BY v.condition_id, v.position`,
    ids,
  )) {
    const list = values.get(row.condition_id);
    if (list) list.push(row.name);
    else values.set(row.condition_id, [row.name]);
  }
  for (const p of playlists) {
    const rule: PlaylistRule = { conds: [] };
    if (p.rule_energy_min !== null) rule.energy = [p.rule_energy_min, p.rule_energy_max as number];
    if (p.rule_leave_out_stings === 1) rule.leaveOutStings = true;
    out.set(p.id, rule);
  }
  for (const c of conds) out.get(c.playlist_id)?.conds.push({ group: c.group_id, match: c.match, values: values.get(c.id) ?? [] });
  return out;
}

/**
 * The SQL that lists the tracks a dynamic playlist plays, in library order:
 * the same answer as playlistTracks in src/common/domain (tested against it),
 * worked out in the database through track_tags' indexes. When the rule has a
 * condition that needs a tag, the tracks with that tag are the starting set
 * (track_tags_tag), so only they are looked at; a rule of energy alone reads
 * the lane through tracks_kind.
 */
export function dynamicTracksQuery(store: Store, playlistId: string): { sql: string; params: SQLInputValue[] } | null {
  const playlist = store.get<RuleSettings & { lane: string; kind: string }>(
    "SELECT id, kind, lane, rule_energy_min, rule_energy_max, rule_leave_out_stings FROM playlists WHERE id = ?",
    playlistId,
  );
  if (!playlist || playlist.kind !== "dynamic") return null;
  const conds = store.all<{ id: string; match: string }>("SELECT id, match FROM rule_conditions WHERE playlist_id = ? ORDER BY position", playlist.id);
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  let driver: string | null = null;
  const driverParams: SQLInputValue[] = [];
  if (playlist.lane === "fx") where.push("(t.kind = 'fx' OR t.role = 'sting')");
  else {
    where.push("t.kind = ?");
    params.push(playlist.lane);
  }
  if (playlist.rule_energy_min !== null) {
    // A track without energy counts as 0 (matchesRule); above 0 the range can use tracks_kind (kind, energy).
    if (playlist.rule_energy_min > 0) where.push("t.energy BETWEEN ? AND ?");
    else where.push("coalesce(t.energy, 0) BETWEEN ? AND ?");
    params.push(playlist.rule_energy_min, playlist.rule_energy_max);
  }
  if (playlist.rule_leave_out_stings === 1) where.push("t.role IS NOT 'sting'");
  for (const cond of conds) {
    const tagIds = store
      .all<{ tag_id: string }>("SELECT tag_id FROM rule_condition_tags WHERE condition_id = ? ORDER BY position", cond.id)
      .map((r) => r.tag_id);
    // A saved condition with no tags matches nothing (matchesRule): it is left empty when its last
    // tag is deleted, and must not widen the playlist to its whole lane. The rule editor previews a
    // condition still being written with withoutEmptyConditions, so that never reaches the database.
    if (tagIds.length === 0) return { sql: "SELECT t.id FROM tracks t WHERE 0", params: [] };
    const has = (ids: string[]) => `EXISTS (SELECT 1 FROM track_tags tt WHERE tt.track_id = t.id AND tt.tag_id IN (${placeholders(ids.length)}))`;
    if (cond.match === "any") {
      where.push(has(tagIds));
      params.push(...tagIds);
    } else if (cond.match === "all") {
      for (const tagId of tagIds) {
        where.push(has([tagId]));
        params.push(tagId);
      }
    } else {
      where.push(`NOT ${has(tagIds)}`);
      params.push(...tagIds);
    }
    if (driver === null && cond.match !== "none") {
      const first = cond.match === "any" ? tagIds : [tagIds[0]];
      driver = `t.id IN (SELECT track_id FROM track_tags WHERE tag_id IN (${placeholders(first.length)}))`;
      driverParams.push(...first);
    }
  }
  if (driver) {
    where.unshift(driver);
    params.unshift(...driverParams);
  }
  return { sql: `SELECT t.id FROM tracks t WHERE ${where.join(" AND ")} ORDER BY t.rowid`, params };
}

/**
 * When a tag merges into another of the same group, rules naming the source
 * name the target instead, at the source's place (or keep the target where a
 * condition already names it). Call before the source is deleted.
 */
export function mergeRuleTag(store: Store, sourceId: string, targetId: string): void {
  const rows = store.all<{ condition_id: string; group_id: string; position: number }>(
    "SELECT condition_id, group_id, position FROM rule_condition_tags WHERE tag_id = ?",
    sourceId,
  );
  for (const row of rows) {
    store.run("DELETE FROM rule_condition_tags WHERE condition_id = ? AND tag_id = ?", row.condition_id, sourceId);
    const named = store.get("SELECT 1 AS found FROM rule_condition_tags WHERE condition_id = ? AND tag_id = ?", row.condition_id, targetId);
    if (!named) {
      store.run(
        "INSERT INTO rule_condition_tags (condition_id, group_id, tag_id, position) VALUES (?, ?, ?, ?)",
        row.condition_id,
        row.group_id,
        targetId,
        row.position,
      );
    }
  }
}

/** Takes tags out of every rule (a tag moving to another group no longer belongs to its old group's conditions). */
export function dropRuleTags(store: Store, tagIds: string[]): void {
  if (tagIds.length === 0) return;
  store.run(`DELETE FROM rule_condition_tags WHERE tag_id IN (${placeholders(tagIds.length)})`, ...tagIds);
}
