/**
 * Where tracks are used, in words, for the confirmations that take tracks out of the library (0.5.2 items 1, 20 and
 * 50) and change their type (items 4, 12 and 39): the manual playlists, scenes and pads that name them. Dynamic
 * playlists are left out: they pick tracks by their tags, so nothing in them is lost.
 */
import { isFx, type TrackKind } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PadBoard, PlaylistInfo } from "../../../common/lyre/api";
import { KIND_NAMES } from "./model";

export interface TrackUses {
  /** Manual playlists that list any of the tracks. */
  playlists: string[];
  /** Scenes whose music or ambience names any of them: "The abbey ruins (Session 14)". */
  scenes: string[];
  /** Pads that play any of them: "Thunder (Weather)". */
  pads: string[];
}

/** Every place that names any of `ids`, each once, in list order. */
export function usesOfTracks(ids: Iterable<string>, lists: { playlists: readonly PlaylistInfo[]; campaigns: readonly CampaignInfo[]; boards: readonly PadBoard[] }): TrackUses {
  const set = new Set(ids);
  const playlists = lists.playlists.filter((p) => p.kind === "manual" && p.trackIds.some((id) => set.has(id))).map((p) => p.name);
  const scenes: string[] = [];
  for (const c of lists.campaigns)
    for (const s of c.sessions)
      for (const sc of s.scenes) {
        const named = sc.music.some((m) => m.kind === "track" && set.has(m.id)) || (sc.ambience?.kind === "track" && set.has(sc.ambience.id));
        if (named) scenes.push(`${sc.name} (Session ${s.number})`);
      }
  const pads: string[] = [];
  for (const b of lists.boards) for (const p of [...b.slots, ...b.spare]) if (p && p.sound.trackIds.some((id) => set.has(id))) pads.push(`${p.label || "A pad"} (${b.name})`);
  return { playlists, scenes, pads };
}

export const isUsed = (uses: TrackUses): boolean => uses.playlists.length + uses.scenes.length + uses.pads.length > 0;

/** One line per kind of place: "Playlists: Combat, Tavern", "Scenes: …", "Pads: …" (the five first, then "and 3 more"). */
export function usesLines(uses: TrackUses): string[] {
  const few = (names: string[]) => (names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", "));
  const out: string[] = [];
  if (uses.playlists.length) out.push(`Playlists: ${few(uses.playlists)}`);
  if (uses.scenes.length) out.push(`Scenes: ${few(uses.scenes)}`);
  if (uses.pads.length) out.push(`Pads: ${few(uses.pads)}`);
  return out;
}

/**
 * Items 4, 12 and 39: what changing these tracks to `kind` affects, in words: a manual playlist of another type that
 * lists one (it stays there, but plays in that playlist's lane), and a scene whose ambience is one that is no longer
 * ambience. Empty when nothing is affected.
 */
export function typeChangeEffects(
  tracks: readonly LibraryTrack[],
  kind: TrackKind,
  lists: { playlists: readonly PlaylistInfo[]; campaigns: readonly CampaignInfo[] },
): string[] {
  const changing = tracks.filter((t) => t.kind !== kind);
  if (!changing.length) return [];
  const ids = new Set(changing.map((t) => t.id));
  // A playlist's lane fits a track of the kind; FX also takes stings (isFx), whatever their kind.
  const fits = (lane: TrackKind, t: LibraryTrack) => (lane === "fx" ? kind === "fx" || isFx({ ...t, kind }) : lane === kind);
  const out: string[] = [];
  for (const p of lists.playlists) {
    if (p.kind !== "manual") continue;
    const clash = changing.filter((t) => p.trackIds.includes(t.id) && !fits(p.lane, t));
    if (clash.length) out.push(`${clash.length === 1 ? `"${titleOf(clash[0])}" is` : `${clash.length} of them are`} in ${p.name}, a ${KIND_NAMES[p.lane]} playlist.`);
  }
  if (kind !== "amb") {
    for (const c of lists.campaigns)
      for (const s of c.sessions)
        for (const sc of s.scenes)
          if (sc.ambience?.kind === "track" && ids.has(sc.ambience.id)) {
            const t = changing.find((x) => x.id === sc.ambience?.id) as LibraryTrack;
            out.push(`"${titleOf(t)}" is the ambience of ${sc.name} (Session ${s.number}); it stays there, but is no longer offered as ambience.`);
          }
  }
  return out;
}

const titleOf = (t: LibraryTrack) => t.title || t.metaTitle || t.fileName;
