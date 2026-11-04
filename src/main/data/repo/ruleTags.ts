/**
 * Dynamic playlist rules name tags (PlaylistRule in src/common/domain holds tag
 * names, as the design does). When a tag is renamed, merged, moved or deleted,
 * or its group is deleted, the rules that name it change with it, inside the
 * same undoable step (called from tags.ts within its change).
 */
import type { PlaylistRule } from "../../../common/domain";
import type { Store } from "../store";

/** Rewrites the conditions on `groupId` in every rule that has one; `values` returning null drops the condition. */
function rewriteRules(store: Store, groupId: string, values: (current: string[]) => string[] | null) {
  const rows = store.all<{ id: string; rule: string }>(
    `SELECT id, rule FROM playlists WHERE kind = 'dynamic' AND rule IS NOT NULL
       AND EXISTS (SELECT 1 FROM json_each(rule, '$.conds') c WHERE json_extract(c.value, '$.group') = ?)`,
    groupId,
  );
  for (const row of rows) {
    const rule = JSON.parse(row.rule) as PlaylistRule;
    const conds = rule.conds.flatMap((cond) => {
      if (cond.group !== groupId) return [cond];
      const next = values(cond.values);
      return next === null ? [] : [{ ...cond, values: next }];
    });
    const json = JSON.stringify({ ...rule, conds });
    if (json !== row.rule) store.run("UPDATE playlists SET rule = ? WHERE id = ?", json, row.id);
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Renames a tag value in rules on its group; `to` null takes the value out. */
export function renameRuleTag(store: Store, groupId: string, from: string, to: string | null) {
  rewriteRules(store, groupId, (current) => {
    const out: string[] = [];
    for (const value of current) {
      const next = same(value, from) ? to : value;
      if (next !== null && !out.some((v) => same(v, next))) out.push(next);
    }
    return out;
  });
}

/** Takes every condition on a deleted tag group out of the rules. */
export function dropRuleGroup(store: Store, groupId: string) {
  rewriteRules(store, groupId, () => null);
}
