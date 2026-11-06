/**
 * Design round 6's shared rules for the data (design/prototype/ROUND6.md part 3, core.js): a playlist's track order
 * in one place (ORG-13) and Repeat one saved with a scene's track (PLY-17). The room's running list and its Repeat,
 * never saved, are in roomList.ts.
 */

/**
 * ORG-13: track orders chosen in places, by place key ("sc:…", "ss:…", "cp:…", keyOfPlace) then playlist id: the
 * track ids in the order chosen there.
 */
export type TrackOrders = Record<string, Record<string, string[]>>;

/**
 * ORG-13: a playlist's tracks in the order chosen in one place (core.js L.placeTracks): the tracks it names first, in
 * that order; tracks it does not name (added to the playlist later) follow in the playlist's own order; a track no
 * longer in the playlist drops out. No order: the playlist's own. Shuffle, where it applies, comes on top of this.
 */
export function tracksInPlaceOrder<T extends { id: string }>(tracks: readonly T[], order: readonly string[] | undefined): T[] {
  if (!order || order.length === 0) return tracks.slice();
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  return tracks
    .map((track, i) => ({ track, r: rank.get(track.id) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.track);
}

/**
 * ORG-13: the order to keep for a place, from the ids a screen sends (a drag, Move up, Move down): only the playlist's
 * tracks, each once, in that order with the rest after them; null when that is the playlist's own order, which is
 * kept as no order at all (core.js L.setPlaceOrder).
 */
export function placeOrderToKeep(ownIds: readonly string[], ids: readonly string[]): string[] | null {
  const own = new Set(ownIds);
  const chosen = [...new Set(ids.filter((id) => own.has(id)))];
  const full = [...chosen, ...ownIds.filter((id, i) => !chosen.includes(id) && ownIds.indexOf(id) === i)];
  const ownOrder = ownIds.filter((id, i) => ownIds.indexOf(id) === i);
  return full.every((id, i) => id === ownOrder[i]) ? null : full;
}

/** PLY-17: the tracks with Repeat one in each scene, by scene key ("sc:<campaign>:<session>:<scene>"). */
export type RepeatOnes = Record<string, string[]>;

/** PLY-17: whether a scene's track plays again when it ends (its Repeat one, saved with the scene). */
export function repeatsOneIn(ones: RepeatOnes, sceneKey: string | null, trackId: string): boolean {
  return sceneKey !== null && (ones[sceneKey]?.includes(trackId) ?? false);
}
