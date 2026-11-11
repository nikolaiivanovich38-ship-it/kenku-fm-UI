/**
 * A DomainLookup over lists a screen already has from LyreApi (library.listTracks, playlists.list), so screens and
 * tests apply the shared rules in src/common/domain (playlistTracks, sceneSequence, ...) without asking again.
 */
import { inScreenOrder, type DomainLookup, type DomainPlaylist, type DomainTrack, type RepeatOnes, type TagTree, type TrackNames } from "../domain";
import type { CampaignInfo, PlaylistDivider, TagGroup, TagInfo } from "./api";

/** `tree` (DAT-10, tagTreeOf): tags inside tags, so a rule naming a tag finds the tags inside it as the library does. */
export function lookupFrom(tracks: readonly DomainTrack[], playlists: readonly DomainPlaylist[], tree?: TagTree): DomainLookup {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const playlistById = new Map(playlists.map((p) => [p.id, p]));
  return {
    track: (id) => trackById.get(id),
    playlist: (id) => playlistById.get(id),
    tracks: () => tracks,
    ...(tree ? { tagTree: () => tree } : {}),
  };
}

/** DAT-10: the TagTree of the shared rules (trackHasTag, matchesRule) from tags.listGroups. */
export function tagTreeOf(groups: readonly TagGroup[]): TagTree {
  const out: TagTree = {};
  for (const g of groups) for (const t of g.tags ?? []) if (t.parent) (out[g.id] ??= {})[t.name] = t.parent;
  return out;
}

/**
 * DAT-10: a group's tags on a track in vocabulary order, the order the Tags screen lists the group's tags in (each tag
 * followed, depth first, by the tags inside it), so a tag is in the same place on every row (the library reads a
 * track's tags in this order). A tag the group does not list yet (one just made) goes last.
 */
export function inVocabularyOrder(group: Pick<TagGroup, "values"> & { tags?: readonly TagInfo[] }, tags: readonly string[]): string[] {
  const parents = new Map((group.tags ?? []).map((t) => [t.name, t.parent]));
  const order = inScreenOrder(group.values, (name) => name, (name) => parents.get(name) ?? null);
  const rank = (tag: string) => (order.includes(tag) ? order.indexOf(tag) : order.length);
  return [...tags].sort((a, b) => rank(a) - rank(b));
}

/** ORG-4: a manual playlist's list as shown: its tracks with its dividers where they are (PlaylistInfo.dividers). */
export type PlaylistEntry = { kind: "track"; trackId: string } | { kind: "divider"; id: string; name: string };
export function withDividers(trackIds: readonly string[], dividers: readonly PlaylistDivider[]): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  const byAt = [...dividers].sort((a, b) => a.at - b.at);
  let d = 0;
  trackIds.forEach((trackId, i) => {
    for (; d < byAt.length && byAt[d].at <= i; d++) out.push({ kind: "divider", id: byAt[d].id, name: byAt[d].name });
    out.push({ kind: "track", trackId });
  });
  for (; d < byAt.length; d++) out.push({ kind: "divider", id: byAt[d].id, name: byAt[d].name });
  return out;
}

/** DAT-14: every scene's names for its tracks, keyed by scene key as trackNameIn takes them, from the campaign trees. */
export function trackNamesOf(campaigns: readonly CampaignInfo[]): TrackNames {
  const out: TrackNames = {};
  for (const c of campaigns)
    for (const s of c.sessions)
      for (const sc of s.scenes) if (Object.keys(sc.trackNames).length) out[`sc:${c.id}:${s.id}:${sc.id}`] = { ...sc.trackNames };
  return out;
}

/** PLY-17: every scene's Repeat ones, keyed by scene key as repeatsOneIn takes them, from the campaign trees. */
export function repeatOnesOf(campaigns: readonly CampaignInfo[]): RepeatOnes {
  const out: RepeatOnes = {};
  for (const c of campaigns)
    for (const s of c.sessions)
      for (const sc of s.scenes) if (sc.repeatOnes?.length) out[`sc:${c.id}:${s.id}:${sc.id}`] = [...sc.repeatOnes];
  return out;
}
