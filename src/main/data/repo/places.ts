/**
 * Places where a choice applies only there (design round 5): one scene, one session list or one campaign list
 * (UsePlace in src/common/domain/round5.ts). A place names its campaign and session as well, as the screens' keys
 * do; the repository checks they agree with where the scene or session is now.
 */
import type { UsePlace } from "../../../common/domain";
import { ValidationError } from "../errors";
import type { Store } from "../store";
import * as v from "../validate";
import { requireRow } from "./common";

/** A checked place: the column that names it in a table with nullable place keys, its id, and words for undo labels. */
export type PlaceRow = { column: "scene_id" | "session_id" | "campaign_id"; id: string; words: string };

const sceneWords = (name: string) => (name ? `the scene "${name}"` : "this scene");
const sessionWords = (name: string) => (name ? `the session "${name}"` : "this session");

/** Checks a place and finds its row; throws NotFoundError or ValidationError in plain words. */
export function checkPlace(store: Store, place: UsePlace): PlaceRow {
  const input = v.record("place", place);
  const kind = v.oneOf("place.kind", input.kind, ["scene", "session", "campaign"] as const);
  if (kind === "campaign") {
    const id = requireRow(store, "campaigns", "campaign", input.campaignId);
    const { name } = store.get<{ name: string }>("SELECT name FROM campaigns WHERE id = ?", id) as { name: string };
    return { column: "campaign_id", id, words: `the campaign "${name}"` };
  }
  if (kind === "session") {
    const id = requireRow(store, "sessions", "session", input.sessionId);
    const row = store.get<{ name: string; campaign_id: string }>("SELECT name, campaign_id FROM sessions WHERE id = ?", id) as { name: string; campaign_id: string };
    if (row.campaign_id !== input.campaignId) throw new ValidationError("place", "That session is not in that campaign.");
    return { column: "session_id", id, words: sessionWords(row.name) };
  }
  const id = requireRow(store, "scenes", "scene", input.sceneId);
  const row = store.get<{ name: string; session_id: string; campaign_id: string }>(
    "SELECT sc.name, sc.session_id, s.campaign_id FROM scenes sc JOIN sessions s ON s.id = sc.session_id WHERE sc.id = ?",
    id,
  ) as { name: string; session_id: string; campaign_id: string };
  if (row.session_id !== input.sessionId || row.campaign_id !== input.campaignId) {
    throw new ValidationError("place", "That scene is not in that session of that campaign.");
  }
  return { column: "scene_id", id, words: sceneWords(row.name) };
}

/**
 * The SQL that names a row's place as a key (keyOfPlace / placeKey: "sc:…", "ss:…", "cp:…"), worked out from where
 * the scene or session is now, so a choice follows its scene to another session. `alias` is the table holding
 * scene_id, session_id and campaign_id columns.
 */
export function placeKeySql(alias: string): { joins: string; key: string } {
  return {
    joins: `LEFT JOIN scenes k_sc ON k_sc.id = ${alias}.scene_id
      LEFT JOIN sessions k_ss ON k_ss.id = coalesce(${alias}.session_id, k_sc.session_id)`,
    key: `CASE
      WHEN ${alias}.scene_id IS NOT NULL THEN 'sc:' || k_ss.campaign_id || ':' || k_ss.id || ':' || ${alias}.scene_id
      WHEN ${alias}.session_id IS NOT NULL THEN 'ss:' || k_ss.campaign_id || ':' || k_ss.id
      ELSE 'cp:' || ${alias}.campaign_id END`,
  };
}
