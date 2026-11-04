/** Named markers on tracks (DAT-3 data): "swell 1:32", loop in/out, mix out. */
import type { Store } from "../store";
import { MARKER_KINDS, type Marker, type MarkerKind } from "../types";
import * as v from "../validate";
import { newId, patchOf, requireRow } from "./common";

type MarkerRow = { id: string; track_id: string; time_ms: number; kind: string; label: string; created_at: number };

const toMarker = (row: MarkerRow): Marker => ({
  id: row.id,
  trackId: row.track_id,
  timeMs: row.time_ms,
  kind: row.kind as MarkerKind,
  label: row.label,
  createdAt: row.created_at,
});

export function addMarker(
  store: Store,
  trackId: string,
  input: { id?: string; timeMs: number; kind?: MarkerKind; label?: string },
): Marker {
  const id = newId(input.id);
  const track = requireRow(store, "tracks", "track", trackId);
  const timeMs = v.milliseconds("timeMs", input.timeMs);
  const kind = v.oneOf("kind", input.kind ?? "marker", MARKER_KINDS);
  const label = v.optionalText("label", input.label, v.MAX_NAME_LENGTH);
  store.change("Add marker", () =>
    store.run(
      "INSERT INTO markers (id, track_id, time_ms, kind, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      track,
      timeMs,
      kind,
      label,
      store.now(),
    ),
  );
  return getMarker(store, id) as Marker;
}

export function getMarker(store: Store, id: string): Marker | null {
  const row = store.get<MarkerRow>("SELECT * FROM markers WHERE id = ?", id);
  return row ? toMarker(row) : null;
}

/** A track's markers in time order. */
export function listMarkers(store: Store, trackId: string): Marker[] {
  return store.all<MarkerRow>("SELECT * FROM markers WHERE track_id = ? ORDER BY time_ms, id", trackId).map(toMarker);
}

export function updateMarker(
  store: Store,
  id: string,
  changes: { timeMs?: number; kind?: MarkerKind; label?: string },
): Marker {
  const patch = patchOf(changes, ["timeMs", "kind", "label"]);
  const markerId = requireRow(store, "markers", "marker", id);
  const timeMs = patch.timeMs === undefined ? undefined : v.milliseconds("timeMs", patch.timeMs);
  const kind = patch.kind === undefined ? undefined : v.oneOf("kind", patch.kind, MARKER_KINDS);
  const label = patch.label === undefined ? undefined : v.optionalText("label", patch.label, v.MAX_NAME_LENGTH);
  store.change("Edit marker", () => {
    if (timeMs !== undefined) store.run("UPDATE markers SET time_ms = ? WHERE id = ?", timeMs, markerId);
    if (kind !== undefined) store.run("UPDATE markers SET kind = ? WHERE id = ?", kind, markerId);
    if (label !== undefined) store.run("UPDATE markers SET label = ? WHERE id = ?", label, markerId);
  });
  return getMarker(store, markerId) as Marker;
}

export function deleteMarker(store: Store, id: string): void {
  const markerId = requireRow(store, "markers", "marker", id);
  store.change("Delete marker", () => store.run("DELETE FROM markers WHERE id = ?", markerId));
}
