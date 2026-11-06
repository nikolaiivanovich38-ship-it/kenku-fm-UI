/**
 * PLY-15 volume normalisation choices (schema step 4): the library's own setting (`library_settings`, one row) and a
 * track's and a playlist's choice (`tracks.normalise`, `playlists.normalise`; NULL follows the library). Each change
 * is one undo step; a choice it has already makes none. The rule that combines them is normaliseDecision
 * (src/common/domain/normalise.ts).
 */
import { NORMALISE_CHOICES, NORMALISE_TARGETS, type LibraryNormalise, type NormaliseChoice } from "../../../common/domain";
import type { Store } from "../store";
import * as v from "../validate";
import { requireRow } from "./common";

/** The library's setting: off at first, with the Standard target. */
export function getLibraryNormalise(store: Store): LibraryNormalise {
  const row = store.get<{ normalise_on: number; normalise_target: LibraryNormalise["target"] }>("SELECT normalise_on, normalise_target FROM library_settings WHERE id = 1");
  return { on: row?.normalise_on === 1, target: row?.normalise_target ?? "standard" };
}

/** Library › ⋯ › Normalise volume… › Save. */
export function setLibraryNormalise(store: Store, setting: LibraryNormalise): void {
  const record = v.record("setting", setting);
  const on = v.boolean("on", record.on);
  const target = v.oneOf("target", record.target, NORMALISE_TARGETS);
  const now = getLibraryNormalise(store);
  if (now.on === on && now.target === target) return;
  store.change("Normalise volume", () => {
    store.run(
      "INSERT INTO library_settings (id, normalise_on, normalise_target) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET normalise_on = excluded.normalise_on, normalise_target = excluded.normalise_target",
      on ? 1 : 0,
      target,
    );
  });
}

function setChoice(store: Store, table: "tracks" | "playlists", entity: string, id: string, choice: NormaliseChoice | null): void {
  const rowId = requireRow(store, table, entity, id);
  const clean = v.nullableOneOf("normalise", choice, NORMALISE_CHOICES);
  const row = store.get<{ name: string; normalise: string | null }>(
    table === "tracks" ? "SELECT coalesce(nullif(title, ''), nullif(meta_title, ''), file_name) AS name, normalise FROM tracks WHERE id = ?" : "SELECT title AS name, normalise FROM playlists WHERE id = ?",
    rowId,
  );
  if (!row || row.normalise === clean) return;
  store.change(`Normalise volume of "${row.name}"`, () => store.run(`UPDATE ${table} SET normalise = ? WHERE id = ?`, clean, rowId));
}

/** A track's own choice, wherever it plays; null follows its playlist, then the library. */
export function setTrackNormalise(store: Store, trackId: string, choice: NormaliseChoice | null): void {
  setChoice(store, "tracks", "track", trackId, choice);
}

/** A playlist's choice for its tracks when they play from it; null follows the library. */
export function setPlaylistNormalise(store: Store, playlistId: string, choice: NormaliseChoice | null): void {
  setChoice(store, "playlists", "playlist", playlistId, choice);
}
